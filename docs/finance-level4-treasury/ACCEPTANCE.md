# Level 4 Treasury redesign

Base: main fa4facc109004e05364b20a5de4b6de8ff27691c.

## Implementation

Cash & Banking now opens the Global Treasury Overview. Seven category cards open dedicated workspaces. Bank follows Overview → Bank Portfolio → Bank Accounts → Individual Account Ledger. Opening reconciliation, verified movements, atomic transfers and lifecycle actions reuse the existing services and server-enforced permissions. Custom portfolio registration remains CEO-only and organisation-scoped under the existing certified rules.

The overview projects `finance_payment_accounts` directly. Branch cash requires branch coverage; Petty Cash includes distinct branch accounts and Management Cash once. Bank uses the existing overlap guard for a legacy Management Bank reserve and separately registered bank accounts. A partial liquid subtotal explicitly excludes unavailable categories, credit, welfare and custom funds. Missing or invalid balances remain unavailable.

EOD financial posting is preserved from PR #101. `submitEod` records cash, MTN, Airtel and configured card-bank movements atomically with tenant/branch/date/shift EOD submission. Deterministic identities and immutable Rules prevent concurrent duplicates. Corrections continue to use the original card-bank destination. Destination-opening errors now name the required account and navigation. Ledger details retain the business date, source branch, reconciliation and shift.

The legacy landing-page transfer and welfare allocation forms were removed. Their wallet-to-bank presentation could not establish a reconciled source debit, and their welfare allocation did not establish an authoritative welfare reserve. Supported transfers are available within reconciled account workspaces through the existing paired-ledger service. Saved welfare allocations and benefit records remain readable. No new welfare cash treatment or Level 5 transfer is introduced.

## Validation

Baseline: 823 unit tests and TypeScript passed. Implementation: 829 unit tests, TypeScript and production build passed locally. Browser and Firestore emulator downloads are unavailable in the local execution environment; the PR's GitHub Actions runs are authoritative for emulator and browser acceptance. Do not equate a queued run with a pass.

Finance Level 4 CI explicitly covers the Cash & Banking page, main Finance page, Treasury components, balance models and associated tests. Authenticated emulator acceptance verifies routing, concurrent submission, replay, independent branches/shifts, previous-day posting, linked corrections, original card destination, rejected unauthorised corrections, failed destination atomicity, ledger reconciliation and cross-tenant rejection. Existing portfolio security and Management Cash suites remain required. Firestore Rules are unchanged.

The responsive fixture renders the actual Cash & Banking component at 360, 390, 768 and 1440 pixels. It checks all seven workspaces, bank hierarchy, individual bank ledger, filters, transaction details, credit, welfare, custom funds, view-only permissions, denied access, unavailable coverage, missing openings, overflow and text contrast. Fixture data is isolated from production. Screenshots are uploaded by Finance Level 4 CI as `portfolio-release-ui-proof`.

## Production acceptance after approved merge/deployment

1. Sign in to Martin Pharma at https://mp.pharmhelm.com. Open Finance → Management → Cash & Banking. Confirm seven default cards and that bank registration is absent from the overview.
2. Confirm any partial liquid subtotal is labelled; credit and welfare must not be included. Compare visible wallet/branch balances against their linked reconciled account records.
3. Open Bank. Confirm account registration, account status, opening reconciliation, consolidated ledger, individual ledgers and return navigation are inside Bank Portfolio. If a legacy bank reserve may overlap individual bank balances, consolidation must remain unavailable until an authorised allocation resolves it.
4. Open Branch Cash Sales and select Masaka. Confirm branch, business date and shift are visible in EOD transaction details. Check date, direction and source-branch filters without changing the current balance.
5. On a legitimate scheduled Masaka EOD, record existing destination balances and submit once for the actual date and shift. Cash/MTN/Airtel must increase by the declared channel amounts. Card must reach Masaka's configured settlement bank. No separate Finance posting step should exist. Do not seed sales or alter balances for demonstration.
6. Reopen the same reconciliation and verify exactly one posted entry per nonzero channel. Retrying must not add funds. A missing destination opening must block the whole submission, name the account and leave every balance unchanged.
7. Inspect a legitimate previous-day shift reconciliation where evidence exists. Verify business date and shift in the ledger. Use IT correction only for an actual authorised correction within the existing 14-day window, with a reason.
8. Open Credit Receivables. Check saved outstanding records and repayments; unresolved POS linkage warnings must remain visible. Open Staff Welfare Fund. Confirm saved records are readable and no spendable cash balance or new cash transfer is implied.
9. Check custom portfolio ledger, opening evidence and lifecycle history. Use new registration or deactivation only for a real approved operational need.
10. Repeat navigation on phone/tablet and with a finance view-only account. Registration and monetary actions must be hidden for view-only users.

## Deployment boundary and limitations

Do not merge or deploy without explicit user approval. No production financial data, openings, account identities, rules, billing settings, hosting services or migrations were modified. No historical EOD backfill is included. Existing organisation-only custom registration and never-funded deactivation restrictions are retained. An unreconciled welfare reserve remains unavailable pending a separately approved accounting design. Source receipt evidence remains in existing POS and EOD audit screens; it is never added again to Treasury funding.
