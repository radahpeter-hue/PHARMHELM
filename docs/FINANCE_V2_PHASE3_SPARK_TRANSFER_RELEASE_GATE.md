# Finance V2 Phase 3 — Spark transfer release gate (NOT SIGNED OFF)

This document governs the remaining technical dependency before Phase 3 may be
closed or the POS cash/EOD follow-up and Phase 4 handoffs may be issued.

## Current evidence
- V2 account creation, scoped read rules and policy tests exist.
- The staged browser writer is `src/services/financeV2TransferPosting.ts`.
- Firestore rules deliberately deny client writes to `finance_v2_transfers`,
  `finance_v2_account_movements`, `finance_v2_events` and direct V2 balances.
- Existing finance-backend endpoints are **not** an approved deployment path:
  production implementation must use Auth, Firestore SDK, Security Rules and
  Hosting, within the Firebase Spark plan.
- Finance V2 rules compiled-size must remain strictly under 256000 bytes.
- The caller-supplied `financeV2TransferRulesCertified` parameter is a UI
  fail-closed switch, **not** a security control or proof of certification.

## Required certified atomic transfer design
1. Authenticate the actual staff identity and enforce tenant, assigned branch,
   active status, role, account version/currency and protected activation gate
   in Security Rules, not just React or pure TypeScript.
2. Use a single Firestore SDK transaction with deterministic tenant-scoped
   idempotency key. All account, transfer, movement and external-fee writes
   must commit together or not at all.
3. Rules must verify pre-/post-balances via `get()` and `getAfter()` and tie
   them to the same immutable transfer ID. A client may not mint money, omit
   one side of a posting, alter unrelated accounts or post orphan movements.
4. Principal debits and credits must be equal and opposite. External charges
   reduce ONLY the payer account, are separately evidenced as an expense,
   and never reduce destination principal.
5. Reject insufficient balance, arithmetic overflow, zero/negative amount,
   invalid account type, inactive/uninitialized account, replay conflict,
   wrong role/branch/tenant, forged actor, and duplicate request ID.
6. Deny client edits/deletes of transfers, posted movements and expense events.
   Prove compensating corrections through a separately controlled workflow.
7. Account reads and ledger queries must be appropriately branch and tenant
   scoped. Client-side filtering does not satisfy this requirement.
8. Do not activate or merge until authenticated emulator adversarial tests,
   existing POS/finance regression tests, compiled rules-size, and an
   end-to-end Martin Pharma Masaka acceptance all pass.

## Required authenticated emulator examples
- Correct cash-to-bank transfer, no fee; exact source/destination delta.
- Fee charged to source, destination, or a distinct eligible payer.
- Duplicate identical request (one posting) versus changed-body replay (deny).
- Insufficient balance; same-account transfer; inactive/stale account.
- Partial batch, missing event/movement, forged amount/actor, wrong tenant,
  wrong branch, direct balance edit, mutation of posted history.
- Concurrent competing transfers where total outflow exceeds available cash.
- Permission-gate OFF denies all new financial postings.
- Verify no balance changes remain after a failed transaction.

## Follow-up gates
**Handoff A** (POS cash funding + per-day, per-shift EOD Spark conversion):
Only after atomic transfers and account balance rules are certified; avoid
funding the same cash sale twice and never treat EOD as a second cash credit.

**Handoff B** (Phase 4 procurement/GRN/payables/settlement integration):
Only after Phase 3 transfer engine is certified and handoff A's effects on
balances, cash recognition and EOD are explicitly accounted for. GRN credit
recognises a payable and inventory, NOT a cash payment.

Status: transfer write rules and end-to-end posting tests are NOT certified.
