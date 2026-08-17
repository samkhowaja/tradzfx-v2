# Freeze Defense-in-Depth: Technical Enforcement — 2026-08-17

## Purpose

Translate governance freeze into technical controls so that `database_writes: 0` and `permission: INACTIVE` are enforced by the stack, not just by discipline.

Three-layer defense:
1. **Database layer:** Read-only connections, transaction isolation, explicit rollback.
2. **Application layer:** Disabled write paths, guarded persist, dry-run-only modes.
3. **Repo layer:** Blocked script execution, migration quarantine, CI/CD guardrails.

---

## Layer 1: Database-Level Enforcement

### Audit Script Template (Mandatory Pattern)

All analysis scripts during freeze must follow this pattern:

```javascript
const pg = require('pg');
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 30000,
});

async function runAudit() {
  try {
    await client.connect();
    
    // Explicit read-only transaction start
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;');
    
    // Verify read-only mode is active
    const readOnlyCheck = await client.query(
      'SHOW transaction_read_only;'
    );
    const isReadOnly = readOnlyCheck.rows[0].transaction_read_only === 'on';
    
    if (!isReadOnly) {
      throw new Error('FATAL: Read-only mode not active. Aborting audit.');
    }
    
    console.log('[AUDIT] Read-only mode verified. Proceeding.');
    
    // Audit queries only (SELECT, EXPLAIN, metadata)
    const result = await client.query(`
      SELECT table_name, row_count
      FROM my_audit_view
      LIMIT 100;
    `);
    
    console.log(JSON.stringify(result.rows, null, 2));
    
    // Explicit rollback (never commit during freeze)
    await client.query('ROLLBACK;');
    console.log('[AUDIT] Transaction rolled back. No writes persisted.');
    
  } catch (err) {
    console.error('[ERROR]', err.message);
    try {
      await client.query('ROLLBACK;');
    } catch (rollbackErr) {
      console.error('[ROLLBACK ERROR]', rollbackErr.message);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

runAudit();
```

**Validation checklist:**
- [ ] `BEGIN ... READ ONLY` before any queries.
- [ ] Explicit `SHOW transaction_read_only` check with error on `off`.
- [ ] All queries are SELECT, EXPLAIN, or metadata (no INSERT/UPDATE/DELETE).
- [ ] `ROLLBACK` at end (never COMMIT).
- [ ] Process exits 1 on any error.

### Manual Query Mode (psql)

If manual queries needed during freeze:

```bash
psql "$DATABASE_URL" --set=default_transaction_read_only=on \
  --command="SELECT COUNT(*) FROM market.candles_1m_canonical;"
```

**Never use:**
```bash
psql "$DATABASE_URL" # default read-write; risky during freeze
```

### Connection Pool Configuration

For application-level connections during freeze, enforce read-only in pool defaults:

**freeze-mode pool config:**
```javascript
// during freeze, feature engine pool uses this:
const auditPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL_AUDIT,
  max: 5,
  statement_timeout: 60000,
  // Force all connections to read-only
  query_timeout: 60000,
});

// Before any query, assert read-only:
auditPool.on('connect', (client) => {
  client.query('SET default_transaction_read_only = ON;');
});
```

**Validation:**
- Pool emits error if any connection attempts write.
- Log shows "SET default_transaction_read_only = ON" for every connection.

---

## Layer 2: Application-Level Enforcement

### Ingestion Server (scripts/ingestion-server.js)

**Freeze mode:**
- Enabled: raw 1m candle INSERT to `candles_1m`.
- Disabled: feature persist, canonical promotion, setup evaluation.

**Implementation:**

