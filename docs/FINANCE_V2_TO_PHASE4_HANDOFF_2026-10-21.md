# PHARMHELM Finance V2 → Phase 4 engineering handoff
Date: 2026-10-21
Repository: radahpeter-hue/PHARMHELM
Draft pull request: #88, feature/finance-v2-phase3-cash-banking
Tenant/branch: Martin Pharma / Masaka
Constraint: Firebase Spark only, no Cloud Functions, Cloud Run, Render, paid API or upgrade.

## Verified deliverables (not a Phase 3 financial signoff)
1. Finance V2 account-registration policy, tenant- and branch-scoped account reads, pure transfer calculations and staged client transaction writer exist.
2. Finance shift EOD UI calculates from canonical active sales and Settings shifts; defaults to Uganda local business date, validates per-method variance, prevents negative zero and requires explanations for offsetting variances.
3. Regression tests for invalid UGX, EOD business-date timezone and protected client-write denial exist.
4. 76 redundant Firestore authentication checks were removed without changing the underlying tenant membership predicate.
5. PR #88 commit 8bb003cfa844a2b1f4c694c68158d7a9baf0a946 showed 5 successful GitHub workflows (size validation, preview, finance integration, POS CI, management cash acceptance).
6. A manual EOD UI test card exists: docs/FINANCE_V2_MASAKA_TEST_CARD.md.
7. The earlier two-account atomic rules prototype is preserved as a *non-deployed* fragment: docs/FINANCE_V2_SPARK_ATOMIC_TRANSFER_PILOT.fragment.rules.

## Explicitly NOT complete
- Spark-native client transfer posting with independently certified account + movement + charge invariants.
- POS-to-Branch Cash Sales posting once per effective canonical receipt, with corrections.
- Immutable Spark-native shift EOD submission without cash double-credit.
- End-to-end Masaka financial transaction acceptance.
The active Firestore rules still deny writes to V2 transfer, movement and event ledgers. The former backend-based Finance V2 API is NOT permitted under the Spark constraint.
A green CI result for the fail-closed rules is not evidence that these unavailable pathways work.

## Discovered fundamental limit
The full production Firestore rules are close to the 256,000-byte compiled executable ceiling. An attempted zero-fee atomic two-account transfer raised the compiled size to 264,684 bytes (one prototype). Other attempts measured 265,093 and 266,191 bytes. These cannot be deployed. A reduced identical-check cleanup passed CI, but does not by itself create enough headroom for a complete posting path.
The only credible next implementation is disciplined Firestore rules size reduction WITH functional equivalence regression and emulator permission tests. Do not bypass the limit by granting direct client balance writes.

## Next chat: Phase 4 can proceed independently in *non-posting* scope
Begin Phase 4 immediately with existing procurement, GRN, invoice, supplier register, accounts payable and operational/sellable inventory data flows. Implement/verify:
1. One shared supplier identity/register across CRM and Procurement.
2. Purchase request → sourcing → finance approval → GRN → destination (HQ buffer or direct ordering branch) → dispatch → branch receipt.
3. Operational inventory separate from sellable in HQ and stock-at-hand; correct destination chosen at GRN posting, and accountable movements.
4. On credit GRN, inventory and supplier payable update but no cash reduction. On settlement, payable reduces; payment account only posts once through a separately certified cash/bank ledger.
5. Duplicate GRN/dispatch/payable prevention, branch scoping, auditable approvals, reconciliation and reversal behavior.
6. UI and emulator testing with Martin Pharma, Masaka; withhold live supplier-payment posting until Finance V2 certified ledger exists.
7. Preserve existing POS V2 behavior and Firebase Spark free-tier constraints; no merger or production deployment without express user approval.

## Finance V2 closure condition
Revisit the isolated financial posting gate as a tracked blocker; do NOT represent Phase 3 as fully accepted or permit ledger mutation until cross-document Security Rules, emulator failure cases, idempotency, charge handling, POS correction handling, EOD recording, and manual Masaka acceptance all pass.

## Evidence/source locations
- src/services/financeV2TransferPosting.ts
- src/services/financeV2TransferPolicy.ts
- src/services/financeV2EodPolicy.ts
- src/pages/Finance.tsx
- firestore.rules
- scripts/finance-v2-account-rules-emulator.mjs
- docs/FINANCE_V2_PHASE3_SPARK_TRANSFER_RELEASE_GATE.md
- docs/FINANCE_V2_MASAKA_TEST_CARD.md
