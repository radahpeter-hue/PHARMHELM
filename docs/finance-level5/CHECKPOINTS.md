# Finance Level 5 checkpoints

Baseline: `main` / `230d2961fcfddbb142085ac969b4a3a911af1afa`.
Live Martin Pharma login asset independently matched this SHA on 6 November 2026.
Branch: `feature/finance-rebuild-level5-transfers`.
No Level 6 work. No production financial writes. No merge/deployment authorization for this branch.

## 059: transfer record contract

Files: `portfolioTransfer.ts`, `portfolio-transfer-contract.test.ts`.

Records preserve tenant, class, endpoint account/portfolio/branch identities, principal, separate charge, UGX, business reference, actor/time, immutable completion state, idempotency key and explicit source/destination/charge movement references. A future correction uses a separate linked record; the original cannot be edited.

Targeted tests: 3 passing tests cover linked movements, zero/positive charge, integer precision/overflow, invalid/same/foreign endpoints, audit identities and reference identity across sessions.
TypeScript: passed.
Balances before/after: unchanged; this checkpoint contains no persistence or financial mutation.
Ledger result: deterministic references only, no entries created.
Security result: pure contract rejects tenant mismatch and incomplete identity. Persisted authorization remains a required next checkpoint.
Regression: none observed.
Accepted: YES (contract checkpoint only).

## 060A: Bank-to-Bank principal posting

Files: `portfolioTransferService.ts`, `portfolio-transfer-emulator.mjs`, `firestore.rules`, Finance validation workflow.

A new transfer record, source debit, destination credit and both authoritative balance updates commit in one Firestore transaction. Fresh linked movements are required by Rules; a record alone, either leg alone, missing/inactive/foreign accounts and a forged transfer tag cannot post. Transfer records and movements cannot be edited or deleted. A denied concurrent rewrite is resolved only by reading and matching the already committed winner. A changed amount or endpoint with the same reference is a conflict, never a duplicate posting.

Source and destination are active, reconciled, individual UGX Bank accounts under the Bank Portfolio. No generic consolidated Bank destination. Existing Finance initiation roles remain authoritative; IT-only and view-only users cannot transfer. No global permission-map changes or relaxed existing financial authorization.

Balance proof: Equity 10,000,000 / Stanbic 5,000,000 -> transfer 2,000,000 -> Equity 8,000,000 / Stanbic 7,000,000. Aggregate 15,000,000 unchanged. Repeat reference changes neither balance. Concurrent same-reference submissions create one transfer; competing different-reference spending cannot overdraw. Successful test sequence reconciles opening plus all six immutable movements to final 2,000,000 / 13,000,000 balances and three transfer records.

Charges are deliberately blocked at this principal checkpoint; Change 069 onward must add their separate movements only after the first route clears the Rules gate. No Level 5 UI is exposed yet and later routes are not implemented.

Targeted authenticated emulator: bank posting, sequential replay, concurrent sessions, conflicting intent, competing spending, insufficient/invalid amount, same account, generic Bank rejection, inactive source/destination, unsupported FX, IT/view-only/wrong-tenant denial, partial posting failure, orphan/forged movements, immutable history, and full balance reconciliation.

A permission-denied/error-limit message on the losing concurrent write was isolated with emulator Rules coverage. The initial posting was valid. Verified winner read-back fixes that retry without weakening permissions. Unnecessary role/ordering experiments were discarded; existing account authorization and generic fallback conditions are unchanged.

Accepted: PENDING hosted compilation and regression CI. Do not advance to other routes while this gate is unresolved.

## Level 5 completion candidate

The release generator binds incoming and existing document snapshots in eligible create and update grants. The authored predicates, roles and match scopes remain the source of truth. Firebase accepted the compacted Bank principal checkpoint. The final candidate requires its own hosted compilation result.

The transfer engine now handles Bank to Bank, Branch Cash Sales to a selected Bank or same-branch Petty Cash, MTN and Airtel to a selected Bank, selected Bank to branch Petty Cash, and transfers involving a registered custom portfolio whose direction flags permit them. Custom child-account transfers are conditional on a registered child-account model. The current registry provides individual Bank children and standalone custom portfolios.

Treasury provides account selectors, a separate optional charge, a transaction reference, and history filters by date, class, source portfolio and destination portfolio. The form uses a submission lock. Transfer principal stays out of the expense ledger. Branch-account ledger entries are excluded from the Management Petty Cash balance and opening reconciliation.

### Acceptance

Use reconciled test accounts and a Finance operator assigned to the branch.

1. In Finance, open Management, Cash & Banking, then Portfolio transfers and history.
2. Post a Bank transfer with a small principal and fee. Confirm the destination gains the full principal, the source loses principal plus fee, and the source ledger shows separate debit and charge entries.
3. Retry with the same reference and values, then change the principal and reuse the reference. Confirm the exact retry replays and the changed intent is rejected.
4. Verify the Branch Cash Sales, mobile-money, Petty Cash and custom routes above. Verify an unassigned branch and a custom portfolio with its direction disabled are rejected.
5. Review both account ledgers and transfer history, including date, class and portfolio filters. Confirm a viewer can read history and an IT-only or view-only account cannot post.
6. Confirm immutability and use a separate linked correction in a later reversal release when required.

Hosting preview shares production Firebase. It supports interface review. Authenticated emulator tests exercise the candidate write rules, including concurrent submissions, insufficient funds, atomic posting, forged movements, tenant and branch boundaries, and separate fees.
