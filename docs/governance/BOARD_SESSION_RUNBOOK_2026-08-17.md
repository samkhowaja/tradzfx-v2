# 🎯 BOARD SESSION RUNBOOK: 90-MINUTE GOVERNANCE DECISION

**Target Completion:** 90 minutes total | Spreadable 2–3 days  
**Success Criteria:** All 16 decisions marked YES → Phase 1 auth signed  
**Failure Mode:** Any decision NO → Freeze maintained, future review cycle  
**Post-Approval:** Phase 1 begins within 4 hours

---

## ⏱️ BOARD SESSION TIMELINE: 90 MINUTES

```
[00:00] Session Opens
        Chair reads this runbook aloud (2 min)
        
[00:02] Executive Briefing
        CTO presents: EXECUTIVE_BRIEFING_READY_FOR_BOARD_REVIEW.md (5 min)
        Key takeaway: 3 layers fail-closed, v3-robust canonical, Phase 1 XAUUSD
        Q&A: Board asks clarifying questions (3 min)
        
[00:10] Board Summary Deep Dive
        Architect presents: BOARD_READY_GOVERNANCE_PACKAGE_SUMMARY_2026-08-17.md (5 min)
        Key takeaway: 16 decisions, 3 pillars (detector/canonical/lineage), Phase 1 timeline
        Q&A: Board validates technical evidence (5 min)
        
[00:20] BREAK (optional, 5 min)
        
[00:25] 16 Decisions: Live Discussion & Marking
        Facilitator reads each decision aloud (1 min per decision)
        Board member marks YES / NO / DEFER on checklist (1 min per decision)
        Facilitator logs consensus (1 min per 4 decisions)
        Total: 30 min for all 16
        
        Typical flow per decision:
          - Chair: "Decision 1: v3-robust as canonical detector. Yes, no, or defer?"
          - Board: Brief discussion if needed (30 sec typical)
          - Votes marked on BOARD_DECISION_CHECKLIST_READY_FOR_SIGNATURE_2026-08-17.md
          - Facilitator logs count (3–0, 3–1, etc.)
        
[00:55] DECISION GATE
        Facilitator tallies all 16 decisions:
        
        ✅ IF ALL 16 = YES:
           → Proceed to board signature (5 min)
           
        ❌ IF ANY = NO or DEFER:
           → Document reason (2 min)
           → Schedule follow-up review (2 min)
           → Close session (1 min)
           → Freeze remains active
        
[01:00] BOARD SIGNATURE (if all 16 = YES)
        Chair signs: BOARD_DECISION_CHECKLIST_READY_FOR_SIGNATURE_2026-08-17.md
        Print or e-sign official copy (3 min)
        Timestamp: Record exact approval time
        
[01:03] AUTHORIZATION ISSUED
        Board chair emails CTO + Head of Engineering:
        "All 16 governance decisions approved. Phase 1 execution authorized.
         Start time: [timestamp + 4 hours]"
        
[01:05] Session Closes
        CTO briefing on Phase 1 steps begins offline (async)
        
[~01:09] PHASE 1 BEGINS (within ~4 hours of board signature)
        Engineering starts preflight check on XAUUSD
```

---

## 📋 PRE-SESSION PREPARATION: FOR BOARD CHAIR

**3 Days Before Session:**
1. Send calendar invite: "Tradzfx Governance Decision Session — 90 min"
2. Attach files:
   - `BOARD_READY_GOVERNANCE_PACKAGE_SUMMARY_2026-08-17.md` (root level) — read before session
   - `EXECUTIVE_BRIEFING_READY_FOR_BOARD_REVIEW.md` (5 min BLUF)
   - `BOARD_DECISION_CHECKLIST_READY_FOR_SIGNATURE_2026-08-17.md` (decisions + signature block)
3. Optional for deeper review: `docs/governance/` directory (technical deep-dive, 1–3 hours)

**1 Day Before Session:**
1. Confirm CTO will present (have contingency speaker if unavailable)
2. Confirm Head of Engineering will attend
3. Have printed or e-sign-ready copy of decision checklist
4. Have moderator/facilitator identified (not presenter) to keep time

