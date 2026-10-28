# Staff identity, petty cash exports and EOD correction follow-up

Base production: `0c93794ca8b3602e34b2f25adfe96dda00ea7c10` (Finance Levels 1–2, PR #93).
Working branch: `feature/staff-identity-petty-cash-followup`; PR #94.
The owner explicitly authorised permanent staff numbers and narrow staff/EOD rule changes.

## Staff identities

Retains the established tenant-scoped `STF-000001` format and allocator. Each number has an immutable `staff_identity_claims/{tenantId}_{code}` reservation bound to its original staff document. Transactions allocate numbers atomically with staff creation/backfill. Counters cannot decrease or be deleted. Claims cannot be updated or deleted. Retrying the backfill preserves previously assigned numbers. A stale counter collision fails closed; it never steals a reserved number.

`staff_code` remains fixed; internal document identities and historical `employee_id` fields are preserved. New activation retains its original staff record as an inactive alias and links the Auth UID to that same person's reservation. Once linked, that canonical UID cannot be reassigned to another account. Numbered staff departures deactivate the employee instead of deleting their identity. Codes are unique within the tenant namespace; identical local numbers in different tenants do not identify the same person.

The HR Staff Directory includes **Assign missing staff numbers** for HR/IT/owner management. It reads the tenant's actual authoritative register, checks duplicate existing codes before writes, reserves existing codes first, and numbers missing records. The one-time release workflow runs a read-only preflight on PR #94, then applies the authorised Martin Pharma backfill only after the successful production deployment of that merged PR. It verifies the target tenant, uses an atomic Admin SDK transaction, preserves existing codes and permanent claims (including departed staff), and verifies no missing codes/reservations remain. It changes only staff_code, staff reservations and the staff counter. The HR action remains available as an authorised retry mechanism. On partial failure, completed assignments remain valid and it is safe to retry.

Repeated names alone never trigger a data merge. Duplicate existing codes stop the backfill for review. Inactive activation aliases are skipped. Existing coded legacy records remain editable while their missing reservation is being established. Finance, HR attendance and payroll ID labels/exports prefer the readable code; it retains the original immutable staff document ID in the saved expense. Historical expenses resolve a subsequently assigned code through the staff record.

## EOD

Submitted documents are locked to ordinary users, Finance, owners, and IT Support. **IT Head** is the existing registered system role corresponding to the requested IT Manager. An IT Head assignment may be primary or secondary. The live Reconciliation Inbox provides a correction form for eligible records only.

The correction deadline is midnight Kampala time fourteen days after the original `reconciliation_date`. The boundary is exclusive: at the deadline the record is locked for everybody, including IT Head. Future/invalid dates fail closed. The database uses server time; changing the device clock cannot extend access.

Only declared channel amounts, their variance/total fields, and correction metadata may change. Date, tenant, branch, cashier, expected amounts, creation details and status remain fixed. Corrections require a reason and authenticated actor/server timestamp. EOD deletion is denied. The save transaction rereads the record and revalidates eligibility, then uses the existing safe monetary arithmetic. Exact matches retain zero variance without a variance reason; a correction reason is required for every correction.

This is record-edit protection, not shift-based EOD, duplicate-submission prevention, or a new financial/audit architecture.

## Petty cash downloads

Branch Requisitions and Incoming Petty Cash each expose CSV and Excel (.xlsx). Exports use the same filtered records as the screen, including the incoming received-history checkbox. They retain record/reference identifiers, branch/date/status, purpose or receipt details, and a numeric UGX total. Filenames include the branch and selected date bounds. Empty reports are disabled. CSV quotes and formula-like text are escaped; Excel uses the existing typed-cell exporter.

## Validation

- 740 unit/regression tests pass; TypeScript and production build pass.
- Eight targeted petty cash/date tests; ten targeted EOD monetary/edit-policy tests pass.
- Authenticated emulator tests: simultaneous staff allocation; duplicate names with distinct codes; permanent claim ownership; forbidden number overwrite, claim deletion and staff deletion; authorised legacy backfill and retry; UID activation with preserved alias; tenant and caller boundaries.
- Authenticated EOD tests: IT Head correction permitted today/day 13; owner, HR, cashier, IT Support rejected; day 14/day 15/future rejected; date and expected-value tampering rejected; foreign tenant and deletion rejected; exact-match and shortage correction arithmetic.
- Existing system-identity and Martin Pharma/Masaka synthetic staging emulator regressions pass.
- Isolated actual React browser tests pass at 360/390/1280px. They check filtered Excel payloads and downloaded CSV, recipient attribution and readable IDs, Allowance validation, EOD match/shortage/over/floating-point cases, and role-based correction form visibility/required reason.
- Authored rules: 192,978 → 196,609 bytes (+3,631).
- Existing release symbol generation: 138,184 → 141,139 source bytes (+2,955). This is source size, not Firebase executable size. The existing compiler script is unchanged. CI must separately pass inactive executable-size validation; no compaction/refactor is introduced.

## Release state

At preparation: not merged, not deployed; no live staff records written. CI and preview outcomes are recorded on PR #94. Preview Hosting shares the existing backend and cannot prove the new database protections until those exact rules are released. Use emulator/CI evidence for the new rules before release; use authorised management accounts for controlled live acceptance afterward.

Owner acceptance: verify the release backfill succeeded, then check existing/new staff and preserved expense attribution; records with repeated names are reviewed rather than merged; date-selected petty cash CSV/Excel totals match the screen; submitted EOD is locked for Finance/owner/support, recent IT Head correction succeeds, a 14-day-old record is locked even for IT Head.
