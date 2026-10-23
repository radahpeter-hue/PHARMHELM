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

- Milestone 5.4 is implemented and under final-commit verification. Its read-only services
  `hrFinanceReportLoader` and `hrFinanceReconciliation` join canonical payroll, welfare,
  advance, account, event and movement evidence. They reject unauthorized scope and flag
  missing movements, orphan events, duplicate evidence, overpayment, outstanding drift,
  excessive recoveries, missing audit identity/time, unverified historical payroll and
  incomplete reversals. Concurrent changes during loading require a refresh.
- Finance and HR expose the same report panel. Payroll filters support period and employee;
  queries enforce branch scope. CSV exports include payroll, advances, welfare, accounts and
  movements with journal sources, payment references, operators and timestamps.
- Reports distinguish current verified positions from historical point-in-time statements.
  Overdue status uses an exact HR-approved salary due date. Missing historical due dates
  remain explicitly unverified. Unpaid accrual reversals are excluded from accrued totals.
- An old statutory export subtracted NSSF before PAYE and labelled payable salary as paid.
  It now uses the approved gross assessment and excludes reversed accruals. It refuses a
  statutory export containing unverified historical payroll.
- Paid leave was another authorization dependency: employees could previously forge an
  approved leave request through generic rules. Dedicated tenant/branch rules now require
  independent HR/owner reviewers; approved decisions are immutable. Each review retains
  its own authenticated identity and server timestamp. The application no longer offers
  one-person approval of both stages. Unsupported historical leave signatures contribute
  no paid leave hours until controlled reconciliation.
- Milestone 5.5 has a controlled authenticated-emulator acceptance implementation in
  `scripts/phase5-financial-reconciliation-emulator.mjs`. All 20 required scenarios passed
  locally, using synthetic Martin Pharma / Masaka employees, actual application transaction
  services and enforceable rules. The CI artifact `phase5-martin-financial-evidence` records
  preconditions, role, entity, action, expected and actual results, pass/fail, tested commit
  and outstanding issues for every scenario. Final-commit CI evidence is still required.
- No authenticated production financial UI acceptance is claimed. Hosting preview checks
  and isolated component browser tests are separate from authenticated emulator posting.
  No live Martin Pharma account, payroll liability or identity record was altered.
- Paid financial records cannot be mutated or deleted to correct a mistake. A paid correction
  requires a separately verified refund/adjustment and owner authorization; no live refund
  or adjustment has been executed.
- PR #88 Cash & Banking is not signed off by salary-specific certification. V2 transfers
  remain denied until independently certified. No paid transaction backend was imported.
- Final release requires owner approval of the exact commit, preview acceptance, compiled
  rules fingerprint, index deployment, feature activation and opening-balance reconciliation.
- Do not prepare a definitive Phase 6 handoff until Phase 5 is accepted and the authoritative
  roadmap has been inspected.

## Controlled Masaka reconciliation identity

The controlled fixture starts with a separately approved UGX 2,000,000 account opening.
Two resident primary employees each have UGX 500,000 approved gross remuneration.
URA's published July 2026 example confirms PAYE UGX 38,250 on that gross; an incorrect
UGX 27,000 expectation in the new acceptance fixture was corrected, without changing
the existing tax policy.

| Reconciled position | UGX |
| --- | ---: |
| Salary expense | 1,000,000 |
| Employer NSSF expense and payable | 100,000 |
| Employee PAYE payable | 76,500 |
| Employee NSSF payable | 50,000 |
| Verified advance payroll recovery | 20,000 |
| Recognized net salary payable | 853,500 |
| Verified salary payments | 486,750 |
| Outstanding salary payable | 366,750 |
| Advance disbursed | 100,000 |
| Outstanding advance receivable | 80,000 |
| Welfare expense and verified principal payment | 10,000 |
| Remaining welfare payable | 0 |
| Separate external charge expenses | 1,100 |
| Verified bank closing balance | 1,402,150 |

Salary expense plus employer cost reconciles to net salary, statutory obligations and
the advance asset offset. Bank closing equals 2,000,000 minus 100,000 advance principal,
486,750 salary payments, 10,000 welfare principal and 1,100 charges. The approved but
undisbursed employee A advance creates neither a receivable nor a recovery.

