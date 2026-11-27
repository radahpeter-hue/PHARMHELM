# PHARMHELM PRO ERP: Level 12 implementation checkpoint

Status: work in progress. Not release-ready. No merge, deployment or live financial writes authorized or performed.

Starting main: 4032248170ea06daa355fd2153f1f3c1dd19f791.
Branch: feature/finance-level12-welfare.
Verified deployment baseline: production run 45763911186 succeeded for the starting commit; the served JavaScript independently contained build 4032248 on 26 November 2026.

## Implemented paths

Dedicated Finance Management Welfare screen, read-only Treasury view, zero-opening reserve for new funding only, classified existing Petty Cash Requisitions, Finance/CEO approval segregation, atomic source issue and recipient receipt, employee reservations, immutable recall evidence, actual utilization, linked expense and existing Treasury transfer execution. The portal uses funded records, while preserving historical records separately. No historical balances are imported.

One new collection, finance_welfare_v1, contains employee reservation states and immutable operational events. Cash remains in the existing finance_payment_accounts registry, with reservedUGX protecting outstanding allocations. Existing petty_cash_ledger, branch_expenses, petty_cash_requisitions, petty_cash_issues and finance_transfers_v1 are reused.

## Verified earlier checkpoint

The authenticated emulator scenario passed the complete 1,000,000 funding, 300,000/200,000 allocations, 100,000 utilization, 100,000 recall, 50,000 reallocation and 200,000 bank transfer. Final cash 700,000, reserved 350,000, unallocated 350,000, employee balances 100,000 and 250,000. Replay, authorization, privacy, immutable event, overdraw and concurrent allocation/transfer checks passed. A subsequent hardening pass adds financial payload allowlists and inactive-account rejection; this final candidate must be retested separately.

The existing 948 unit tests, TypeScript and build passed at the resumed checkpoint. Five additional tests passed for full arithmetic, committed reservations, invalid amounts, profitability and outflow reporting. Final aggregate results must be recorded after execution.

## Open acceptance blockers

- Compiled capacity is unresolved. Starting stripped emulator AST estimate 249,605. First funding/allocation rules 268,044; transfer candidate 269,388; optional-reader experiment 267,944. These estimates are not hosted executable sizes. Later hardening changes need fresh measurement. Smaller-list/path-specialization experiment increased the estimate to 271,326 and was rejected.
- Exact final-candidate hosted certification has not passed. Existing mandatory gates remain intact.
- Full POS welfare integration with funded reservations and receipt corrections still needs completion and regression verification. Do not activate the new reserve in production while legacy welfare spending can diverge from it.
- Existing pending/vested welfare evidence and historical cutover need reconciliation. No new opening balance or historical correction is inferred.
- Complete direct-write forgery/concurrency suites and final full financial regression CI are outstanding.
- Browser/mobile verification is outstanding. Scrollable dialogs and review controls are implemented but are not browser-tested.
- Transfer origin must be enforced by the dedicated contract and authorization; a client-provided reason alone cannot attest which screen initiated it.

## Owner acceptance after engineering certification

Use separate authorized requester, Finance approver/issuer and CEO. Confirm no funds are allocatable before receipt. Execute the complete requested acceptance sequence and verify 700,000 = 350,000 + 350,000, employee portal balances, 100,000 welfare expense, bank credit and immutable references. Try over-allocation, reserved-fund transfer, committed-fund recall and duplicate submissions. Review phone dialogs. Do not perform historical cutover without separate approval.
