# POS V2 Batch 5 controlled rollout

## Default deployment state

Deploying Batch 5 does not activate POS V2. A tenant whose
`features.posCheckoutV2Enabled` value is absent or not exactly `true` resolves to
`legacy`. `shadow` is also legacy-authoritative because no safe read-only V2
comparison runner exists yet.

Checkout reads the current `tenants/{tenantId}` and `branches/{branchId}`
documents before a new attempt starts. The selected engine is pinned to that
attempt. A retry always uses the same attempt ID and engine, even if the
configuration changes meanwhile.

## Controlled activation

Before changing any production branch, confirm both Batch 4 workflow modes are
green against the named production database:

1. reconciliation/audit mode authenticates and can query the outbox;
2. processing mode authenticates and can process or safely report zero work.

For one approved tenant and branch:

1. Keep the tenant default conservative:
   - `features.posCheckoutV2Enabled: true`
   - `posCheckoutEngine: "legacy"`
2. Set only the selected `branches/{branchId}.posCheckoutEngine` to `"v2"`.
3. Start with one low-risk transaction and complete the validation matrix below.
4. Expand one branch at a time only after the full chain is clean.

Do not change Firestore rules, deploy new paid Firebase infrastructure, or
backfill historical V1 transactions for this rollout.

## Immediate rollback

Set the affected `branches/{branchId}.posCheckoutEngine` to `"legacy"`. If a
tenant-wide stop is required, set `features.posCheckoutV2Enabled` to `false`.

Rollback affects new attempts only. An attempt already pinned to V2 must be
retried with its original attempt ID so the idempotency record can establish
whether it committed. Never retry that attempt through V1. Do not delete or
rewrite completed V2 sales, payments, checkout attempts, or outbox events.

## Live validation matrix

Run only low-value, operationally approved tests. Suggested order:

| Scenario | Checkout assertions | Inventory assertions | Downstream assertions | UI/Finance assertions |
| --- | --- | --- | --- | --- |
| Cash sale | One attempt, sale, payment, outbox | Exact base-unit/FEFO deduction | Consumption completes | Correct receipt, print, Finance visibility |
| MTN MoMo / Airtel Money | Correct settled component | Exact single deduction | Consumption completes | Correct payment label and totals |
| Multi-tier medicine | Tier, multiplier, commercial and base quantities retained | Correct FEFO allocation | Snapshot quantity drives consumption | Tier appears correctly on receipt/history |
| Two-product FEFO | One atomic sale | Correct batch per product; no negative stock | One deterministic movement per product | One receipt and payment |
| Service-only / mixed | One canonical sale/payment | No stock for service lines | No service consumption event | Service remains visible on receipt |
| Quotation-derived | Source quotation retained | Normal item deductions | Quotation consumer completes | Quotation links to the one sale |
| Institutional credit | Outstanding canonical component | Normal item deductions | One deterministic receivable | Credit Ledger and Finance visibility |
| Staff welfare / split | Components equal authoritative total | Normal item deductions | Welfare consumer completes once | Receipt and welfare records reconcile |
| Retry/replay | Same attempt ID and same sale ID | No second deduction | No duplicate consumers | Replayed result prints/resets normally |

For every scenario also inspect `engineVersion`, `checkoutAttemptId`,
`canonicalPaymentId`, `transactionOutboxEventId`, outbox global status, each
consumer status, attempt counts, last error, and any manual-review indicator.

## Operational limitations

V2 receipts are immutable in Batch 5. The UI blocks legacy edit and void paths
for `engineVersion: 2` records because Batch 4 has no durable V2 reversal or
revision event. Printing, reprinting, history, reporting, and downstream reads
remain available. A separate V2 reversal design is required before operational
voiding can be enabled safely.
