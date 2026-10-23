# Finance & Welfare V2 — Phase 1 contracts (draft, no financial migration)

Baseline: main bfa5c2e0bb32a2cbee05d32a44e4994c5a6a51d4; PR #85 remains independent and unmerged. Do not deploy or merge this branch without explicit release approval.

## Existing canonical systems to preserve
- POS V2 atomic sales, payment components, actualSaleCost, customer credit, welfare, inventory and receipt revision semantics.
- Operational GRN event types OPERATIONAL_CONSUMABLE_OPEX and FIXED_ASSET_ACQUISITION. Do not repost already accepted GRNs.
- Existing finance_payment_accounts, petty_cash_ledger, banking_records, cashTransfers, and supplier invoice settlement idempotency.
- Martin Pharma Masaka is the acceptance test fixture, NOT a tenant-specific release gate.

## Event identity and idempotency
A financial event has tenantId, eventId (deterministic), sourceType, sourceId, sourceVersion, eventKind, economicDate, effectiveAt, currency, amountUGX, branchId or HQ attribution, actorUid, postingStatus, reversalOf, createdAt. Use tenant-qualified deterministic keys. The same key and same canonical fingerprint is a no-op/recovery; same key and differing fingerprint is a conflict. Do not rely on client button disabled state. A correction is a linked reversal or delta posting, never an overwrite of posted money.

## Account identity and balance contract
Represent accounts as tenant-owned IDs with kind: BRANCH_CASH_SALES, BANK, MTN_MOBILE_MONEY, AIRTEL_MONEY, PETTY_CASH. Support multiple named real accounts and optional branchId; preserve existing management_petty_cash and management_bank IDs and their reconciled balances as compatibility anchors. Account controls require immutable owner, currency UGX, status, reconciled opening evidence, integer balanceUGX and sequence/lastPosting identity. Every balance delta is linked atomically to a corresponding ledger movement. Do not reinterpret historical EOD as opening balances.

## Treasury transfer contract
Request identifies tenant, sourceAccountId, destinationAccountId, principalUGX, chargeUGX >= 0, chargePayerAccountId (normally source), reason, actor, requestId. Transfer amount must arrive complete; charge is additional funding from its specified payer. Atomic balances: source -principal; destination +principal; charge payer -charge; external charge expense once. For shared source and charge payer, source delta is -(principal + charge). On retries no further balance changes. Internal principal is not revenue, OPEX, or external outflow. Reject same-account transfers and insufficient balances; reverse with explicit linked compensating events.

## EOD dependency for Phase 2
At checkout, capture canonical shift instance identity from branch Settings shift template plus business date and immutable schedule snapshot. EOD uniqueness: tenantId/branchId/businessDate/shiftInstanceId. POS settled payment components determine expected channel totals; do not recognise credit/welfare as physical cash. Accept declared physical cash into Branch Cash Sales only once; expected/declared/variance distinct. Per-channel nonzero variance requires reason even if totals net to zero. Zero must never display -0. Overnight shifts and historical untagged sales require explicitly documented attribution method; never silently guess overlapping shifts. Corrections post only deltas.

## Expense versus cash classification
Accrual P&L: net eligible POS sales less actual POS COGS (legacy estimated values clearly identified); operational consumable GRN qualifying OPEX once, not again at usage or supplier payment; fixed asset GRN capitalised, not OPEX; payroll expense separate from disbursement; charges once. Sellable GRN receipt and supplier liability settlement are not OPEX. Internal transfers and welfare earmarking are not expenses. Cash outflow views reflect actual external payment only, not unpaid requests, ledger transfers, or duplicated payroll.

## Welfare contract
Approved funding requisition -> petty cash issuance -> Welfare Fund receipt (physical controlled money) -> staff benefit reserve (noncash encumbrance) -> eligible POS utilisation / reversal. Preserve legacy staff.welfare_limit and staff.welfare_spent; reconcile historic welfareAllocations rather than duplicating cash. Staff portal must show available entitlement without implying bank cash. Administration moves to Management Finance only after replacement acceptance.

## Phase 1 implementation gates
1. Read-only inventory of production payment accounts, EOD, receivables, transfers, welfare and historical records in named database, tenant-scoped.
2. Reconcile opening amounts: do not auto-create or silently alter accounts.
3. Add pure event/account/transfer policy helpers and targeted tests.
4. Extend existing controlled account service/rules with authenticated branch- and tenant-bound atomic balances; do not create a second balance authority.
5. Test cross-tenant and cross-branch denial, duplicate click, concurrent retries, insufficient funds, zero/nonzero fees, reversals, negative cases, supplier settlement regression, Spark rules-size.
6. Require independent approval before migrations, merges, payments or production deployment.

## Audit evidence — repo main
- src/pages/Finance.tsx EOD submission uses addDocument on eod_reconciliations, date-only sale filter; no shift identity and checks total-only variance.
- src/pages/Settings.tsx saves branch.shifts day/evening/night templates.
- src/services/pos-v2/posCheckoutV2Repository.ts persists actualSaleCost but no shift identity in sale object.
- src/pages/finance/management/CashAndBanking.tsx infers balances from EOD/transfer records and welfare allocations.
- src/modules/hr/PayrollManager.tsx marks payroll paid when finalized, also creates pending management expense.
- src/pages/Welfare.tsx can post petty cash movement on entitlement adjustment.
- firestore.rules eod_reconciliations and branch_expenses base writers lack explicit document-branch authorization.
- Production database records, effective rules and Hosting release metadata have NOT been authenticated/verified as part of this draft.