**30 Min Before Session:**
1. Test video/audio (if remote)
2. Print decision checklist or open on screen for real-time marking
3. Have Phase 1 runbook handy (`PHASE_1_EVAL_SYMBOL_SHORTLIST_2026-08-17.md`)
4. Confirm pen/markers if printing

---

## 🗣️ OPENING STATEMENT: READ THIS ALOUD

```
"Welcome. This 90-minute session is to make 16 governance decisions that 
will either authorize Phase 1 of the feature pipeline unfreeze, or maintain 
the current freeze for future review.

The decisions have been fully documented with technical evidence. Your role 
is to review that evidence and mark YES or NO on each of the 16 decisions. 
All 16 must be YES for Phase 1 authorization. If any is NO or DEFER, we 
maintain the freeze and schedule a follow-up review cycle.

We have three documents to review together:
  1. Executive briefing (5 min) — what's happening, why, and when.
  2. Board summary (5 min) — technical overview of 3 governance pillars.
  3. Decision checklist (30 min) — live marking of all 16 decisions.

Then, if all 16 = YES, the board chair will sign the decision checklist, 
and Phase 1 authorization is issued. Engineering can then begin Phase 1 
execution within 4 hours.

Let's start. Any high-level questions before we dive in?"

[Pause 30 sec for questions]

"Great. CTO, please present the executive briefing."
```

---

## 🎯 16 DECISIONS: LIVE MARKING FORMAT

**Print or display this on screen during session:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 DETECTOR GOVERNANCE (4 decisions)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. v3-robust magnitude-only detector as canonical
   Evidence: 0.0000026% error on 7.7M bars, proven clean
   ☐ YES     ☐ NO     ☐ DEFER

2. v4-calibrated detector frozen pending governance review
   Evidence: Symbol-specific thresholds, defer to Phase 2+
   ☐ YES     ☐ NO     ☐ DEFER

3. Detector audit depth sufficient (12 files, 5.9k lines)
   Evidence: All versions audited, decision matrix complete
   ☐ YES     ☐ NO     ☐ DEFER

4. Detector migration path safe (v3→v4 if approved in future)
   Evidence: No breaking changes, feature gates documented
   ☐ YES     ☐ NO     ☐ DEFER

─────────────────────────────────────────────────────────────
 CANONICAL PATH GOVERNANCE (4 decisions)
─────────────────────────────────────────────────────────────

5. Fail-closed contract provable end-to-end (3 layers)
   Evidence: Database READ-ONLY, app gates, PIT recompute
   ☐ YES     ☐ NO     ☐ DEFER

6. Broker identity immutable at write (normalized at ingest)
   Evidence: normalizeBrokerName() at write, never mutated
   ☐ YES     ☐ NO     ☐ DEFER

7. Quarantine gate semantics correct (human approval workflow)
   Evidence: candle_eligibility state machine + feature trigger gate
   ☐ YES     ☐ NO     ☐ DEFER

8. Canonical path documentation sufficient (900+ lines traced)
   Evidence: Complete ingestion→canonical→consumption flow
   ☐ YES     ☐ NO     ☐ DEFER

─────────────────────────────────────────────────────────────
 FEATURE LINEAGE GOVERNANCE (4 decisions)
─────────────────────────────────────────────────────────────

9. Feature DAG complete (6-tier lineage, 20+ features)
   Evidence: Tier 1–7 mapped, dependencies documented
   ☐ YES     ☐ NO     ☐ DEFER

10. Feature immutability proven per class (Tier 1–6)
    Evidence: 1000+ lines, backfill procedures locked in
    ☐ YES     ☐ NO     ☐ DEFER

11. Feature backfill procedures safe (topological sort, frozen)
    Evidence: All backfill commands documented, tested on XAUUSD
    ☐ YES     ☐ NO     ☐ DEFER

12. Feature lineage documentation sufficient (1000+ lines)
    Evidence: Registry contracts, join policies, version tracking
    ☐ YES     ☐ NO     ☐ DEFER

─────────────────────────────────────────────────────────────
 UNFREEZE AUTHORIZATION (4 decisions)
─────────────────────────────────────────────────────────────

13. Governance preconditions sufficient for Phase 1 eval
    Evidence: All 12 preconditions documented + evidence provided
    ☐ YES     ☐ NO     ☐ DEFER