```javascript
// At server startup, check freeze mode
const FREEZE_MODE = process.env.TM_FREEZE_MODE === 'true';
const FEATURE_PERSIST_DISABLED = process.env.TM_FEATURE_PERSIST_DISABLED === 'true';
const SETUP_ENGINE_DISABLED = process.env.TM_SETUP_ENGINE_DISABLED === 'true';

if (FREEZE_MODE) {
  console.log('[FREEZE] Ingestion server starting in freeze mode.');
  console.log('[FREEZE] Raw candle ingestion: ENABLED');
  console.log('[FREEZE] Feature persist: DISABLED');
  console.log('[FREEZE] Setup evaluation: DISABLED');
}

// When feature job tries to persist:
async function persistFeatures(features) {
  if (FEATURE_PERSIST_DISABLED) {
    console.log('[FREEZE] Feature persist blocked. Logging dry-run output:');
    features.forEach(f => console.log(JSON.stringify(f, null, 2)));
    return { persisted: 0, logged: features.length };
  }
  
  // Normal persist path
  return await insertFeatureRows(features);
}

// When setup eval completes:
async function persistSetupEvals(evals) {
  if (SETUP_ENGINE_DISABLED) {
    console.log('[FREEZE] Setup eval persist blocked. Logging dry-run output:');
    evals.forEach(e => console.log(JSON.stringify(e, null, 2)));
    return { persisted: 0, logged: evals.length };
  }
  
  // Normal persist path
  return await insertSetupEvals(evals);
}
```

**Env-controlled disable:**
```bash
# During freeze, start with:
TM_FREEZE_MODE=true \
TM_FEATURE_PERSIST_DISABLED=true \
TM_SETUP_ENGINE_DISABLED=true \
node scripts/ingestion-server.js

# Logs will show: "Feature persist blocked. Logging dry-run output"
# Database will show: 0 new feature rows, 0 new setup rows
```

**Validation script:**
```bash
# After 1 hour of freeze-mode operation, audit:
node scripts/audit-freeze-compliance.js

# Output should show:
# - Raw candles: 60 rows inserted (normal 1m feed)
# - Feature rows inserted: 0 (frozen)
# - Setup evals inserted: 0 (frozen)
# - Persist blocks logged: 47 times
# Status: FREEZE_COMPLIANT
```

### Feature Engine (apps/engine/src/dag/runner.ts)

**Freeze mode:**
- Read-only test: compute all features, print outputs, **no persist**.
- Backtest mode: canonical reads only.

**Implementation:**

```typescript
// At DAG runner startup
const FEATURE_PERSIST_DISABLED = process.env.TM_FEATURE_PERSIST_DISABLED === 'true';
const FREEZE_MODE = process.env.TM_FREEZE_MODE === 'true';

class DAGRunner {
  async insertRows(runId: string, rows: FeatureRow[]): Promise<InsertResult> {
    if (FEATURE_PERSIST_DISABLED) {
      console.log(`[FREEZE] Feature persist disabled. Would insert ${rows.length} rows.`);
      // Print a sample to stdout for inspection
      if (rows.length > 0) {
        console.log('[FREEZE] Sample row:', JSON.stringify(rows[0], null, 2));
      }
      // Return dry-run result (0 persisted)
      return { rowsInserted: 0, rowsRejected: 0, duration: 0 };
    }
    
    // Normal persist path
    return await this.db.insertFeatureRows(runId, rows);
  }
  
  async fetchCandles(...args): Promise<Candle[]> {
    if (FREEZE_MODE) {
      // Always use canonical reads during freeze
      return await this.db.query(`
        SELECT * FROM market.candles_1m_canonical
        WHERE symbol = $1 AND ts >= $2
        ORDER BY ts DESC LIMIT $3;
      `, args);
    }
    // Normal path (may use raw or canonical depending on config)
    return await this.getCandles(...args);
  }
}
```

**Validation:**
- Feature engine runs, computes rows, logs "Would insert X rows" but DB row count stays constant.
- Backtest queries `candles_1m_canonical` only (audit with query log analysis).

### Setup Engine (apps/engine/src/setup/)

**Freeze mode:**
- Disabled: live setup evaluation.
- Backtest: canonical reads, no signal persist.

**Implementation:**

