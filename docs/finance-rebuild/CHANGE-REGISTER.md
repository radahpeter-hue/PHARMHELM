# Sequential change register

Accepted means engineering acceptance after the recorded checks. Owner live acceptance is pending for every change. Existing requirements are verified rather than duplicated.

## CHANGE 001 — Rename management expenses to cash outflows

- Modified files: `src/modules/hr/LeaveAdvanceManager.tsx`, `src/pages/Finance.tsx`, `src/pages/finance/management/CreditLedger.tsx`, `src/pages/finance/management/ManagementExpenseLedger.tsx`, `src/pages/finance/management/ProfitabilityLedger.tsx`.
- Targeted checks: 12 existing Finance/settlement regression tests; source audit of navigation, headings, export and HR messages; storage collection names unchanged.
- TypeScript / production build: PASS.
- Result: PASS.
- Regression observed: NO.
- Accepted: YES (engineering); owner acceptance pending.

## CHANGE 002 — Rename global expenses to cash outflows

- Modified files: `src/pages/Finance.tsx`, `src/pages/finance/management/GlobalExpenseLedger.tsx`.
- Targeted checks: 12 Finance/settlement tests; UI/export label audit; existing collection and navigation identifiers retained.
- TypeScript / production build: PASS.
- Result: PASS.
- Regression observed: NO.
- Accepted: YES (engineering); owner acceptance pending.

## CHANGE 003 — Remove salaries from new manual branch expenses

- Modified files: `src/pages/Finance.tsx`.
- Targeted checks: 6 category-policy and Finance regression tests; historical category retained as disabled edit option; submit guard rejects new salary values.
- TypeScript / production build: PASS.
- Result: PASS.
- Regression observed: NO.
- Accepted: YES (engineering); owner acceptance pending.

## CHANGE 004 — Keep allowances available in branch expenses

- Modified files: `src/pages/Finance.tsx`, `tests/finance-rebuild-expenses.test.ts`.
- Targeted checks: Category policy, entry-option and data-driven report/filter coverage plus Finance regressions; no accounting changes.
- TypeScript / production build: PASS.
- Result: PASS.
- Regression observed: NO.
- Accepted: YES (engineering); owner acceptance pending.

## CHANGE 005 — Persist and display issued to on branch expenses

- Modified files: `src/pages/Finance.tsx`, `src/types.ts`, `tests/finance-rebuild-expenses.test.ts`.
- Targeted checks: Create/edit payload, edit rehydration and historical fallback coverage plus Finance regressions; horizontal table scrolling preserves mobile access.
- TypeScript / production build: PASS.
- Result: PASS.
- Regression observed: NO.
- Accepted: YES (engineering); owner acceptance pending.

## CHANGE 006 — Filter incoming petty cash by date

- Modified files: `src/pages/Finance.tsx`.
- Targeted checks: Inclusive, open-ended, inverted-range and historical-date tests plus Finance regressions; received-history toggle; balance continues to use unfiltered records.
- TypeScript / production build: PASS.
- Result: PASS.
- Regression observed: NO.
- Accepted: YES (engineering); owner acceptance pending.

## CHANGE 007 — Filter petty cash requisition history by date

- Modified files: `src/pages/Finance.tsx`, `tests/finance-rebuild-dates.test.ts`.
- Targeted checks: Independent requisition date-range filtering; previous-month historical retrieval and source preservation tests; full subscriptions retained.
- TypeScript / production build: PASS.
- Result: PASS.
- Regression observed: NO.
- Accepted: YES (engineering); owner acceptance pending.

## CHANGE 008 — Default requisition history to last seven days

- Modified files: `src/pages/Finance.tsx`, `src/utils/financeDateFilters.ts`, `tests/finance-rebuild-dates.test.ts`.
- Targeted checks: Inclusive seven-day default, Kampala midnight, year rollover and history preservation tests; no subscription limits or deletion introduced.
- TypeScript / production build: PASS.
- Result: PASS.
- Regression observed: NO.
- Accepted: YES (engineering); owner acceptance pending.

## CHANGE 009 — Allow wider petty cash history ranges

- Modified files: `src/pages/Finance.tsx`, `src/utils/financeDateFilters.ts`, `tests/finance-rebuild-dates.test.ts`.
- Targeted checks: Previous-month, all-history, year-boundary and leap-February retrieval tests; date controls remain unrestricted; historical source data retained.
- TypeScript / production build: PASS.
- Result: PASS.
- Regression observed: NO.
- Accepted: YES (engineering); owner acceptance pending.

## CHANGE 010 — Verify employee welfare admin separation already present

- Modified files: None; existing behaviour verified.
- Targeted checks: Actual role policy checked for six employee roles, six administrative roles and secondary HR assignment; management controls retained; no application change needed.
- TypeScript / production build: PASS.
- Result: PASS.
- Regression observed: NO.
- Accepted: YES (engineering); owner acceptance pending.

## CHANGE 011 — Expose explicit pnl reporting period filters

- Modified files: `src/pages/finance/management/ProfitabilityLedger.tsx`.
- Targeted checks: Today, Monday-Sunday Week, Month-to-date, full Monthly, calendar half-year, Annual and Custom; leap/boundary tests; Bi-Monthly omitted because no established semantics exists.
- TypeScript / production build: PASS.
- Result: PASS.
- Regression observed: NO.
- Accepted: YES (engineering); owner acceptance pending.

## CHANGE 012 — Expose branch pnl with exact branch attribution

