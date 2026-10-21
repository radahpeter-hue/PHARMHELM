# Finance V2: Spark-only implementation revision

Decision date: 21 October 2026. Owner requires Firebase Spark with no paid hosting, billing attachment, Blaze upgrade or payment-dependent deployment. This supersedes the Cloud Run pilot instructions in FINANCE_V2_DEPLOYMENT_PREFLIGHT.md and the hosted release route in FINANCE_V2_PHASE3_SIGNOFF.md. Previous approval to deploy does not authorise billing or a plan change.

## Retained work

Keep the existing financial account types, zero-opening registration policy, principal/charge calculation, integrity proofs, deterministic transaction identities, shift/overnight calculation, receipt-revision policy, UI and regression tests. Existing Admin transaction tests remain useful reference evidence, but do not certify a client transaction or Security Rules implementation.

The current backend can run locally against the emulator. It is not an operational Spark backend. Firebase Hosting serves the frontend; it does not execute the Node API. No external free host is assumed available, secure or permanent.

## Audited gaps and implementation order

1. **Accounts and history:** the current UI fetches both through financeV2Api. Direct V2 account/ledger reads are intentionally denied today. Implement tenant/branch-scoped queries and matching read rules, with authenticated emulator tests, before replacing this adapter. Do not widen collection access for a screen's convenience.
2. **Zero-opening registration:** reuse financeV2AccountRegistryPolicy. Certify exact schemas, trusted staff/tenant/branch checks, server time, immutable identity and zero opening balances in rules. Retain existing legacy account controls. Do not merely remove the existing `false` registration guard.
3. **Transfers:** assess the staged financeV2TransferPosting writer using the existing planner. The client proposes an atomic transaction; Firestore must independently authorise every account delta, counterpart movement, fee event and immutable transfer envelope using pre/post state. Reject missing or extra fields, unlinked balance writes, forged identities, stale balances, partial writes, duplicate postings and conflicting retries. Measure document-access and compiled-rule-size limits with the full repository rules. Until this passes, keep browser V2 writes denied. A caller-supplied certification boolean is not a security boundary.
4. **POS cash funding and corrections:** the backend currently queries prospective receipts and follows correction chains. Do not replace this with a browser-supplied total. Evaluate immutable per-receipt evidence and atomic checkout/revision integration using existing POS validation. Prove each cash credit/debit once, including split payments, welfare cash components and receipt revisions. Historical balances stay excluded. Unverified funds remain unavailable for transfers.
5. **Shift EOD:** retain the existing shift UI and pure policy. The backend currently calculates expectations from a sale query. Rules cannot execute that query or independently validate an arbitrary browser aggregation. Evaluate a securely maintained shift aggregate linked atomically to validated POS events, including receipt corrections and overnight shifts. Do not label a client calculation server-verified. EOD must never fund an account or bank cash.
6. **Integrated acceptance:** rerun rules and transaction acceptance with real authenticated emulator clients, including direct malicious writes, cross-tenant/branch access, concurrency, retries and existing supplier settlement/POS regression. Then prepare a Spark-compatible candidate for Masaka. No merge, deployment or activation is implied by this revision.

## Immediate correction

Cash & Banking now distinguishes unavailable account data from a verified zero balance. A failed refresh clears stale data and prevents review/confirmation until account access succeeds. Pending transaction identity is retained for outcome verification. This does not enable a Spark posting path.

## Release gates

- No billing attachment, paid service or plan change.
- No Cloud Run or Cloud Functions dependency in the Spark operational path.
- No privileged credentials in the browser, repository or container image.
- No relaxation of financial integrity or tenant isolation to fit Spark.
- No browser authorisation switch standing in for independent Security Rules.
- No positive opening balances, historical transaction replay or live test posting.
- Report resource/quota limitations explicitly. Spark has finite quotas; no claim of unlimited or automatically scalable free operation.

Status: implementation revised; Spark rules certification, cash funding and EOD aggregate design are still open. The previous green backend CI is not Spark operational sign-off. If any required financial invariant cannot be enforced within supported rules/transaction limits, leave that feature disabled and report the limitation rather than silently substituting paid hosting or unsafe writes.

Revision validation: frontend typecheck and production build passed; 20 targeted account/transfer/integrity/EOD policy tests passed. The browser smoke script now covers unavailable initial loads, a failed refresh with a pending transfer, disabled confirmation and recovery with the same request identity. Local execution was blocked by the missing Chromium executable and failed browser downloads; browser acceptance remains pending CI. No financial rules were relaxed and no live records were written.

## Primary references

- Firebase pricing plans: https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
- Firestore atomic transactions and getAfter validation: https://firebase.google.com/docs/firestore/manage-data/transactions
- Security Rules limits: https://firebase.google.com/docs/rules/rules-behavior
- Scoped queries and Security Rules: https://firebase.google.com/docs/firestore/security/rules-query
