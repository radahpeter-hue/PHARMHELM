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
