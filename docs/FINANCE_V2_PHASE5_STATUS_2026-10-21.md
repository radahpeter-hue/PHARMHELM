# Finance & Welfare V2 Phase 5: evidence and release gates (2026-10-21)

## Work completed in development branch
- Reused staff, payroll, payslips and advance_requests. No new competing register.
- Employee advance request UI validates safe positive whole UGX and bounded repayment periods.
- Approved advance requests are reported as awaiting disbursement, not as verified outstanding loan balances.
- Payroll draft generation no longer fabricates attendance hours when none were recorded.
- Payroll advance recovery selection requires Disbursed status, not approval alone. A proper disbursement ledger and outstanding balance remain prerequisites for certified recovery.
- Reviewed draft changes require whole-number reconciled net pay.
- Legacy payroll finalization is now fail-closed. The original per-employee payroll and payslip writes were non-atomic; they could mark paid payroll and create an expense request without actual disbursement.
- Added targeted unit tests for basic advance and payroll arithmetic.

## Not certified / required future work
1. Source-to-policy reconciliation: verify actual staff, attendance, leave, advances, timesheets and payroll document schemas; define scheduled paid leave and salary entitlement when attendance is missing.
2. Tax rules: hardcoded statutory NSSF/PAYE rules in PayrollManager require jurisdiction-specific dated, verified tax policy. Do not interpret draft values as certified statutory remittances.
3. Atomic payroll finalization: authenticated tenant-scoped, deterministic staff-period identity and duplicate-proof batch write. Verify compiled Firestore rules size and emulator denial tests before enabling.
4. Approval and liability: immutable approved payroll period -> expense and payable via independently secured Finance posting. Approval is not cash payment.
5. Salary payment: account-funded, approved, atomic, partial/full, idempotent settlement with immutable account movement and payable reduction.
6. Welfare: confirm contribution, fund, loan and benefit policies; separate allocation, approval and actual disbursement.
7. Reporting: reconciled net salary, liabilities, payment history and welfare outstanding positions from source-of-truth records.
8. Security: tenant, branch, employee confidentiality, RBAC, maker/checker and immutable ledger emulator tests.
9. Final typecheck, unit, full build, Firestore emulator, rules compiled-size CI and controlled Martin Pharma Masaka acceptance.
10. Draft PR review, separate merge and production deployment authorization.

## Financial safety
- Firebase Spark only. No Render, Cloud Run, Cloud Functions, billing upgrade or independently trusted server.
- Draft computations must not be represented as posted payments.
- PR #88 is still uncertified for Spark financial posting; PR #89 is awaiting merge and acceptance.
- This increment does not constitute Phase 5 sign-off. Do not merge or deploy without separate approval.
