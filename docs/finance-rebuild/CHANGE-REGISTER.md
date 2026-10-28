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
