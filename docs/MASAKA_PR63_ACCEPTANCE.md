# Masaka acceptance gate — PR #63

## Deployment boundary
- The preview workflow deploys **Hosting only** to channel `masaka-pr63`; it does not deploy Firestore rules or modify the live Hosting channel.
- Preview Hosting is **not an isolated Firestore environment**. It connects to the same configured named Firestore database as the live app.
- Do **not** merge PR #63 to `main` before the controlled acceptance and release decision: `firebase-deploy.yml` automatically deploys rules and live Hosting for every push to `main`.
- The new transfer-line `existsAfter/getAfter` authorization is not live until the named-database rules are explicitly deployed. Until then, any related preview submission failure must **not** be interpreted as an implementation failure.

## Preflight (read only)
1. Confirm PR #63 head SHA equals tested SHA and GitHub CI is green for that SHA.
2. Inspect preview job result and actual Hosting preview URL from GitHub Actions; do not guess URL.
3. Sign into Martin Pharma, confirm tenant and Masaka branch identity in the UI. Never use another tenant for acceptance.
4. Verify authorized Branch Manager, procurement and stock-operator test roles; retain role restrictions for unauthorized staff.
5. Check supplier register has a legitimate supplier for the chosen inventory class and that operational inventory feature toggle is enabled if testing operational stock.
6. Verify existing auto-order run status before using it; do not retry a legacy partially submitted run without reconciliation.

## Preview acceptance (UI only until rules are released)
- Open auto-generated order; verify 20/50/100 paging, search and sort.
- Change a quantity; confirm browser override prompt does not appear.
- Navigate pages; verify edited quantity persists and the full-run total is unchanged by filtering.
- Check manual order review search/page changes with full-order totals.
- Check mobile widths: scroll, edit controls, confirmation dialog and buttons must remain reachable.

## End-to-end approval gate (requires compatible backend rules)
1. Start a **new** Masaka replenishment run with small known quantities and a valid supplier.
2. Confirm computed recommendation, edit the suggested packs, and trigger revalidation.
3. Confirm the modal summarizes all lines across pages and the revised total.
4. Submit using an authorized account; verify one autoGenerateOrderRuns `SUBMITTED` record, matching purchase orders/lines and optional transfer invoices/lines, reservations and exactly one audit entry.
5. Repeat the submit action; verify no duplicate documents or changes in resulting order IDs.
6. Attempt submission with an unauthorized account; confirm no order/transfer/audit or status changes.
7. Test insufficient/changed stock, expired/converted reservation, and missing supplier. Each must produce a clear error with no partial writes.
8. Confirm downstream Procurement visibility, class separation (SELLABLE vs OPERATIONAL), branch and HQ boundaries.
9. Check other tenant roles/access are unaffected and the POS V2 checkout remains functional.

## Release decision
Record executor, date, tenant/branch, preview URL, git SHA, each result, and any blocker. **Never claim live acceptance from emulator-only results.**
Only after staged acceptance and explicit consideration of globally shared Firestore rules and live Hosting, approve the main merge and associated automatic deployment.