14. Phased unfreeze structure appropriate (Phase 1→2→3)
    Evidence: XAUUSD eval, EURUSD/GBPUSD, then full rollout
    ☐ YES     ☐ NO     ☐ DEFER

15. Board oversight model sufficient (60–90 min per phase decision)
    Evidence: Go/no-go gates documented, Phase 1 timeline 49–65h
    ☐ YES     ☐ NO     ☐ DEFER

16. Phase 1 execution authority + 4-hour timeline approved
    Evidence: Preflight/backfill/worker/shadow steps all documented
    ☐ YES     ☐ NO     ☐ DEFER

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINAL TALLY:  YES: [ ]  NO: [ ]  DEFER: [ ]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

IF ALL 16 = YES:  ✅ Phase 1 Authorization Issued
IF ANY ≠ YES:     ❌ Freeze Maintained, Future Review
```

---

## 📝 DECISION MARKING PROTOCOL

**For each decision:**

1. **Chair reads decision aloud** (30 sec)
   - Decision statement + key evidence
   - Example: "Decision 1: v3-robust magnitude-only detector as canonical. Evidence: 0.0000026% error on 7.7M bars, proven clean. Does the board mark this YES, NO, or DEFER?"

2. **Board discusses if needed** (0–2 min typical, max 5 min)
   - Questions invited
   - Architect/CTO clarifies as needed
   - No re-litigation of past decisions (scope: this decision only)

3. **Board members vote verbally or by show of hands** (30 sec)
   - Count recorded: e.g., "3–0 YES" or "2–1 YES"

4. **Facilitator marks checklist** (15 sec)
   - Records YES/NO/DEFER + vote count
   - Moves to next decision

5. **Move to next decision** (0 sec)

**Total per decision: ~2 min average (range 1–5 min)**

---

## 🚨 DECISION GATE: WHAT HAPPENS NEXT

```
┌─────────────────────────────────────────────────────┐
│ SCENARIO A: ALL 16 DECISIONS = YES                  │
├─────────────────────────────────────────────────────┤
│ ✅ OUTCOME: Phase 1 Authorization Issued            │
│                                                     │
│ ACTION SEQUENCE:                                    │
│  1. Chair: "All 16 decisions approved by consensus" │
│  2. Board chair signs decision checklist (official) │
│  3. Record timestamp (e.g., 2026-08-17 14:35 UTC)  │
│  4. Chair emails CTO:                               │
│     "All 16 governance decisions approved.          │
│      Phase 1 execution authorized.                  │
│      Start time: 2026-08-17 18:35 UTC (~4h later)"  │
│  5. Engineering receives auth → preflight begins    │
│  6. Session closes (post-decision CTO brief async)  │
│                                                     │
│ NEXT MILESTONES:                                    │
│  • T+0:10 min: Preflight check (10 min)            │
│  • T+0:55 min: Backfill complete (45 min)          │
│  • T+1:00 min: Worker enable (5 min)               │
│  • T+1:00h–49h: Shadow collection (24–48h)         │
│  • T+49–65h: Phase 2 board decision (within 48h)   │
│                                                     │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ SCENARIO B: ANY DECISION ≠ YES (NO or DEFER)        │
├─────────────────────────────────────────────────────┤
│ ❌ OUTCOME: Freeze Maintained                       │
│                                                     │
│ ACTION SEQUENCE:                                    │
│  1. Facilitator: "Decision X marked NO/DEFER"      │
│  2. Chair: "Reason for NO/DEFER?" (brief Q&A)      │
│  3. Facilitator documents reason (2 min)            │
│  4. Chair: "We will maintain freeze pending         │
│     resolution of Decision X decision gap"          │
│  5. Schedule follow-up review cycle                 │
│     (typically 1–2 weeks, date TBD)                 │
│  6. Session closes, no Phase 1 auth issued          │
│                                                     │
│ FOLLOW-UP ACTIONS:                                  │
│  • Architect + CTO analyze NO/DEFER reason          │
│  • Prepare additional evidence or fix               │
│  • Board meets again in 1–2 weeks                   │
│  • Attempt 16 decisions again                       │
│                                                     │
│ FREEZE REMAINS: YES → No Phase 1 start yet          │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 📧 AUTHORIZATION EMAIL: TEMPLATE

