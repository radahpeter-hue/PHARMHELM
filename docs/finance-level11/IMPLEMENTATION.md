# PHARMHELM PRO ERP: LEVEL 11 IMPLEMENTATION REPORT

Starting repository commit: `6bb897d29173447fed8d0451df10ccdee5963a7a`.
Branch: `feature/finance-level11-payroll-integration`.
Release: review only. No merge, deployment or live payroll/payment write authorized or performed.

## Implemented behavior

The existing HR engine, rates, attendance inputs, advance/fine deductions, statutory policy, reviewed adjustments, payroll reports and payslip interface remain. Statutory calculations were extracted unchanged into a tested helper. No Finance salary calculator was added.

Ordinary remuneration uses verified worked hours. Missing, unverified and verified-zero attendance are distinct. Approved paid leave uses actual leave dates and bounded approved days; overlapping attendance and duplicate leave do not pay twice. Unpaid absence already earns no attendance pay and is not deducted twice. Attendance verification requires HR or an assigned branch manager; editing revokes verification.

The original discrepancy has identifiable code causes: fractional hourly rates flowed into unrounded employee net values, the UI rounded selected displays, Finance received the unrounded sum, its generic modal allowed changing the amount, and employee/payslip/Finance writes were independent. This does not establish the exact historical 16-person calculation without its source data. New nonnegative monetary components round half up to whole UGX; net is integer earnings minus integer deductions. The Finance amount is the accumulator sum of finalized employee nets.

A permanent tenant/period document ID and human-readable PAY reference link every revision, employee record, payslip, approval, payment and account movement. Submission stages one employee at a time with a rules-checked accumulator and immutable revision snapshot. Only a complete reconciled batch creates the Finance draft. Retries resume; an explicitly selected restart can replace interrupted staging with an audited new revision. Returned payroll retains its ID and immutable earlier revisions.

HR submission creates neither expense recognition nor an account debit. Finance approves or returns the current revision with a mandatory reason. Approval activates the employee salary obligations and recognizes gross earnings plus employer NSSF once through the existing Level 9 P&L engine. Net salary payable, PAYE, employee/employer NSSF and other deductions remain separately recorded. Recorded deductions are not certified remittances.

Payments require an approved current revision, an explicitly selected eligible reconciled Treasury account and sufficient funds. Salary/payment/account movement/account balance/payslip/batch changes commit together. Partial and full payments update actual paid and outstanding amounts. Persistent request and account/reference identities reject conflicting retries; transactions prevent concurrent overpayment. Bank, MTN, Airtel and eligible matched-branch accounts reuse existing Treasury eligibility controls.

HR and Finance read the authoritative batch lifecycle. Employees read their own payslip and a restricted status projection, without reading the full batch. Historical payroll records retain their legacy interpretation and are labelled unreconciled payment evidence; no historical debt or account debit is created. Payroll settlement movements enter the existing cash-outflow report without a second expense.

## Validation and boundaries

Executed during implementation: 907 unit tests, TypeScript and production build passed; 13 authenticated payroll acceptance groups passed against authored and compact equivalent rules, including 130 employees, interrupted submission/restart, approval, partial/full payment, direct forged transaction rejection, selected bank/MoMo/branch funding, concurrency and payslip privacy. Receivable and supplier settlement emulator regressions passed. Final CI and mobile fixture results must be read from this PR before release acceptance. Local interactive browser preview could not reach the executor server. No live Martin Pharma financial acceptance is claimed.

The new Level 11 CI workflow tests real components with synthetic data at 360, 390, 768 and 1280 pixels. Automatic Hosting preview publication is excluded for this branch, respecting the no-deployment instruction.

Limitations: existing statutory assessment policy is retained, not recertified as legal/tax advice. This change records statutory obligations but does not add statutory remittance processing. Existing unverified attendance must be reviewed before new payroll preparation. Funding accounts must already be registered, reconciled and funded. Approval/settlement is restricted to active central Finance authority; branch-restricted officers cannot approve organisation payroll. Payroll identity prevents duplicate exact-period submissions; overlapping independently selected periods still require HR review. All-zero net batches remain approved without inventing a payment.

## Owner acceptance checklist after separate release authorization

1. Verify Masaka attendance, then prepare a period with zero, partial and full attendance and approved paid/unpaid leave.
2. Review each employee. Check the UGX 600,000 / 200 hours / 120 verified hours example produces UGX 360,000 attendance remuneration before adjustments.
3. Confirm finalized employee net values sum exactly to the Finance draft and no salary is marked Paid on submission.
4. Return the draft with a reason; correct an allowance and resubmit under the same ID with a higher revision.
5. Approve in Finance; check gross plus employer NSSF appears once in P&L while account balances remain unchanged.
6. Record a partial salary payment from an explicitly selected account. Check its debit, remaining salary balance, reference, HR status and employee payslip.
7. Record the remainder; verify employee/batch Paid status only when obligations are settled, without another expense.
8. Retry a reference and attempt overpayment; verify no duplicate debit. Review long names and modal scrolling on phone and computer.
9. Confirm historical payroll remains unchanged and is not turned into new liabilities.
