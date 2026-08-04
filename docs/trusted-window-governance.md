# Trusted-window governance

Trusted-window discovery stays read-only by default.

Calendar continuity has two enforced checks:

1. `packages/shared/src/utils/marketCalendar.ts` exposes `classifyCandleGap()`.
2. `market.classify_candle_gap()` is canonical for SQL discovery.
3. `pnpm calendar:parity` compares both implementations against a fixed matrix.
4. `scripts/discover-trusted-windows.js --write` refuses unless
   `--parity-confirmed` is supplied after parity passes.
5. `scripts/evaluate-trusted-window-detector.js` treats `spread = 0` as
   unresolved provenance evidence.

Safe sequence:

```text
pnpm calendar:parity
node scripts/discover-trusted-windows.js --symbols=XAUUSD,EURUSD,USDJPY --write --parity-confirmed
```

Candidate rows remain `status='candidate'`. Promotion requires separate manual
review. Any canonical row with `spread = 0` is treated as unresolved spread
evidence, not as an observed zero spread; detector evaluation blocks promotion
until policy explicitly classifies those rows. Do not activate detector v3 or
approve quarantine evidence as part of discovery. For `DXY`, synchronized
component jumps are reported as `synthetic_boundary_unresolved`; formula
agreement does not make such boundaries trusted because they may represent a
component-feed reset.