## Compiled rules gate: current failure supersedes earlier service errors

The exact `cd81224f4b165474594f050b2a8fd1e72c774d1d` candidate reached the
actual executable-size check in
https://github.com/radahpeter-hue/PHARMHELM/actions/runs/39935704727 .
It failed with HTTP 400: **278,513 compiled bytes**, against the strict
256,000-byte limit. This is a development defect requiring equivalent rule
optimization, not an external-data or service-availability exemption. The
Management Cash application/emulator/mobile checks passed, but its complete
workflow also failed the mandatory rules gate. Neither workflow is certified green.

On that same commit, Phase 5 payroll and all 20 controlled financial scenarios passed:
https://github.com/radahpeter-hue/PHARMHELM/actions/runs/39935704622 .
POS Foundation (including the unchanged identity audit) passed:
https://github.com/radahpeter-hue/PHARMHELM/actions/runs/39935704579 .
Hosting previews passed:
https://github.com/radahpeter-hue/PHARMHELM/actions/runs/39935704510 .
These results do not certify subsequent rule optimizations.

Equivalent field/comparison/write-map factoring in `95e1da4` reduced the actual
compiled executable to **265,002 bytes**, confirmed by the second attempt of
https://github.com/radahpeter-hue/PHARMHELM/actions/runs/39937530827 . This still
fails the limit. The next optimization shares complete immutable point-read maps
and exact authenticated-request atoms at their original evaluation sites; it must
be independently retested and certified, not presumed to fit from source size.

Earlier service diagnostic, retained as historical evidence:

https://github.com/radahpeter-hue/PHARMHELM/actions/runs/39930742795
tested candidate `22d7d0d91c595e2986577e4cb2d7e9910a50b74b`.
The candidate returned HTTP 503. A minimal inactive deny-all control returned HTTP 200;
the exact independently certified `8e7f7ead` release source also returned HTTP 503
(140,968 bytes; SHA-256 `aeb0cb77c9ebcbbe81366f5bd54d565530a33a1f93bb0f8d17cbe17934444f12`).
That run could not certify even the previously accepted control. It did not certify
a new candidate or establish its executable size. No check
was skipped or converted into a pass; no production release was modified.

POS CI also detected DOMPurify advisories in the old lockfile on 23 October 2026.
The sole dependency change is DOMPurify 3.4.16 to 3.4.17, as prescribed by upstream
https://github.com/cure53/DOMPurify/releases/tag/3.4.17 . The local production audit then
reported zero vulnerabilities. Final-commit POS CI must still pass.

## Owner-controlled release procedure, not executed

1. Require every critical final-commit workflow to pass, including the actual executable
   size gate. The certified baseline is diagnostic evidence only and never substitutes
   for candidate certification. Resolve every reconciliation exception before activation.
2. Review the draft PR's exact branch SHA and test evidence. Complete an authenticated
   emulator UI walkthrough on phone and desktop with separate HR, owner and Finance
   identities. Confirm leave review, HR payroll signature, Finance finalization, funding
   opening review, partial/full payment preview and report exports. Production preview
   alone cannot exercise new financial rules that have not been deployed.
3. Obtain separate owner authorization before merging, deploying rules/indexes or
   production Hosting, activating flags, migrating existing balances or posting live data.
4. After authorization, use the same deterministic rule transformation and compiled rules
   fingerprint that passed CI. Deploy required indexes and wait until ready; deploy the
   reviewed rules to the configured named database. Do not deploy authored/unverified
   alternate rule content. Retain the previous production ruleset and release evidence.
5. Reconcile account ownership, eligibility and unique opening evidence. Existing V1
   Management Cash/Bank balances must not be copied into V2 and counted twice. Registered
   zero accounts remain zero until the independent opening procedure is completed.
6. Enable `phase5SalarySettlementEnabled` only for the separately authorized tenant after
   these checks. Verify roles and assigned branches again. Disable the flag to stop new
   settlements if acceptance fails; preserve immutable financial history and investigate.
7. Reconcile the first approved controlled posting before expanding activation. Retain the
   operator identities, references, journal links, account balances and payable balances.
