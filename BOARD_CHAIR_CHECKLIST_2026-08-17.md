# BOARD CHAIR CHECKLIST
## 2026-08-17 | 90-Minute Session | 16-Decision Approval Path

---

## 📋 BEFORE SESSION (This Week)

- [ ] **Read** `BOARD_STATUS_READY_FOR_ACTION_2026-08-17.md` (5 min)
- [ ] **Read** `docs/governance/BOARD_SESSION_RUNBOOK_2026-08-17.md` (15 min)
- [ ] **Schedule** 90-min calendar slot (this week or early next week)
- [ ] **Print** this checklist + runbook
- [ ] **Attach 3 PDFs to calendar invite:**
  - BOARD_READY_GOVERNANCE_PACKAGE_SUMMARY_2026-08-17.md
  - EXECUTIVE_BRIEFING_READY_FOR_BOARD_REVIEW.md
  - BOARD_DECISION_CHECKLIST_READY_FOR_SIGNATURE_2026-08-17.md
- [ ] **Send invite** to all board members (3 days before session)
- [ ] **Verify** CTO + architect confirmed attendance
- [ ] **Prepare slides** (optional; briefing doc can be read aloud)

---

## 📍 DAY OF SESSION

### Pre-Session (15 min before)

- [ ] **Attendees present:** CTO, architect, all board members
- [ ] **Tech check:** Can everyone see/hear? Screen ready?
- [ ] **Printouts available:** Runbook + checklist for each member
- [ ] **Timer ready:** Phone or watch (use runbook timeline)
- [ ] **Decision checklist printed:** Ready for marking
- [ ] **Backup plan ready:** Know escalation path if any decision = NO/DEFER

---

## ⏱️ DURING SESSION (90 minutes)

### **0:00–0:05 | OPENING (5 min)**
- [ ] **Call to order** — "We're reviewing the tradzfx-v2 governance preconditions."
- [ ] **CTO reads** executive briefing aloud (from EXECUTIVE_BRIEFING_READY_FOR_BOARD_REVIEW.md)
- [ ] **Timing note:** Move to architecture review at 0:05 sharp

---

### **0:05–0:10 | ARCHITECTURE REVIEW (5 min)**
- [ ] **Architect presents** board summary (key points from BOARD_READY_GOVERNANCE_PACKAGE_SUMMARY_2026-08-17.md)
  - What we built: 3-layer fail-closed enforcement
  - Why it matters: Production safety, replay-ability, auditability
  - What we're asking: Approve 16 precondition decisions
- [ ] **Slides or live read:** Either works; keep to 5 min
- [ ] **Timing note:** Move to Q&A at 0:10 sharp

---

### **0:10–0:40 | BOARD QUESTIONS & DISCUSSION (30 min)**
- [ ] **Open floor:** "Questions on any of the 16 decisions?"
- [ ] **Deep dives allowed:** If board wants 10 min on one topic, take it
- [ ] **Redirect if needed:** "That's Phase 2 scope; Phase 1 is XAUUSD eval only"
- [ ] **Keep moving:** Flag key questions for post-session follow-up if time tight
- [ ] **Watch timer:** At 0:40, move to voting

---

### **0:40–0:45 | DECISION VOTING (5 min)**
- [ ] **Read all 16 decisions aloud** (from BOARD_DECISION_CHECKLIST_READY_FOR_SIGNATURE_2026-08-17.md)
- [ ] **Mark each:** YES / NO / DEFER (use checklist below)
- [ ] **Call votes:** "Decision 1: Detector v3-robust is canonical — all in favor?"
- [ ] **Record:** Mark checklist as you go
- [ ] **Keep pace:** ~20 seconds per decision
- [ ] **Note deferrals:** If any = DEFER, log the reason

---

### **0:45–0:50 | REVIEW & AUTHORIZATION (5 min)**

**IF ALL 16 = YES:**
- [ ] **Declare success:** "All 16 decisions approved."
- [ ] **Sign checklist:** Chair signature + date
- [ ] **Authorize CTO:** "You're authorized to start Phase 1 within 4 hours."
- [ ] **Note commitment:** "Phase 2 decision required within 65 hours."
- [ ] **Move to signature** (see below)

