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

Latest local validation, 24 November 2026: 931 unit tests, TypeScript and production build passed. Authenticated workflow suites passed for operational inventory/procurement/GRN/dispatch/receipt, portfolio transfers, payroll (13 acceptance groups including 130 employees and resumable staging), supplier settlements and receivables, including an explicit assigned-branch Finance Officer collection into a custom account. Comparison suites passed 176 original/released authorization cases, 385 vector cases, 512 type/range cases and 432 authority cases. No live Martin Pharma financial acceptance is claimed.

Firebase hosted verification: **the exact generated candidate for code commit 5b50958 was verified below the 256,000-byte compiled executable limit** by the [Management Cash workflow](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/45407924645), job 138493543551, at 2026-11-24 13:56:34 UTC. The validator returned `UNBOUND_RELEASE_SIZE_VALIDATION` for ruleset `cae9c12b-1d86-4c40-bc7f-5ecb87c5a251`, with generated source SHA-256 `a671b5a21389fc463eb311eb3cc29c807a43eb2a56c619137abba150dc75cf87`, exactly matching the locally tested release. No production release was modified. Firebase exposed no exact executable byte count, so **249,365 bytes remains a local stripped emulator-compiler AST estimate**, not a hosted measurement. The 141,141-byte source-file size is separate from both.

On that code commit, [POS](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/45407924758), [Finance Level 4](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/45407924673), [payroll and component-width tests](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/45407924863), [Management Cash, receivables and mobile UI](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/45407924645), and [preview/build validation](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/45407924710) passed. The [standalone hosted-size check](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/45407924784) initially failed with HTTP 503 and was retried after the identical source passed the independent hosted gate. This is exact-candidate evidence, not certification from a base/deployed control. Latest PR checks remain the release gate; the owner acceptance checklist below follows separately authorized deployment.

The earlier 262,286-byte hosted rejection belongs to df68519. No merge, deployment, production rules activation, configuration seeding or live financial write has been performed.

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


The same generated candidate was independently Firebase-verified again in [Management Cash run 45411169403](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/45411169403) on documentation/CI head fa4c066. Standalone environment parity did not resolve its unavailable verification. The validator now permits bounded retries against other stored copies only after byte-for-byte source verification, with a fresh hosted unbound probe for each copy. Explicit compiled-size errors remain fatal and no control can satisfy the gate. No rules policy or generated byte size changes in this follow-up. Exact-head CI acceptance remains pending.
