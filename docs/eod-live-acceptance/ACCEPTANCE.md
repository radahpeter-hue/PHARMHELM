# EOD live-acceptance repairs

Base production main: `10bc85b918f587feb55190ca3f9a7486945162d1`.
Fix branch: `fix/eod-live-acceptance`. PR: #97.

## Result

- Audit and correction dialogs explicitly set dark text on white panels. Browser checks reproduce inherited production white text and verify readable headings and Close.
- View audit is read-only. Correct EOD remains the separate IT Head action inside the original fourteen-day window.
- Shift selection is required before revealing totals or submitting. Unresolved receipt evidence blocks totals/variance and submission instead of showing a false zero Expected.
- The six Masaka receipts from 28 October total UGX 35,600 (8,000 + 5,000 + 6,000 + 1,000 + 1,000 + 14,600). They predate the 29 October shift-capture release. The owner explicitly confirmed all six belong to Day Shift 07:30–17:00.
- IT Head selects verified receipts, supplies a reason and attests the historical hours. One deterministic `audit_logs/e_<tenant>~<sale>` record per receipt stores the verified date/shift, original receipt timestamp, actor, server timestamp and reason. Replay is safe; conflicting assignments are rejected.
- Evidence is applied only when the reserved document ID, tenant, branch, receipt and original timestamp match. Existing checkout attribution remains authoritative. No source sale, payment, revenue or ledger is rewritten.
- Next-day daytime receipts do not block yesterday's day shift; unresolved after-midnight receipts within an overnight shift do block that shift.

## Validation

- `npm test`: 766 unit/regression tests pass.
- `npm run typecheck` and `npm run build`: pass.
- `node scripts/run-staff-eod-emulator.mjs`: full authenticated staff, EOD, system and Martin staging regression passes.
- `EOD_LEVEL3_ONLY=1 node scripts/run-staff-eod-emulator.mjs`: final Rules pass actual-service verification of 35,600, simultaneous requests, replay, conflict rejection, immutable evidence, denied cashier/foreign tenant/wrong branch operations, anonymous denial, ordinary audit CRUD, correction locks and actual POS V2 checkout.
- `node scripts/run-pos-v2-spark-emulator.mjs`: final Rules pass quotation, atomic revision, role/branch/tenant authorization and legacy repair regressions.
- `FINANCE_LEVEL=2 node scripts/finance-rebuild-ui-smoke.mjs`: actual Finance/Welfare/Settings components pass at 360/390/1280px. Includes production inherited white text, mandatory shift, exact six-receipt review, expected/declared 35,600 and variance zero.
- Controlled exact/shortage EOD scenarios preserve sales, payments, revenue, bank, outbox and ledger snapshots.

## Security and release

The only Rules change is inside the existing audit_logs match. Reserved evidence requires primary/secondary IT Head, the authenticated actor and server timestamp. Reserved updates/deletion are denied. Existing ordinary and protected revision audit behavior is preserved. All other collection policies and global helpers remain unchanged.

Source Rules: 197,108 bytes. Generated equivalent release: 141,359 bytes. The actual Firebase compiled-executable activation-size gate passed on commit `429d081da57eee3aeb4dcffde565f23b1e2b86d9` in run [40844003376](https://github.com/radahpeter-hue/PHARMHELM/actions/runs/40844003376), confirming the executable is below Firebase's 256,000-byte limit. Firebase does not return its exact compiled size on success. Authenticated runtime scenarios pass without expression-limit errors. The temporary validation release was unbound to production and removed.

No new collection, global permission map, compiler rewrite, automatic historical migration or Levels 4–6 work. Earlier size-failing candidates were never merged or activated. Production release must activate and verify these exact Rules before Hosting. No live finance records were seeded or changed by tests.

## Owner retest after release

1. Refresh the app. IT Head → Masaka → EOD → 28 October → Day Shift.
2. Review legacy receipts for this shift → select exactly the six receipts → enter verification reason → attest historical hours → Save verified shift evidence.
3. Declare 35,600 → Reveal System Totals → Expected 35,600, Variance 0 → submit once.
4. Confirm no reveal/submission is possible without a shift.
5. Open View audit: readable details and Close; this view does not edit.
6. Use Correct EOD on a permitted recent reconciliation. The 14 October record in the screenshot is outside the fourteen-day window on 29 October and must remain locked.
7. Retry a completed date/shift and verify no duplicate. Confirm POS receipts and financial balances remain unchanged.
