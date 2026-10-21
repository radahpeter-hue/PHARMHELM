# Finance V2 POS cash integration checkpoint

This extends draft PR #88. It does not merge, deploy, activate or migrate balances.

## Accounting behaviour

Each newly registered Branch Cash Sales account starts at zero and gets a server-created prospective boundary. Only canonical POS V2 receipts created after that boundary can fund it. An edit of an older receipt remains excluded. The original receipt chain owns one cash-source journal; replacement receipts change the cash contribution by the difference. Cash components must be settled, whole UGX, and match the sale, payment and outbox identities, tenant, branch, receipt, totals and split methods.

Source journals are posting state in `finance_v2_pos_cash_sources`; they are not a competing account registry. Only the existing `finance_payment_accounts` register holds account balances. Branch cash account IDs are deterministic per branch, preventing duplicate prospective cash accounts. Existing accounts without these trusted initialization fields stay blocked; no historical balances are copied.

Cash location events and movements record before/after balances, source and previous receipt identities, payment identities, the source operator and posting operator. They explicitly recognise neither revenue nor operating expense. POS owns the sale/revision revenue. EOD writes only its reconciliation audit and never funds or banks cash. External transfer charges continue through the existing trusted transfer engine.

## Concurrency, processing and corrections

Funding reads trusted sale updates with a server Timestamp/document-ID cursor. Source journals and account balances are updated atomically in bounded pages. Repeated pages, simultaneous workers and network retries cannot credit a receipt twice. A source/payer cash account with a backlog cannot authorise an outgoing transfer from a partial result. Refresh drains up to 20 pages and can be repeated; this is a processing bound rather than a lifetime sale limit. Only changed receipt chains are read after catch-up.

The Admin adapter stages cash funding before invoking the unchanged trusted transfer calculator, inside the same Firestore transaction. Receipt changes that conflict with that snapshot cause a transaction retry. A fresh sale need not wait for a worker or screen refresh before transfer validation. Funds, charges, source journals, posting events and transfer audit records commit together or not at all.

A correction that would require more cash than remains at the branch blocks outgoing cash use. It does not silently alter the bank. An authorised incoming bank-to-cash transfer remains possible to fund the refund; the next funding refresh applies the pending cash reduction. Incorrect payment evidence and incomplete receipt revisions fail closed. Unsupported cancellation/return workflows require an explicit financial reconciliation rather than an assumed cash refund.

## Runtime and activation

The API supports account refresh and posting without a background worker. The optional polling worker runs every 15 seconds when `FINANCE_V2_CASH_POLL_ENABLED=true` and `FINANCE_V2_CASH_PILOT_TENANTS` lists explicitly approved tenant document IDs. An always-running worker requires a runtime with CPU outside requests. Pausing a worker does not lose postings; refresh and transfer use the same persisted source cursor.

The tenant must independently have `financeV2TrustedTransfersEnabled` and `financeV2PosCashFundingEnabled`. Registration and EOD retain their separate flags. Firestore rules prohibit browser changes to all four Finance V2 release controls, including generic fallback writes. Ordinary authorised settings changes remain supported. Source journals and controlled ledgers are server-only. Deploy the indexes in firestore.indexes.json before activation.

Runtime configuration remains documented in FINANCE_V2_PHASE3_SIGNOFF.md. The standalone API requires its own approved HTTPS host, ADC/service identity, correct Firebase project and named database, and frontend endpoint configuration. Firebase Hosting alone does not run the service. The CI container smoke test uses an isolated project name and no production credentials, verifies packaging/startup and rejects unauthenticated posting requests. It is not a hosted operational acceptance test.

## Validation

The local frontend suite contains 739 passing tests. Frontend and backend type checks and production build pass. The isolated end-to-end emulator exercises prospective funding, historic receipt exclusion, duplicate workers, EOD without banking, full-principal banking with separate fees, receipt correction after banking, authorised refund funding, split cash, noncash exclusion, malformed evidence, fresh-sale funding inside transfers, paginated backlog catch-up and disabled activation. Existing EOD, trusted transfer and Management Cash settlement acceptance remain regression gates. Dedicated rules acceptance checks protected funding journals and release controls while preserving ordinary settings writes.

Current-commit CI and mobile results are recorded in PR #88 after execution. Historical green results must not be substituted for the new commit's checks. Hosted authentication, service permissions, named-database connectivity and owner operational acceptance remain pending. No live test transaction is authorised or performed by this implementation.
