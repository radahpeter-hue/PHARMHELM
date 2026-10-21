# Finance V2 Phase 3 development and integration checkpoint

> Current release candidate: FINANCE_V2_SPARK_PILOT.md documents the independently hosted free pilot, shared EOD/treasury API, executed acceptance and remaining hosted gates. No Cloud Run/Blaze deployment is selected. The historical backend details below remain reference evidence.

> Release-route revision, 21 October 2026: the owner requires Spark with no paid hosting or billing upgrade. The backend-dependent operational route described below is not approved for release. FINANCE_V2_SPARK_CONSTRAINT.md records the revised scope and open certification gates. Existing green backend tests do not certify Spark client/rules posting.

Candidate combines main bfa5c2e, Phase 1 ed03c47, Phase 2 f7e1cca and supplier settlement PR #85 (538d942). Main and PRs #85–#87 were inspected directly on GitHub; all three PRs remain open, #86 and #87 draft. Phase 2 descends from Phase 1; #85 was merged into this development candidate without conflicts. No production merge, deployment, activation, balance migration or operational financial posting was performed.

## Implemented

Cash & Banking now displays authoritative V2 account balances by type and ownership, distinguishes legacy/unverified accounts, registers zero-opening accounts through the existing registration planner, previews principal and separate charge deltas, submits authenticated transfers using the Phase 1 trusted core, and displays posted transfer envelopes with before/after balances, fee payer and operator. Retry identity is retained in session storage across reloads. An uncertain submission retains its original identity; a new success is never inferred from clicking Submit.

The shared API serves accounts, registration, transfers and Phase 2 EOD. Firebase tokens are verified with revocation checking; trusted staff records supply Finance roles, active status and tenant identity. Finance Head has organisation access; Finance Officer and Accountant are limited to assigned branch accounts. Other roles remain denied, pending explicit delegated permission design. Source, destination and fee payer are scoped inside the atomic posting transaction. Registration is Finance Head only, gated and zero-opening only. Legacy supplier payment accounts and their write controls remain independent.

V2 account reads and transfer history are served through the scoped API; browser writes and direct V2 ledger reads are denied. Legacy Management account subscriptions explicitly query controlVersion 1. The existing pure transfer policy remains the single calculator. Internal principal creates no revenue or operating expense; only the fee creates a charge expense event. No generic deposit/withdrawal adjustment was introduced. Welfare allocations and receivables are excluded from cash available for transfer.

## Deployable connection

Build from repository root: `docker build -f finance-v2-backend/Dockerfile .`. The container runs the authenticated API on PORT 8080 with Node 22. Dependencies have a committed lockfile. Run the frontend typecheck and `npx tsc -p finance-v2-backend/tsconfig.json` separately.

Runtime must supply ADC/service identity with least required Firestore and Firebase Auth access, FIREBASE_PROJECT_ID=gen-lang-client-0911422817, FIRESTORE_DATABASE_ID=ai-studio-f7d8654b-e089-425a-a506-38159afe1e75, ALLOWED_ORIGIN=https://mp.pharmhelm.com, FINANCE_V2_API_ENABLED=true. Use an approved container runtime with HTTPS; Firebase Hosting SPA does not execute these routes. Do not deploy credentials in the frontend or container image.

Frontend: VITE_FINANCE_V2_API_BASE_URL points to that HTTPS service origin; VITE_FINANCE_V2_EOD_API_URL points to its /api/finance-v2/eod endpoint. Server-owned tenant settings separately gate trusted transfers, account registration and EOD. All remain inactive unless explicitly configured. Activation and production deployment require owner approval. The Docker build itself and an actual hosted connection have not been verified here.

## Verification and remaining gates

Local frontend test batch: 739 tests passed; frontend typecheck and Vite production build passed. Backend compilation passed after correcting a pre-existing Phase 2 sale snapshot inference error. Isolated Firestore Admin transfer and EOD acceptance passed, including concurrent duplicate requests, principal and separate fee, insufficient funds, conflicting retry, authentication and tenant checks, overnight EOD and canonical retry. Legacy Management Cash settlement authenticated rules acceptance passed, including new tenants and cross-tenant denial. Expected denial cases emit Firestore errors; the acceptance process exited successfully.

The expanded emulator batch also passed competing-transfer overdraft prevention, branch restriction, scoped treasury reads, restricted registration and uninitialized-account rejection. Current GitHub checks must still be inspected before release sign-off. The dedicated Finance V2 integration workflow installs both lockfiles, typechecks both packages, runs unit/build checks and the isolated Admin and legacy settlement acceptance suites. It applies to stacked PRs as well as main.

Release blockers:

1. The prospective POS cash funding and receipt-correction contract is implemented and emulator-tested in the follow-up described in FINANCE_V2_POS_CASH_INTEGRATION.md. New accounts still start at zero and historical balances are not migrated. Hosted operational validation remains required before release.
2. Hosted API deployment, real Firebase token/service identity validation, named-database verification, frontend connectivity and tenant activation remain pending.
3. Mobile layout uses native controls, wrapping cards and normal page scrolling; rendered desktop/mobile acceptance remains pending.
4. Dedicated browser V2 registration/read/write-denial emulator acceptance passed. Treasury branch-read and registration-denial checks passed in the Admin suite. Rendered UI and broader delegated-role acceptance remain pending.
5. Initial candidate 21279ff4 passed Finance V2 integration, Firestore compiled release size and Masaka preview CI. Current final-commit checks must also be inspected; do not substitute these results for its status.

Development is implemented but not operationally signed off. Phases 1–3 and #85 are combined into a test candidate; the integration checkpoint remains open until these release gates pass. No merge or activation is authorised by this report.