**IF ANY = NO or DEFER:**
- [ ] **Declare hold:** "Freeze continues until board revisits [decision N]."
- [ ] **Log reason:** Note why NO/DEFER on checklist
- [ ] **Schedule follow-up:** "Can we address this by [DATE]?"
- [ ] **Dismiss:** Session ends; Phase 1 does not start
- [ ] **Inform CTO:** Send email: "Board deferred decision [N]. Phase 1 held pending [reason]."

---

### **0:45–0:50 (If All YES) | SIGNATURE & AUTHORIZATION**

**Chair signs decision checklist:**
```
[ ] All 16 decisions marked YES above
[ ] Chair signature: _________________________ Date: _________
[ ] Checklist printed and filed
```

**Chair sends authorization email to CTO:**

**To:** CTO  
**Subject:** BOARD AUTHORIZATION: Phase 1 Eval Approved (2026-08-17)  
**Body:**
```
The board has approved all 16 governance preconditions.

Phase 1 authorization is granted effective immediately.

CTO action plan: Execute Phase 1 per OPERATIONAL_HANDOFF_BOARD_TO_PHASE1_2026-08-17.md

Timeline: Preflight + backfill within 4 hours. Shadow collection 24–48 hours. 
Phase 2 board decision within 65 hours.

Questions: Contact me immediately.
```

- [ ] **Email sent:** Confirm CTO receipt
- [ ] **Log time:** Note "Phase 1 authorized at [TIME UTC]"

---

### **0:50–1:30 | BUFFER (40 min)**

- [ ] **Deep questions:** If board wants extended discussion on specific decisions, take it here
- [ ] **Technical deep dives:** Architect can walk board through canonical path trace, feature lineage, etc.
- [ ] **Risk discussion:** "What happens if Phase 1 preflight fails?"
- [ ] **Timeline reality check:** "Is 49–65h realistic? Can we do faster?"
- [ ] **Keep agenda on track:** Use buffer but stay focused

---

### **1:30–1:45 | CONTINGENCY (15 min, if needed)**

**If any decision came out NO or DEFER:**
- [ ] **Escalation path:** Follow BOARD_SESSION_RUNBOOK contingency section
- [ ] **Options:**
  - A) Board revisits decision immediately (fast-track resolution)
  - B) Board requests additional analysis (schedule follow-up session)
  - C) Board maintains freeze (no Phase 1 until next review)
- [ ] **Document decision:** Record in contingency log
- [ ] **Set next review date:** "We'll reconvene on [DATE]"

---

## 📞 AFTER SESSION

### **Immediately (within 5 min if approved):**
- [ ] **Send authorization email** to CTO (see template above)
- [ ] **Verify CTO receipt:** One-line response confirming "Phase 1 starts now"
- [ ] **File signed checklist:** Keep for audit trail

### **Same Day:**
- [ ] **Notify board:** "All 16 approved; Phase 1 is live; Phase 2 decision in 65 hours"
- [ ] **Set reminder:** Phase 2 board decision due in 65 hours (date/time?)
- [ ] **Confirm CTO progress:** "Preflight running? Backfill on track?"

### **Within 24 Hours:**
- [ ] **Phase 1 checkpoint 1:** Preflight result (HEALTHY? BLOCKED_QUALITY? DEGRADED?)
- [ ] **Phase 1 checkpoint 2:** Backfill complete (rows inserted?)
- [ ] **Phase 1 checkpoint 3:** Worker running on XAUUSD (shadow mode confirmed?)

### **Within 48 Hours (Phase 1 completion):**
- [ ] **Quality assessment:** All 6 checkpoints green?
- [ ] **CTO briefing:** Ready for Phase 2 decision?
- [ ] **Board prep:** Schedule Phase 2 session (short, 20 min, decision-only format)

---

## 🎯 THE 16 DECISIONS (Mark as You Vote)

