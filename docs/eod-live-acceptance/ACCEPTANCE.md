# EOD live-acceptance repairs

Base production main: 10bc85b918f587feb55190ca3f9a7486945162d1.

- Audit and correction dialogs explicitly set dark text on white panels. Browser checks reproduce inherited production white text and verify headings and Close. View audit is read-only; Correct EOD remains the separate IT Head action inside the original fourteen-day window.
- The six Masaka receipts from 28 October total 35,600 (8,000 + 5,000 + 6,000 + 1,000 + 1,000 + 14,600). They predate the 29 October shift-capture release. Owner explicitly confirmed all six belong to Day Shift 07:30–17:00. No automatic historical classification or sale rewrite is performed.
- IT Head reviews/selects receipts, gives a reason and attests the hours that applied on that business date. One deterministic `audit_logs/eod_verify_<tenant>~<sale>` entry per receipt preserves the verified date/shift, sale timestamp, actor, server timestamp and reason. Replay is safe; conflicting date/shift assignments are rejected. Existing checkout attribution is never replaced.
- The evidence projection only accepts matching reserved document IDs, tenant, branch, receipt and original timestamp. Arbitrary audit entries cannot supply shift totals. Receipts/payment/ledger records are unchanged.
- Shift selection is mandatory before reveal or submission. Incomplete evidence blocks totals/variance and submission, with an explicit unavailable message. Next-day daytime receipts do not block yesterday's day shift; unresolved after-midnight overnight receipts do block that shift.

Validation:
- 766 unit/regression tests, TypeScript and production build PASS on the initial feature; latest evidence projection tests/typecheck/full responsive browser rerun PASS.
- Full authenticated staff/EOD/system/Martin staging regression passed. Latest actual Level 3 emulator passed again after the final Rules change: IT Head verification 35,600, immutable evidence, replay, conflicting assignment, cashier/foreign-tenant/wrong-branch denial, correction locks, no financial mutation and actual POS V2 checkout/replay.
- Actual Finance/Welfare/Settings UI passes at 360/390/1280px, including inherited white text, mandatory shift, legacy review of the exact six-value example, expected/declared 35,600, variance zero and no sales writes.
- Final Rules delta is six additions/two replacements inside existing audit_logs only. Reserved verification entries require primary/secondary IT Head, authenticated actor and server time; updates/deletion are denied. Other audit IDs retain existing behavior. No new collection, generic-fallback change, global permission map or compaction change.
- Source Rules: 196,869 → 197,337 bytes; generated equivalent: 141,655 bytes. Actual hosted compiler/activation-size certification is mandatory before release.
- Earlier candidates with a separate permission block measured 258,572 / 257,601 / 257,768 executable bytes and were rejected before release. That approach was removed completely. The final implementation reuses the existing protected audit trail and read boundary.

No production finance records were seeded or changed by tests. Only the IT Head's explicit in-app verification writes the selected receipt evidence. The dedicated Finance preview for this correction branch is disabled pending Rules activation; existing other Hosting preview workflows remain unchanged. Standard production ordering must verify Rules before Hosting. No Levels 4–6 work.

Owner retest after release:
1. IT Head → Masaka → EOD → 28 October → Day Shift.
2. Review legacy receipts for this shift → select exactly the six receipts → enter verification reason → attest historical hours → Save verified shift evidence.
3. Declare 35,600 → Reveal System Totals → Expected 35,600, Variance 0 → submit once.
4. View audit is readable. Correct EOD edits declarations only within the original fourteen-day window. The 14 October record shown in the screenshot is already outside that window on 29 October.
