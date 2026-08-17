# EMAIL TEMPLATE: BOARD CHAIR TO BOARD MEMBERS
**Send this week (3 days before target session date)**

---

## EMAIL

**To:** [Board Members]  
**From:** [Chair Name]  
**Subject:** Board Session: tradzfx-v2 Governance Preconditions Review (90 minutes, [DATE] [TIME] UTC)  
**Attachments:** 
- BOARD_READY_GOVERNANCE_PACKAGE_SUMMARY_2026-08-17.pdf
- EXECUTIVE_BRIEFING_READY_FOR_BOARD_REVIEW.pdf
- BOARD_DECISION_CHECKLIST_READY_FOR_SIGNATURE_2026-08-17.pdf

---

### Body

Dear Board Members,

I'm scheduling a **90-minute board session** to review the tradzfx-v2 governance preconditions package and vote on **16 specific decisions** that unblock Phase 1 execution.

**Session Details:**
- **Date & Time:** [INSERT DATE], [INSERT TIME] UTC
- **Duration:** 90 minutes (executable agenda, no overruns)
- **Attendees:** Board + CTO + Architect
- **Decision Required:** All 16 decisions must = YES to authorize Phase 1
- **Outcome:** If approved, Phase 1 begins within 4 hours

**What You're Reviewing:**

Engineering has completed all technical preconditions:
- **3-layer fail-closed enforcement** proven end-to-end (database, app, backtest)
- **Detector v3-robust canonicalized** with 0.0000026% error rate
- **Canonical path traced** from ingestion through consumption
- **Feature lineage documented** (6-tier DAG, immutability per tier)
- **Phase 1 operationally locked** (5 go/no-go gates, 49–65h timeline)
- **Freeze maintained** (zero production writes, permissions inactive)

The **16 decisions** fall into 4 categories:
- **Decisions 1–4:** Detector governance (v3 canonical, v4 freeze, audit scope, migration path)
- **Decisions 5–8:** Canonical path (fail-closed contract, broker immutability, quarantine semantics, docs)
- **Decisions 9–12:** Feature lineage (DAG completeness, immutability proof, backfill procedures, docs)
- **Decisions 13–16:** Unfreeze (preconditions sufficiency, Phase 1 gates, board oversight, 49–65h timeline)

**Materials:**

Please read the 3 attached PDFs **before the session** (15 minutes total):

1. **BOARD_READY_GOVERNANCE_PACKAGE_SUMMARY_2026-08-17.pdf** (5 min)
   - What we built, why it matters, what we're asking approval for

2. **EXECUTIVE_BRIEFING_READY_FOR_BOARD_REVIEW.pdf** (5 min)
   - Board-level talking points, risk summary, upsides

3. **BOARD_DECISION_CHECKLIST_READY_FOR_SIGNATURE_2026-08-17.pdf** (5 min)
   - The 16 decisions with YES/NO/DEFER options and signature lines
   - Print this and bring to the session

**Session Workflow (90 minutes):**

| Time | Activity |
|------|----------|
| 0:00–0:05 | **Opening:** CTO presents executive briefing |
| 0:05–0:10 | **Architecture:** Architect summarizes board package |
| 0:10–0:40 | **Q&A:** Board discusses, asks questions |
| 0:40–0:45 | **Voting:** Mark all 16 decisions (YES/NO/DEFER) |
| 0:45–0:50 | **Review & Authorization:** If all 16 = YES, chair signs checklist and authorizes CTO |
| 0:50–1:30 | **Buffer:** Deep discussions, if needed |

**Decision Gate:**
- **If all 16 = YES:** Phase 1 authorized. CTO begins within 4 hours.
- **If any = NO or DEFER:** Freeze continues. Board revisits in 1 week.

**Timeline (If Approved):**

```
Session day:     Board votes → CTO authorization (5 min)
Within 4 hours:  Preflight + backfill + worker enable (XAUUSD shadow)
24–48 hours:     Quality checkpoints collected
Within 65 hours: Phase 2 board decision (if Phase 1 passes)
2–3 weeks total: Full production rollout (if all phases pass)
```

**Risk Posture:**

Phase 1 is single-symbol shadow evaluation under board oversight:
- Worker on XAUUSD only; live signals blocked
- Raw candles immutable; no production impact if Phase 1 fails
- 6 quality checkpoints in 24–48 hours provide early visibility
- Freeze reversible at any point; no permanent writes

---

### Calendar Invite

**Title:** Board Session: tradzfx-v2 Governance Preconditions (90 min)  
**Date:** [INSERT DATE]  
**Time:** [INSERT TIME] UTC  
**Duration:** 90 minutes  
**Attendees:** [Board members] + CTO + Architect  
**Description:**

```
Board session to review and vote on 16 governance preconditions for tradzfx-v2 Phase 1 execution.

Agenda: 5-min briefing + 5-min summary + 30-min Q&A + 5-min voting = 45 min core, 45 min buffer

Materials (read before session):
- BOARD_READY_GOVERNANCE_PACKAGE_SUMMARY_2026-08-17.pdf
- EXECUTIVE_BRIEFING_READY_FOR_BOARD_REVIEW.pdf
- BOARD_DECISION_CHECKLIST_READY_FOR_SIGNATURE_2026-08-17.pdf

Decision: All 16 = YES to authorize Phase 1; any NO/DEFER = freeze continues.

If approved: Phase 1 begins within 4 hours. Phase 2 decision in 65 hours.
```

---

### Follow-Up (If You Need More Detail)

If any board member wants deeper technical context before the session, share these (in docs/governance/ or root):

- **CANONICAL_PATH_TRACE_END_TO_END_2026-08-17.md** (900+ lines, end-to-end proof)
- **FEATURE_LINEAGE_MAP_END_TO_END_2026-08-17.md** (1000+ lines, 6-tier DAG)
- **DETECTOR_DECISION_MATRIX_2026-08-17.md** (detector governance)
- **12-file detector audit** (5,900+ lines, comprehensive analysis)

---

## TIMING CRITICAL

**Board decision deadline:** 2 weeks from now (2026-08-31)

Rationale: The freeze governance package is validated as of 2026-08-17. If the board session slips beyond 2 weeks, the technical snapshot ages—market conditions, feature producer runs, and candle coverage will have drifted—and parts of the governance audit may need revalidation. 

**Recommendation:** Schedule the session for this week or early next week to avoid re-auditing in Phase 2.

---

## SEND THIS EMAIL

Copy the template above, fill in dates/times, attach the 3 PDFs, and send to board members **3 days before the target session date**.

**Chair's only remaining actions:**
1. ✅ Read the 3 PDFs (15 min)
2. ✅ Print the checklist (2 min)
3. ✅ Schedule the 90-min session (this week)
4. ✅ Send this email to board members (this week)
5. ✅ Run the 90-min session using BOARD_SESSION_RUNBOOK_2026-08-17.md (follow exactly)
6. ✅ Mark all 16 decisions on the checklist (during session)
7. ✅ If all YES: Email CTO authorization (within 5 min of session end)

Everything else is ready.

---

**Template Created:** 2026-08-17 06:54 UTC  
**Status:** Ready to copy, personalize, and send  
**Next Step:** Chair sends this email to board members this week
