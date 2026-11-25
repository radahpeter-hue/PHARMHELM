# Level 11 recovery completion, 25 November 2026

Recovery PR: https://github.com/radahpeter-hue/PHARMHELM/pull/129. Validated code commit: `42f4bab55c66a6c79271176b1af5753ea551e39f`. All six required workflows on that exact commit passed. Recovery changes remain unmerged and undeployed; no live financial records or production rules were modified. The original implementation history below is retained as a historical record, not the current recovery release status.

## Result and verified size

The recovery keeps the existing payroll, Treasury and profitability engines. HR can identify an unpaid rejected pre-Level 11 Finance request, explicitly reconcile its historical employee entries, verify attendance and prepare a replacement. The original request and employee rows remain unchanged. Finance must confirm the linked historical entries before approval. Approval supersedes only those entries in P&L/statutory reports, preventing duplicate payroll cost. The recovery has one permanent source-based identity; corrections keep that identity and selected dates. Historical selections are immutable once submitted.

The HR summary separates approved outstanding salaries, pending/returned payroll, actual Level 11 payments and unconfirmed legacy history. A historical paid label alone is never payment proof. Missing and unverified attendance remain distinct from verified zero hours. Kampala month boundaries are generated as business dates. Submission is at the bottom of the reviewed draft and requires a separate confirmation; cancellation submits nothing and duplicate confirmation submits once. New employee/date reservations protect overlapping periods and stage atomically with each employee snapshot. Existing Level 11 records retain their revision/payment path.

| Evidence | Previous | New | Saved | Interpretation |
| --- | ---: | ---: | ---: | --- |
| Last targeted reduction | 249,877 | 249,605 | 272 | Local stripped emulator AST estimates |
| Recovery peak to accepted code | 252,478 | 249,605 | 2,873 | Local estimates, not hosted byte counts |
| Firebase compiled executable | Unverified preceding candidate | Smaller than 256,000 bytes | Exact saving unavailable | Exact candidate verified through hosted unbound release validation |

The [standalone size workflow](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/45631741205), job `139266477724`, passed at 14:15:18 UTC (17:15:18 Kampala). It verified ruleset `2799a91f-4381-4d45-a58e-70ac22f94670` and generated source SHA-256 `ca4cc2f01419d590826396873c233bca22145e7a57e2b5d732e7636161b4c7b1`, matching the locally tested artifact. Probe identity and ruleset identity were checked and cleanup passed. This was neither a control nor an upload-only result. Firebase did not return an exact executable byte count. The source file's 140,405 bytes are not an executable-size measurement.

## Validation and CI

Local checks passed 948 unit tests, TypeScript and the production build. Authorization comparisons passed 176 release, 480 identity, 12 lexical binding, 288 policy-family isolation, 968 type/range, 385 vector and 432 authority cases. Authenticated acceptance passed all 20 payroll groups, including 130 employees, interrupted resume, immutable revisions, returns, legacy recovery, concurrent overlapping dates, account controls, overpayment protection and the 367-day emulator case.

The exact generated rules also passed POS corrections/RBAC, operational inventory/procurement, portfolio transfers, Management Cash/supplier payments and receivables, including assigned-branch Finance Officer collection into a custom account. Additional tests passed 210-line Sellable/Operational orders and approvals, interrupted recovery/audit, GRN cash drafts, concurrent receipts, dispatch, supplier registration, automatic orders and Martin Pharma identity staging. Real-component UI tests covered 360/390/768/1280 pixels, legacy selection, Finance confirmation, cancellation and duplicate clicks.

| Required workflow | Exact code result |
| --- | --- |
| [Compiled executable size](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/45631741205) | Passed |
| [Management Cash, supplier and receivables](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/45631741132) | Passed, including its hosted size gate |
| [Level 11 payroll](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/45631741345) | Passed |
| [POS and inventory](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/45631745096) | Passed |
| [Finance Level 4](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/45631740954) | Passed |
| [Preview/build](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/45631740946) | Passed |

Administrative/migration skips are intentional. Documentation follow-up checks must also pass on the final PR head before final sign-off.

## Remaining boundaries and owner acceptance

No production payroll reconciliation or financial acceptance has been performed. HR/Finance must verify the original dates, employee selection and actual payment evidence; mismatched historical totals remain blocked. Recorded attendance still needs authorized verification. Existing statutory assessment policy is retained, and statutory remittance processing is outside this change. Funding accounts must already be eligible, reconciled and funded.

