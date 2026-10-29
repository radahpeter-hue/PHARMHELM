# Level 3 live-acceptance repairs

Base production main: 10bc85b918f587feb55190ca3f9a7486945162d1.

1. Audit/correction dialogs inherit white text from the app body on white panels. Explicit zinc-900 text fixes headings, totals, Close and correction labels. The audit view is read-only; Correct EOD remains a separate IT Head action inside 14 days. Tested against a white-text ancestor, not only the prior light fixture shell.
2. 28 October's six Masaka receipts total 35,600 (8,000 + 5,000 + 6,000 + 1,000 + 1,000 + 14,600). They predate 29 October deployment and lack saved shift evidence. Owner explicitly confirmed in this session that all six belong to Day Shift 07:30–17:00. No timestamp-based automatic backfill is introduced.
3. IT Head can select legacy receipts in the EOD review dialog, supply a reason and explicitly attest the historical shift hours. An atomic, immutable eod_shift_assignments record reserves each receipt to one tenant/branch/date/shift. Existing POS evidence cannot be replaced. Sales/payment/ledger documents are never updated. EOD projects the verified evidence to calculate expected totals. Staff cannot guess or silently infer historical assignments.
4. Missing shift selection blocks Reveal System Totals and submission. Missing receipt evidence blocks variance display and submission, with an explicit unavailable-expected-total message. Verified yesterday/prior dates use their saved business date. A next-day daytime legacy sale does not incorrectly block yesterday's day shift; unresolved early-hours overnight sales do block it.

Validation:
- 766 unit/regression tests PASS; typecheck/build PASS.
- Full actual Finance/Welfare/Settings browser suite PASS at 360/390/1280px, including inherited white text, audit/Close readability, no-shift reveal denied, incomplete evidence denied, and a synthetic copy of the six-receipt prior-day scenario: verified expected 35,600, declared 35,600, variance zero and no sales writes.
- Full staff/EOD/system identity/Martin synthetic staging emulator runner PASS. New authenticated cases cover IT Head-only verification, immutable assignment, idempotent replay, conflicting date/shift reassignment denied, wrong branch, foreign tenant and cashier writes denied. Original EOD duplicate tests, correction locks and financial-snapshot checks remain green.
- Narrow Rules addition only: source 196,869 → 198,592 bytes; generated equivalent 142,697 bytes. Existing Rules compiler unchanged; CI must certify actual hosted executable/activation size before release. Existing expression-cap denials in unrelated negative identity tests remain baseline behavior. Allowed EOD legacy/checkout scenarios pass.
- No production receipt data or financial records modified during tests. Owner confirmation supplies review evidence; the IT Head must save the receipt selection in the live application.

This correction branch validates with isolated fixtures. Its automatic Hosting preview is intentionally disabled because the new legacy verification permission must be activated before exposing the feature against the shared production backend. Established release ordering deploys/verifies Rules before Hosting. No Levels 4–6 changes.

Owner retest after release:
- IT Head → Masaka → EOD → 28 October → Day Shift.
- Review legacy receipts for this shift → select exactly the six receipts → reason → attest historical hours → Save verified shift evidence.
- Declare 35,600 → Reveal System Totals → Expected 35,600, Variance 0 → submit once.
- View audit is readable; Correct EOD edits declarations only inside the original 14-day window.