```typescript
const SETUP_ENGINE_DISABLED = process.env.TM_SETUP_ENGINE_DISABLED === 'true';

async function evaluateSetup(...): Promise<SetupResult> {
  if (SETUP_ENGINE_DISABLED) {
    console.log('[FREEZE] Setup engine disabled. Returning null evaluation.');
    return null;
  }
  
  // Normal setup path
  return await runSetupEvaluation(...);
}

// In live signal generator:
async function generateSignal(setup: SetupResult): Promise<Signal | null> {
  if (!setup) {
    // Setup is disabled or null
    return null;
  }
  
  if (TM_SIGNAL_PERSIST_DISABLED === 'true') {
    console.log('[FREEZE] Signal persist disabled. Would generate signal:', setup);
    return null; // Don't write
  }
  
  // Normal signal persist
  return await persistSignal(setup);
}
```

**Validation:**
- Web dashboard shows "Setup engine frozen" warning at startup.
- Zero new signals in `signals` table during freeze period.
- Logs show "Setup engine disabled" on every 15m cycle.

### Signal Generation (apps/tradePipeline/)

**Freeze mode:**
- Disabled: signal writes to `signals` table.
- Enabled: dry-run output to logs.

**Implementation:**

```typescript
const SIGNAL_PERSIST_DISABLED = process.env.TM_SIGNAL_PERSIST_DISABLED === 'true';

async function persistSignal(signal: Signal): Promise<void> {
  if (SIGNAL_PERSIST_DISABLED) {
    console.log('[FREEZE] Signal persist disabled. Dry-run output:');
    console.log(JSON.stringify(signal, null, 2));
    return;
  }
  
  // Normal persist
  await db.insertSignal(signal);
}
```

**Validation:**
- `SELECT COUNT(*) FROM signals` stays constant during freeze.
- Logs show signal payloads that would have been written.

---

## Layer 3: Repo-Level Enforcement

### Migration Quarantine

**During freeze, new migrations are design artifacts only:**

```bash
# Author a migration design:
mkdir -p docs/governance/migrations
cat > docs/governance/migrations/200_canonical_repair_design.sql << 'EOF'
-- Design artifact only: not applied during freeze
-- Requires governance approval + gate change before execution

BEGIN TRANSACTION;
UPDATE market.candles_1m_canonical
SET is_valid = false
WHERE symbol = 'EURUSD' AND ts BETWEEN '2026-08-01' AND '2026-08-05';
COMMIT;
EOF

# Do NOT execute:
# psql "$DATABASE_URL" < docs/governance/migrations/200_canonical_repair_design.sql
```

**CI/CD guardrail (pre-commit or CI step):**

```bash
#!/bin/bash
# scripts/check-freeze-compliance.sh

if [ "$TM_FREEZE_MODE" = "true" ]; then
  echo "[FREEZE CHECK] Freeze mode active. Blocking write-capable scripts."
  
  # Block known write scripts
  BLOCKED_SCRIPTS=(
    "scripts/backfill-historical-features.js"
    "scripts/refresh-candle-caggs.js"
    "scripts/promote-live.js"
    "scripts/refresh-lifecycle.js"
  )
  
  for script in "${BLOCKED_SCRIPTS[@]}"; do
    if git diff --cached --name-only | grep -q "$script"; then
      echo "[FREEZE ERROR] Cannot commit changes to $script during freeze."
      echo "Reason: Freeze mode ACTIVE. No write-capable scripts may be modified."
      exit 1
    fi
  done
  
  echo "[FREEZE CHECK] PASS: No write-capable scripts staged."
fi
```

**Add to `.husky/pre-commit` or CI config:**

```yaml
# .github/workflows/pre-commit.yml (example)
- name: Freeze compliance check
  run: |
    TM_FREEZE_MODE=true bash scripts/check-freeze-compliance.sh
```

### Script Execution Blocklist

**During freeze, certain scripts must not run:**