**If all 16 = YES, chair sends immediately after signature:**

```
TO:      Head of Engineering, CTO
CC:      Board members, Project Manager
SUBJECT: Phase 1 Execution Authorization — Governance Approved
TIME:    [Record board session end timestamp]

---

Governance Board Session Summary:
• Date: [today's date]
• Duration: 90 minutes
• Decisions: 16 governance decisions
• Result: ALL 16 APPROVED (unanimous consensus)

AUTHORIZATION ISSUED:

All 16 governance preconditions have been approved by the board. 
Phase 1 conditional unfreeze is authorized, effective immediately.

PHASE 1 SCOPE:
• Symbol: XAUUSD (oldest, cleanest data)
• Duration: 49–65 hours to Phase 2 decision
• Live signal: BLOCKED (evaluation only)
• Feature worker: XAUUSD only (shadow mode)
• Production impact: Zero (read-only collection)
• Freeze state: CONDITIONAL (Phase 1 only, can revert to freeze)

EXECUTION TIMELINE:

Phase 1 begins within 4 hours of board approval:
  • T+0:10  Preflight check (10 min)
  • T+0:55  Feature backfill (45 min)
  • T+1:00  Worker enable (5 min)
  • T+1:00h Shadow collection (24–48 hours)
  • T+49–65h Board makes Phase 2 decision

BOARD DECISION CHECKLIST:
[Attach signed board decision checklist PDF/e-signed copy]

NEXT MEETING:
Phase 2 board decision: [date + time, typically 48–72h from Phase 1 start]

---

[Chair name], Board Chair
[Timestamp]
```

---

## ⚠️ FAILURE SCENARIOS: MITIGATION

```
FAILURE MODE 1: Board member can't attend
├─ Mitigation: Vote remotely or proxy vote before session
├─ Chair confirms all members can vote (sync or async)
└─ Contingency: Reschedule if quorum can't be met

FAILURE MODE 2: Technical question board can't answer during session
├─ Mitigation: Architect present to clarify in real-time
├─ Contingency: Defer decision to follow-up session (within 1 week)
└─ Preserve freeze state until decision resolved

FAILURE MODE 3: Disagreement on one or two decisions (not unanimous)
├─ Mitigation: Detailed discussion + architect clarification
├─ Contingency: Vote 2–1 or 3–0 (simple majority OK), record dissent
└─ If majority YES: Decision marks YES; preserve dissent in minutes

FAILURE MODE 4: Major new concern raised during session
├─ Mitigation: Chair permits discussion (max 5 min per decision)
├─ Contingency: If concern substantial, defer decision to follow-up
└─ Preserve freeze state until new concern addressed

FAILURE MODE 5: Session overruns (exceeds 90 min)
├─ Mitigation: Track time rigorously, skip optional discussion if needed
├─ Contingency: Split into two sessions (Phase 1 today, Phase 2 tomorrow)
└─ Preserve freeze state until all decisions resolved
```

---

## 📊 SUCCESS METRICS: POST-SESSION

```
✅ Session Success Indicators:
   □ All 16 decisions marked (yes/no/defer)
   □ Vote counts recorded for each decision
   □ Decision checklist signed by board chair
   □ Timestamp of board approval recorded
   □ Authorization email sent to engineering within 5 min
   □ Phase 1 preflight initiated within 4 hours

❌ Session Failure Indicators:
   □ Quorum not met
   □ Any decision cannot be marked (unresolved)
   □ Decision checklist not signed
   □ Authorization email not sent
   □ Confusion about next steps

✅ 48-Hour Follow-up (Phase 1 shadow collection check-in):
   □ Preflight completed (HEALTHY or BLOCKED)
   □ Backfill completed (rows_inserted > 0)
   □ Worker enabled and running clean
   □ First 6 quality checkpoints passing
   □ Engineering ready for Phase 2 decision
```

---

## 🗂️ SESSION MATERIALS CHECKLIST

**Bring to session or have ready:**