- Modified files: `src/pages/Finance.tsx`, `src/pages/finance/management/ProfitabilityLedger.tsx`, `tests/finance-rebuild-pnl.test.ts`.
- Targeted checks: Tenant/branch alias and HQ-exclusion tests; assigned-branch selector; existing formulas applied to branch-tagged records; management permission boundary unchanged.
- TypeScript / production build: PASS.
- Result: PASS.
- Regression observed: NO.
- Accepted: YES (engineering); owner acceptance pending.

## CHANGE 013 — Identify consolidated organisation pnl separately

- Modified files: `src/pages/Finance.tsx`, `src/pages/finance/management/ProfitabilityLedger.tsx`, `tests/finance-rebuild-pnl.test.ts`.
- Targeted checks: Distinct report navigation, tenant-scoped reads and accounting-scope notice checks; consolidated formulas and unallocated HQ treatment retained.
- TypeScript / production build: PASS.
- Result: PASS.
- Regression observed: NO.
- Accepted: YES (engineering); owner acceptance pending.

## LEVEL 1 CHECKPOINT

Changes 001–013 complete; Level 2 has not started at this checkpoint.

- `npm test`: **715 passed, 0 failed**.
- `npm run typecheck`: PASS.
- `npm run build`: PASS. Existing bundle-size/dynamic-import warnings remain.
- Actual React Finance and Welfare browser tests: PASS at **360, 390 and 1280px** using isolated in-memory fixtures. Expense create/persist/display, historical salary visibility, allowances, separate incoming/requisition date controls, previous-month/all-history retrieval, Management/Global naming and existing records, separate branch/consolidated P&L, period controls, ordinary employee vs management Welfare visibility, and cashier Finance navigation verified.
- First responsive cycle found header/tab/date-control overflow at 360px. Fixed with responsive header stacking, horizontally scrollable Branch Ops tabs and wrapping date controls. All three widths now pass body-overflow checks.
- Screenshots visually reviewed at phone/desktop widths. Harness uses the existing light content surface and local fallback fonts; remote font imports are removed only from test CSS. No backend requests or tenant writes are possible in the isolated harness.
- `firestore.rules`: byte-identical to base.
- Level 1 engineering acceptance: **PASS**. Owner live acceptance pending.

## CHANGE 014 — Select expense recipients from authoritative staff register

- Modified files: `src/pages/Finance.tsx`, `src/utils/branchExpensePolicy.ts`, `tests/finance-rebuild-expenses.test.ts`.
- Targeted checks: Tenant/active-staff eligibility and duplicate-name tests; dropdown labels include staff code or document ID; invalid staff selections blocked; existing manual recipient retained.
- TypeScript / production build: PASS.
- Result: PASS.
- Regression observed: NO.
- Accepted: YES (engineering); owner acceptance pending.

## CHANGE 015 — Persist immutable staff recipient identity

- Modified files: `src/pages/Finance.tsx`, `src/types.ts`, `src/utils/branchExpensePolicy.ts`, `tests/finance-rebuild-expenses.test.ts`.
- Targeted checks: Stable document-ID attribution, display snapshot, duplicate-name/name-change tests and create/edit payload checks; staff ID visible in record review.
- TypeScript / production build: PASS.
- Result: PASS.
- Regression observed: NO.
- Accepted: YES (engineering); owner acceptance pending.

## CHANGE 016 — Allow explicit outsource external expense recipients

- Modified files: `src/pages/Finance.tsx`, `tests/finance-rebuild-expenses.test.ts`.
- Targeted checks: External-recipient persistence and no-staff-account creation checks; new-entry reset prevents stale edited staff attribution; Finance regressions.
- TypeScript / production build: PASS.
- Result: PASS.
- Regression observed: NO.
- Accepted: YES (engineering); owner acceptance pending.

## CHANGE 017 — Reject external recipients for allowances

- Modified files: `src/pages/Finance.tsx`, `src/utils/branchExpensePolicy.ts`, `tests/finance-rebuild-expenses.test.ts`.
- Targeted checks: Allowance alias and forged external-recipient tests; form switches to Staff and removes External choice; submit guard applies independently of UI hiding.
- TypeScript / production build: PASS.
- Result: PASS.
- Regression observed: NO.
- Accepted: YES (engineering); owner acceptance pending.

## CHANGE 018 — Require recognised staff when saving allowances

- Modified files: `src/pages/Finance.tsx`, `src/utils/branchExpensePolicy.ts`, `tests/finance-rebuild-expenses.test.ts`.
- Targeted checks: Fresh authoritative HR read before staff expense writes; shared payload validation rejects missing/fake/inactive/cross-tenant staff and external allowances; no Firestore Rules changes.
- TypeScript / production build: PASS.
- Result: PASS.
- Regression observed: NO.
- Accepted: YES (engineering); owner acceptance pending.

## CHANGE 019 — Require reasons for genuine eod variances

- Modified files: `src/pages/Finance.tsx`.
- Targeted checks: Shortage/over and offsetting-channel tests; machine-roundoff-only normalization; independent submit guard and disabled reasonless submit; stored channel/total variances use the same comparator.
- TypeScript / production build: PASS.
- Result: PASS.
- Regression observed: NO.
- Accepted: YES (engineering); owner acceptance pending.

## CHANGE 020 — Verify balanced eod needs no variance reason

- Modified files: `tests/finance-rebuild-eod.test.ts`.
- Targeted checks: Exact UGX 500000 match, six empty channels and floating representation equality; reason prompt/disabled state/save guard use the same normalized result; no duplicate implementation needed.
- TypeScript / production build: PASS.
- Result: PASS.
- Regression observed: NO.
- Accepted: YES (engineering); owner acceptance pending.
