# PHARMHELM Finance V2: Masaka test card
**Branch:** feature/finance-v2-phase3-cash-banking (PR #88)
**Pilot:** Martin Pharma / Masaka
**Infrastructure:** Firebase Authentication, Firestore, Firestore Rules, Hosting. Spark-only. No server API, paid compute or billing upgrade.
**Important:** This card distinguishes visual/UI checks from posted financial transactions. An unmerged preview is not production.

## A. Immediately testable on an authorised build of this branch (UI only)
1. Sign in to Martin Pharma as a user authorised for Masaka Finance.
2. Open Finance > Branch Operations > EOD Reconciliation.
3. Confirm the business date defaults to today's date in **Africa/Kampala**, including late-night use.
4. Confirm the shift selector lists only active shifts configured for Masaka in Settings.
5. Select one date and one shift; confirm only that branch's effective sales in the selected shift appear.
6. Enter declared values exactly equal to each displayed expected payment-method value. Select Reveal/Compare; each variance and the overall variance must be 0, never -0. No explanation should be required.
7. Change one declared payment-method amount by UGX 1. Confirm a shortage/surplus of exactly UGX 1 and that a reason is required.
8. Offset differences between two methods by +1 and -1 UGX. Overall variance is 0, but a reason **must still be required** because individual methods differ.
9. Change the selected shift or business date and confirm expectations are recalculated, not reused from the previous selection.
10. **Do not attempt to force EOD submission**: the old server API is not approved for Spark. A safe "unavailable" message is expected until certified client posting is implemented.

Record: tested build/preview URL, operator role, local date, selected shift, expected/declared cash, difference, outcome and screenshot. Do not record credentials.

## B. Not yet available for manual acceptance (engineering release gates)
- Transfer: Firestore Rules must independently validate both balances, both immutable movements, canonical envelope, actor, tenant, account and fee in the same atomic commit.
- POS cash: must fund Branch Cash Sales once per effective receipt, compensate edited/reversed receipts and never fund noncash allocations.
- EOD submission: must persist an immutable, deterministic per-tenant/branch/day/shift record verified against canonical POS totals with no second cash credit.
- Finance V2 ledger read permissions and account registration must stay scoped.
- Firestore compiled executable rules must remain **strictly below 256,000 bytes**.
- Authenticated emulator negative cases, concurrency and replay checks must pass. A CI workflow passing while posting is disabled does not certify posting.

## C. Exact acceptance transaction (only AFTER engineering gates B pass)
1. Register active zero-opening Branch Cash Sales and Bank accounts for Masaka.
2. Commit one cash POS receipt for UGX 100,000. Verify Branch Cash Sales increases by exactly UGX 100,000, bank remains unchanged.
3. Retry the same receipt ID. Verify no additional credit.
4. Transfer UGX 70,000 cash to bank with **zero external fee**. Verify cash decreases by 70,000 and bank increases by 70,000. Principal is conserved.
5. Retry the transfer request ID. Verify no second movement; change amount with same ID must reject.
6. Reconcile the selected shift with declared amounts matching actual POS collections. Variance must be 0, with no explanation and **no EOD-triggered credit**.
7. Attempt forged account updates, orphan movements, wrong-tenant and insufficient-funds transfers. All must reject with no partial ledger write.
8. Test charged transfers and POS corrections separately once their certified variants are implemented.

## Release decision
No Phase 3 signoff, merge, production activation or Phase 4 financial posting dependency until B and C are independently verified.