| # | Decision | YES | NO | DEFER | Notes |
|---|----------|-----|----|----|-------|
| 1 | Detector v3-robust is canonical | ☐ | ☐ | ☐ | |
| 2 | Detector v4-calibrated stays frozen | ☐ | ☐ | ☐ | |
| 3 | v3 audit scope is sufficient | ☐ | ☐ | ☐ | |
| 4 | v3→v4 migration path is safe | ☐ | ☐ | ☐ | |
| 5 | Fail-closed contract is proven | ☐ | ☐ | ☐ | |
| 6 | Broker identity immutability holds | ☐ | ☐ | ☐ | |
| 7 | Quarantine semantics are correct | ☐ | ☐ | ☐ | |
| 8 | Canonical path docs are complete | ☐ | ☐ | ☐ | |
| 9 | Feature DAG is complete | ☐ | ☐ | ☐ | |
| 10 | Immutability proof holds | ☐ | ☐ | ☐ | |
| 11 | Backfill procedures are safe | ☐ | ☐ | ☐ | |
| 12 | Feature docs are complete | ☐ | ☐ | ☐ | |
| 13 | Unfreeze preconditions are sufficient | ☐ | ☐ | ☐ | |
| 14 | Phase 1 gates are operationally tight | ☐ | ☐ | ☐ | |
| 15 | Board oversight model is workable | ☐ | ☐ | ☐ | |
| 16 | 49–65h Phase 1 timeline is realistic | ☐ | ☐ | ☐ | |

**RESULT:** All YES = Phase 1 approved | Any NO/DEFER = Freeze continues

---

## 📁 SUPPORTING DOCUMENTS (For Reference)

**Pre-Session (Send to Board):**
- BOARD_READY_GOVERNANCE_PACKAGE_SUMMARY_2026-08-17.md
- EXECUTIVE_BRIEFING_READY_FOR_BOARD_REVIEW.md
- BOARD_DECISION_CHECKLIST_READY_FOR_SIGNATURE_2026-08-17.md

**Session Materials (Print & Carry):**
- BOARD_SESSION_RUNBOOK_2026-08-17.md
- BOARD_STATUS_READY_FOR_ACTION_2026-08-17.md
- This checklist (BOARD_CHAIR_CHECKLIST_2026-08-17.md)

**Deep Dives (If Board Asks):**
- CANONICAL_PATH_TRACE_END_TO_END_2026-08-17.md (900+ lines, end-to-end proof)
- FEATURE_LINEAGE_MAP_END_TO_END_2026-08-17.md (1000+ lines, 6-tier DAG)
- 12-file detector audit (in docs/governance/)

---

## 🚨 IF THINGS GO SIDEWAYS

| Issue | Action |
|-------|--------|
| **Board member not prepared** | Start with 5-min executive brief; adjust timeline |
| **Board wants more time on one decision** | Use the 40-min buffer; keep others to 20 sec each |
| **CTO or architect can't attend** | Reschedule (postpone to date when both can join) |
| **Board wants to defer all decisions** | Note the reason; schedule follow-up in 1 week |
| **Tech fails mid-session** | Print all docs; read aloud; continue on schedule |
| **Board wants to know "what if Phase 1 fails?"** | Answer: "Freeze stays, no production impact, can revisit in 1 week" |

---

## ✅ SESSION SUCCESS

You've won if:
- ✅ All 16 decisions marked and voted
- ✅ All 16 = YES (or documented NO/DEFER reason)
- ✅ Checklist signed (if all YES)
- ✅ CTO authorization email sent (if all YES)
- ✅ Board confirms Phase 1 starts within 4 hours (if all YES)
- ✅ Phase 2 decision scheduled for 65 hours from now (if all YES)

---

## 🔒 REMEMBER

**You're not deciding whether to build Phase 1. That's done.**

**You're deciding whether the *preconditions* for Phase 1 are met:**
- Is detector v3 safe enough to canonicalize?
- Is the fail-closed contract proven?
- Is Phase 1 operationally tight enough to start?

**Answer YES to all 16 → Phase 1 runs under board oversight for 65 hours → Phase 2 decision based on real data.**

---

**Printed by:** Board Chair  
**Session Date:** [INSERT DATE/TIME]  
**Expected Outcome:** All 16 approved → Phase 1 authorization → CTO executes within 4 hours

**Status:** Ready. Bring this checklist. 90 minutes. Go.
