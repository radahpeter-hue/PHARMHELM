# Phase 5 development acceptance evidence

This record supersedes historical implementation status, but is not permission to merge,
deploy production rules, activate financial flags, or post live financial transactions.
PR: https://github.com/radahpeter-hue/PHARMHELM/pull/90 (draft).
Branch: `feature/finance-v2-phase5-hr-advance-validation-20261021`.

## Milestone 5.1: salary liability recognition

Certified development checkpoint: `a82232c610f7bb857fbc5e17ad74eff923bbf10d`.

- HR signs the exact employee, branch, period, remuneration and deduction snapshot in
  `payroll_approvals`, paired with an immutable revision. Rejected/superseded signatures
  cannot finalize. Changing the snapshot requires another HR revision.
- A different Finance user atomically creates deterministic payroll, payslip and payable
  state. An exact retry recognizes no additional expense or obligation.
- Gross remuneration and employer NSSF are expenses. PAYE, employee/employer NSSF,
  other authorized deductions and employee net pay are separately attributed obligations.
- Unpaid reversal requires independent HR authorization and an immutable Finance reversal.
  Original records remain available. No account balance changes during recognition or void.
- Attendance includes approved recorded hours; paid leave also needs a matching approved
  paid-leave record. No assumed calendar attendance or duplicate unpaid-hours deduction.

Evidence:
- Payroll validation: https://github.com/radahpeter-hue/PHARMHELM/actions/runs/39736465761
- Compiled executable gate: https://github.com/radahpeter-hue/PHARMHELM/actions/runs/39736465760
- Hosting preview: https://github.com/radahpeter-hue/PHARMHELM/actions/runs/39736465752

Statutory source verification, 22 October 2026:
- URA, “Changes to PAYE return form following the Income Tax (Amendment) Act 2026”,
  published 7 September 2026, effective 1 July 2026:
  https://ura.go.ug/en/changes-to-paye-return-form-following-the-income-tax-amendment-act-2026/
- NSSF, membership guidance, employee 5% and employer 10% of gross wages:
  https://www.nssfug.org/about-us/membership/
- Existing dated resident-employee tax policy was retained. Consultant, nonresident and
  secondary-employment assessments require explicit Finance/HR review, not automatic
  application of resident employee bands.

## Milestone 5.2: account-funded salary settlement

Certified development checkpoint: `8e7f7eadee5d9bbea8d2834625d5f86956076a5a`.

- Canonical account register: `finance_payment_accounts`, `controlVersion: 2`.
- Canonical journal: immutable `finance_v2_events` and `finance_v2_account_movements`.
- Salary payment is paired with `payroll/{id}/settlements/{requestId}`, payable state,
  principal movement, any separate charge movement, and an immutable funding-account
  payment-reference claim. One transaction updates all records.
- Rules independently enforce tenant, assigned branches, funding ownership/type/eligibility,
  active initialized UGX account, outstanding payable, whole UGX and sufficient funds.
- Partial/full payments, exact retries, changed-ID duplicate references and competing
  transactions are covered by authenticated emulator tests. Principal settles the accrued
  payable; only external charges create additional expense.
- New accounts register at zero. A Finance reconciliation request, different owner approval,
  and Finance posting establish a verified opening with an immutable positive movement.
  Openings are neither revenue nor expense. Tenant-wide opening references cannot be reused.
- Opening evidence must confirm no other account already represents the same funds.
  The application does not infer funds from POS revenue, EOD declarations or welfare allocations.
- Activation requires `system_settings/{tenant}.phase5SalarySettlementEnabled == true`.
  This flag has not been enabled by this development work.

All five CI workflows passed on this checkpoint:
- Payroll, emulator denials, mobile UI: https://github.com/radahpeter-hue/PHARMHELM/actions/runs/39743326929
- Actual compiled-size gate: https://github.com/radahpeter-hue/PHARMHELM/actions/runs/39743327018
- Management Cash acceptance: https://github.com/radahpeter-hue/PHARMHELM/actions/runs/39743327032
- POS Foundation and read-only identity audit: https://github.com/radahpeter-hue/PHARMHELM/actions/runs/39743326914
- Hosting preview: https://github.com/radahpeter-hue/PHARMHELM/actions/runs/39743326923

## Milestone 5.3: welfare and advance integration candidate

Candidate: `8dec688c06ab28f6355232b0831ca4a4ca8dee91`. Not certified until the
compiled-size gate and all relevant final-commit checks succeed.

- `advance_requests` remains the canonical approval request. Approval alone posts no cash,
  expense or receivable. A full, one-time funded disbursement creates a verified principal
  receivable in its state and the canonical journal. HR, owner and disburser must be distinct.
- One explicitly identified verified advance may be recovered per employee payroll.
  HR approval covers its ID and amount. Finance finalization atomically reduces that
  advance receivable and records immutable recovery evidence, without moving cash.
- Recovery cannot exceed current outstanding principal, including concurrent finalizations.
  Voiding wholly unpaid payroll restores the recovery atomically with immutable evidence.
- Canonical `welfare_records` holds non-repayable benefits/claims. HR prepares an immutable
  request, a different owner approves or rejects, and Finance recognizes the expense and
  unpaid liability. Actual partial/full settlement uses the same funded journal controls.
- Existing POS medical-benefit allocations and utilization remain distinct non-cash records.
  No bank balance is credited from these allocations. A contribution or co-pay must not be
  relabeled as an advance or a second cash expense.
- Dedicated staff authorization now excludes the generic tenant fallback; employee role
  escalation and cross-tenant staff mutations are denied in the financial security suite.
- Legacy requests lacking branch attribution are not silently migrated. Authorized users
  may inspect a known request ID; financial settlement still verifies the employee branch.

Candidate checks:
- Payroll CI: https://github.com/radahpeter-hue/PHARMHELM/actions/runs/39748576308
- POS CI: https://github.com/radahpeter-hue/PHARMHELM/actions/runs/39748576335
- Size check/retry: https://github.com/radahpeter-hue/PHARMHELM/actions/runs/39748576498
- Local: 727 unit tests, TypeScript and production build passed. Payroll/welfare and
  Management Cash authenticated emulator suites passed. Eleven additional transformed-rule
  regression suites passed, including Martin Pharma identity staging.
- One local legacy POS recovery test returned emulator `INVALID_ARGUMENT: Transaction is
  invalid or closed`; an identical retry passed. This is not recorded as a first-run pass.

## Remaining acceptance and release constraints

- Milestone 5.4 reconciliation/report integration and 5.5 financial acceptance are pending.
- No authenticated production financial UI acceptance is claimed. Current financial emulator
  fixtures are synthetic tenant-a/b1; Martin Pharma identity staging is separate evidence.
- Paid financial records cannot be mutated or deleted to correct a mistake. A paid correction
  requires a separately verified refund/adjustment and owner authorization; no live refund
  or adjustment has been executed.
- PR #88 Cash & Banking is not signed off by salary-specific certification. V2 transfers
  remain denied until independently certified. No paid transaction backend was imported.
- Final release requires owner approval of the exact commit, preview acceptance, compiled
  rules fingerprint, index deployment, feature activation and opening-balance reconciliation.
- Do not prepare a definitive Phase 6 handoff until Phase 5 is accepted and the authoritative
  roadmap has been inspected.