Date reservations add approximately one write per employee/day; unusually long/large payrolls can consume the Spark daily write allowance and require resumable staging. The 367-day case passed in the emulator, not against live financial data. A cumulative 2 GB local emulator heap failure after large-order suites was recorded; the remaining suites passed unchanged in fresh instances, and required CI passed. This does not certify a production transaction workload beyond the tested evidence. No deployment-dependent policy document or production configuration seed was introduced.

After separately authorized deployment, the owner should:

1. Open the old rejected Martin Pharma request and confirm its original dates and historical employee entries against payment evidence.
2. Verify attendance for Masaka; check missing, unverified and verified-zero cases. Recalculate and review the corrected draft.
3. Check that legacy unconfirmed amounts are separate from approved outstanding salaries.
4. Cancel submission confirmation once, then confirm once; verify one pending Finance request and no account debit.
5. Return with a reason, correct/recalculate under the same ID, and confirm the higher revision preserves earlier history.
6. Review the historical reconciliation in Finance, approve and confirm the employer cost appears once in P&L/statutory reporting.
7. Make an authorized partial payment from an eligible account, check the account debit, payslip and remaining balance, then settle the remainder.
8. Retry the payment reference and attempt overpayment and an overlapping period; confirm no duplicate debit or duplicate salary obligation.
9. Review the HR and Finance dialogs on phone and desktop. Confirm the original rejected request and legacy entries remain in audit history.

---

## Historical original Level 11 implementation report

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

Latest local validation, 24 November 2026: 935 unit tests, TypeScript and production build passed. Authenticated workflow suites passed for operational inventory/procurement/GRN/dispatch/receipt, portfolio transfers, payroll (13 acceptance groups including 130 employees and resumable staging), supplier settlements and receivables, including an explicit assigned-branch Finance Officer collection into a custom account. Comparison suites passed 176 original/released authorization cases, 385 vector cases, 512 type/range cases and 432 authority cases. No live Martin Pharma financial acceptance is claimed.

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


The same generated candidate was independently Firebase-verified again in [Management Cash run 45411169403](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/45411169403) on documentation/CI head fa4c066. Standalone environment parity did not resolve its unavailable verification. The validator now permits bounded retries against other stored copies only after byte-for-byte source verification, with a fresh hosted unbound probe for each copy. Explicit compiled-size errors remain fatal and no control can satisfy the gate. No rules policy or generated byte size changes in this follow-up. All required checks on the latest PR head remain mandatory before owner review.


## Standalone hosted gate completion, 24 November 2026

Validator/code commit 16e285d1cc171aefdd8b6894cfe36842563754bd passed the formerly blocking [standalone compiled executable check](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/45413001760), job 138511548261, at 14:22:42 UTC. Firebase accepted a fresh unbound release for ruleset 866e4620-baf0-4723-9c51-95b466cbbedf; its source SHA-256 matches the tested artifact above. Cleanup passed and no production release changed. This successful run recovered the first byte-identical stored candidate and passed after bounded probe retries; the new alternate-copy branch was not needed. The service's underlying 503 cause has not been proven.

| Size evidence | Previous | Current | Saved | Status |
| --- | ---: | ---: | ---: | --- |
| Local estimate, last rules reduction | 249,961 | 249,365 | 596 | Accepted by local financial/security regressions and hosted exact-source verification |
| Local estimate, entire continuation | 266,092 | 249,365 | 16,727 | Stripped emulator AST estimate only |
| Validator-only follow-up | 249,365 | 249,365 | 0 | Generated source unchanged |
| Firebase compiled executable | Exact count unavailable | Smaller than 256,000 | Exact saving unavailable | Hosted exact-candidate release verification passed |

The validator follow-up passed all 935 unit tests, TypeScript and production build locally. Required workflow evidence for this validated code candidate: [payroll](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/45413001759), [POS/inventory](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/45413001998), [Finance Level 4/Treasury](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/45413001784), [Management Cash/supplier/receivables](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/45413001742), and [preview/build](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/45413001800). Their actual outcomes, and checks on later documentation-only commits, are visible in the [existing PR checks](https://github.com/radahpeter-hue/PHARMHELM/pull/127/checks). All six required workflows must pass on the latest exact head; four administrative/migration skips remain intentional.

No merge, deployment or live financial acceptance is included. The owner checklist above remains the post-authorization acceptance step.