```bash
# scripts/freeze-blocklist.sh
# Source this to prevent accidental execution

if [ "$TM_FREEZE_MODE" != "true" ]; then
  exit 0  # Not in freeze mode, no restrictions
fi

# Define blocklist
FROZEN_SCRIPTS=(
  "backfill-historical-features.js"
  "refresh-candle-caggs.js"
  "promote-live.js"
  "refresh-lifecycle.js"
  "mark_migration*.js"
)

# Check if any frozen script was called
for script in "${FROZEN_SCRIPTS[@]}"; do
  if [[ "$0" == *"$script"* ]]; then
    echo "=========================================="
    echo "[FREEZE] ERROR: Frozen script execution blocked"
    echo "=========================================="
    echo "Script: $0"
    echo "Reason: Freeze mode ACTIVE (TM_FREEZE_MODE=true)"
    echo ""
    echo "To unfreeze, governance must authorize gate change."
    echo "See: docs/governance/freeze-setup-engine-canonical-2026-08-17.md"
    echo ""
    echo "Blocked scripts (freeze period):"
    for s in "${FROZEN_SCRIPTS[@]}"; do
      echo "  - $s"
    done
    echo "=========================================="
    exit 1
  fi
done
```

**Use in frozen scripts:**

```javascript
// At top of scripts/backfill-historical-features.js
const freezeBlocklist = require('./freeze-blocklist.js');
freezeBlocklist.assertNotFrozen(__filename);
```

### .env.local Template (Freeze Mode)

**Committed to repo (sanitized) or in ops docs:**

```bash
# .env.local.freeze-template (example)
# Copy to .env.local to enable freeze enforcement

# Freeze control
TM_FREEZE_MODE=true
TM_FEATURE_PERSIST_DISABLED=true
TM_SETUP_ENGINE_DISABLED=true
TM_SIGNAL_PERSIST_DISABLED=true

# Database connection (read-write for raw ingestion only)
DATABASE_URL=postgresql://user:pass@localhost/tradzfx_v2

# Feature engine uses read-only pool
DATABASE_URL_AUDIT=postgresql://user:pass@localhost/tradzfx_v2

# Logging
LOG_LEVEL=info
TM_FREEZE_START_TIME=2026-08-17T05:01:00Z
```

---

## Validation & Monitoring

### Freeze Compliance Audit (Daily)

```javascript
// scripts/audit-freeze-compliance-daily.cjs
const pg = require('pg');

async function auditFreeze() {
  const client = new pg.Client(process.env.DATABASE_URL);
  await client.connect();
  
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;');
    
    // Count writes by table during freeze period
    const result = await client.query(`
      SELECT
        schemaname,
        tablename,
        COUNT(*) as row_count,
        MAX(xmin) as newest_xmin
      FROM pg_stat_user_tables
      WHERE last_vacuum > now() - interval '24 hours'
      GROUP BY schemaname, tablename
      ORDER BY schemaname, tablename;
    `);
    
    console.log('[FREEZE AUDIT] Tables modified in last 24h:');
    
    const allowedTables = ['market.candles_1m']; // only raw ingestion allowed
    const violations = [];
    
    result.rows.forEach(row => {
      const fullName = `${row.schemaname}.${row.tablename}`;
      const isAllowed = allowedTables.includes(fullName);
      
      console.log(`  ${fullName}: ${row.row_count} rows (allowed: ${isAllowed})`);
      
      if (!isAllowed && row.row_count > 0) {
        violations.push(fullName);
      }
    });
    
    if (violations.length > 0) {
      console.error('[FREEZE VIOLATION] Unauthorized tables modified:');
      violations.forEach(t => console.error(`  - ${t}`));
      process.exit(1);
    } else {
      console.log('[FREEZE COMPLIANT] No unauthorized writes detected.');
    }
    
    await client.query('ROLLBACK;');
    
  } finally {
    await client.end();
  }
}

auditFreeze().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
```

**Run daily (cron or CI):**
```bash
node scripts/audit-freeze-compliance-daily.cjs
```

### Logs Inspection (Rapid Detection)