- [ ] Printed or e-sign-ready decision checklist (16 decisions + signature block)
- [ ] BOARD_READY_GOVERNANCE_PACKAGE_SUMMARY_2026-08-17.md (root level)
- [ ] EXECUTIVE_BRIEFING_READY_FOR_BOARD_REVIEW.md (5 min read)
- [ ] Pen or digital signature tool
- [ ] Timer (90 min wall-clock)
- [ ] Facilitator notes (this runbook)
- [ ] Phase 1 runbook (PHASE_1_EVAL_SYMBOL_SHORTLIST_2026-08-17.md) — optional, for post-decision briefing
- [ ] Deep technical docs (docs/governance/ directory) — optional, for reference

---

## 🎯 FINAL CHECKLIST: BEFORE SESSION STARTS

**Chair / Facilitator:**
- [ ] All board members notified and RSVPed
- [ ] All materials sent 3 days prior
- [ ] Room reserved or Zoom link confirmed
- [ ] CTO / Architect confirmed as presenter
- [ ] Decision checklist printed or e-sign tool tested
- [ ] Timer set up
- [ ] Pen / markers available
- [ ] This runbook reviewed and ready to read aloud
- [ ] Contingency contacts (if CTO unavailable)
- [ ] Post-decision authorization email template ready

**Engineering (standby):**
- [ ] CTO monitoring for approval email
- [ ] Phase 1 preflight command ready to run
- [ ] Backfill team on standby
- [ ] Worker enable steps documented and tested
- [ ] Shadow collection monitoring dashboard prepared
- [ ] Phase 1 rollback procedure reviewed and tested

**Board Members (prep):**
- [ ] Read root summary (5 min) before session
- [ ] Read executive briefing (5 min) before session
- [ ] Optional: Deep dive into technical docs (1–3 hours) for detailed confidence

---

## 🚀 POST-SESSION WORKFLOW

**Immediately after session (if all 16 = YES):**

1. **Chair signs decision checklist** (digital or print)
2. **Facilitator records timestamp** (exact time of board approval)
3. **Chair emails authorization** (within 5 min)
4. **CTO receives email** → Phase 1 authorization active
5. **Engineering starts preflight** (within 4 hours of board signature)
6. **Project manager updates stakeholders** (async post-session briefing)

**If any decision ≠ YES:**

1. **Chair documents reason** (e.g., "Decision X deferred pending architect clarification")
2. **Project manager schedules follow-up** (1–2 weeks)
3. **Architect + CTO prepare next tranche** (address deferred decision + collect new evidence)
4. **Freeze remains active** (no Phase 1 start until all 16 = YES)
5. **Board meets again** (typically 1–2 week cycle)

---

## 📞 ESCALATION & CONTINGENCY

**If session gets stuck:**

- **Technical question unanswered:** CTO/Architect clarifies, or defer decision to follow-up
- **Disagreement on evidence:** Architect presents additional data, or defer to expert panel
- **Major new concern:** Permit 5–10 min discussion, then defer if unresolved
- **Time running over:** Compress optional discussions, split into two sessions if needed
- **Board member unavailable:** Confirm quorum met; proxy vote allowed

**Post-session follow-up (if any deferral):**

- Facilitator sends summary of deferred decisions within 24 hours
- Architect + CTO prepare response within 5 days
- Board meets again within 1–2 weeks
- Retry all 16 decisions (re-vote on deferred items only, or all 16 if substantial change)

---

## 🎯 END STATE

**If all 16 = YES:**
```
Board approval: ✅ RECORDED
Phase 1 auth: ✅ ISSUED
Freeze: ✅ CONDITIONAL (Phase 1 only)
Engineering: ✅ START PREFLIGHT (within 4 hours)
Timeline: ✅ LOCKED (49–65 hours to Phase 2 decision)
```

**If any ≠ YES:**
```
Board approval: ❌ INCOMPLETE
Phase 1 auth: ❌ NOT ISSUED
Freeze: ✅ MAINTAINED
Engineering: ✅ STANDBY (awaiting resolution)
Next: ✅ FOLLOW-UP SESSION (1–2 weeks)
```

---

**Timestamp:** 2026-08-17 06:12:53 UTC  
**Runbook Version:** 1.0 (final, board-ready)  
**Status:** Ready for immediate use

🎯 **Print this runbook. Use it to run the board session. 90 minutes from start to Phase 1 authorization (or documented deferral for next cycle).**