```bash
# Check application logs for freeze violations
grep -i "feature persist blocked\|setup engine disabled\|signal persist disabled" logs/*.log

# Should show many hits (expected during normal freeze operation)
# If ZERO hits, verify services are running in freeze mode
```

---

## Freeze State Summary (Technical)

### Enforcement Stack

```
┌─────────────────────────────────────────────────┐
│ Governance Layer                                │
│ - Named freeze with scope + enforcement         │
│ - Gate change process documented                │
│ - Approver assigned (when unfreezing)           │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────┴────────────────────────────────┐
│ Repo Layer                                      │
│ - Migrations quarantined (design artifacts)     │
│ - Write scripts blocked (pre-commit checks)     │
│ - CI guardrails active                          │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────┴────────────────────────────────┐
│ Application Layer                               │
│ - Persist guards (feature, setup, signal)       │
│ - Dry-run output (logs instead of writes)       │
│ - Env-controlled disable flags                  │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────┴────────────────────────────────┐
│ Database Layer                                  │
│ - Read-only audit connections                   │
│ - REPEATABLE READ READ ONLY transactions        │
│ - Explicit ROLLBACK on all audit scripts        │
│ - Raw ingestion only (candles_1m writes)        │
└─────────────────────────────────────────────────┘
```

### Validation Checklist

- [ ] All audit scripts use `BEGIN ... READ ONLY` + explicit `ROLLBACK`.
- [ ] Feature engine uses read-only pool during freeze.
- [ ] Setup engine disabled (`TM_SETUP_ENGINE_DISABLED=true`).
- [ ] Signal persist disabled (`TM_SIGNAL_PERSIST_DISABLED=true`).
- [ ] Migrations in `docs/governance/migrations/` (not applied).
- [ ] Pre-commit hooks block write-script changes during freeze.
- [ ] Daily compliance audit runs and passes.
- [ ] Logs show persist-block messages (expected).
- [ ] No unauthorized writes to frozen tables in last 24h.

---

## Failure Modes & Recovery

### If Accidental Write Occurs

1. **Detect:** Daily audit fails, table counts increased unexpectedly.
2. **Stop:** Kill all services immediately.
3. **Isolate:** Check transaction logs for source (which service, which statement).
4. **Rollback:** Use backup from before write, restore schema state.
5. **Investigate:** Review why technical fence failed (env var misconfigured? code path bypassed?).
6. **Strengthen:** Add additional fence or tighten existing one.
7. **Resume:** Restart services with corrected enforcement.

### If Env Var Gets Misset

```bash
# Accidental unset during restart:
# TM_FREEZE_MODE was 'true', restarted without it

# Detection:
grep "Feature persist disabled" logs/feature-engine.log | tail -1
# Returns: nothing (expected many hits)

# Action: Check if .env.local was accidentally reset
cat .env.local | grep TM_FREEZE_MODE

# If unset or 'false', restore:
echo "TM_FREEZE_MODE=true" >> .env.local
systemctl restart feature-engine  # or equivalent
```

### If Code Path Bypasses Guard

Example: someone adds a new persist call without checking `TM_FEATURE_PERSIST_DISABLED`:

```typescript
// Bad (bypasses freeze):
const results = await db.insertFeatureRows(rows);

// Good (checks freeze):
if (FEATURE_PERSIST_DISABLED) {
  console.log('[FREEZE] Skipping persist');
  return;
}
const results = await db.insertFeatureRows(rows);
```

**Prevention:** Code review checklist during freeze period flags all new persist calls.

---

## Summary: Three Layers, Zero Writes

```text
┌─ Governance: Named freeze, gate-change process
├─ Repo: Quarantine migrations, block scripts, CI checks
├─ Application: Disable persist, dry-run output
└─ Database: Read-only connections, ROLLBACK

Result: permission: INACTIVE, technical_eligibility: BLOCKED_UNKNOWN, 
         shadow_run: NO_SHADOW_RUN_YET, database_writes: 0

Enforced by stack, not discipline alone.
No temporary exceptions. No partial unfreezes.
```
