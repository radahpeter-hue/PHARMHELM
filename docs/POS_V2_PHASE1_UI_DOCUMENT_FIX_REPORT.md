# POS V2 Phase 1 UI and Document Fix Report

## 1. Objective
Correct Receipt Ledger display/search, A4 invoice branch/PDF behaviour, and institutional desktop clipping while protecting the working POS V2 transaction engine.

## 2. Baseline
Current `main` baseline: `944c571e4f547904697e781c135c4fdd1f2e3c36`, merged PR #24 production fix.

Working branch: `fix/pos-v2-phase1-ui-docs`.

## 3. Files inspected
- `src/pages/Sales.tsx`
- `src/components/sales/A4InvoiceTemplate.tsx`
- Receipt Ledger implementation in `Sales.tsx`
- institutional context/catalogue layout in `Sales.tsx`
- `package.json`
- existing tests and deployment workflows

## 4. Root causes
### Receipt Ledger
The Receipt ID cell rendered the internal sale document prefix from `sale.id`. The Patient/Client cell rendered `sale.receiptNumber`. Search covered internal ID and receipt number but not patient or institution names.

### A4 branch
The invoice template used `receipt.branchName || 'Main Store'`, which created a false Main Store label whenever the sale did not persist `branchName`.

### A4 PDF
The export relied on one browser-side `html2canvas` capture at fixed high scale followed by direct `jsPDF.save()`, with no wait for fonts/images and no recovery if remote images or canvas rendering failed.

### Institutional desktop layout
The right-side POS column was height constrained with `overflow-hidden`; the institutional context block could grow while the catalogue retained a desktop minimum height, causing the product area to be clipped.

## 5. Files changed
- `src/pages/Sales.tsx`
- `src/components/sales/A4InvoiceTemplate.tsx`
- `src/utils/salePresentation.ts`
- `tests/pos-phase1-ui-docs.test.ts`
- `package.json` only to expose `npm run typecheck`
- `docs/POS_V2_PHASE1_UI_DOCUMENT_FIX_REPORT.md`

## 6. Before and after
Receipt Ledger now shows `receiptNumber`; if genuinely absent it uses a readable `REF-<suffix>` reference instead of exposing a raw V2 prefix. Patient/Client now resolves institution first, then named patient, then `Anonymous` for unnamed walk-ins, otherwise `Identity not recorded`. Search now matches receipt number, institution and patient.

A4 invoice branch resolution now uses stored sale branch name when present, otherwise resolves the sale's `branchId`, otherwise uses `activeBranch` only when the IDs match, otherwise shows `Branch not available`. The false `Main Store` fallback was removed.

PDF export remains client-side but now waits for assets, constrains canvas scale, uses CORS-safe capture, retries without external images if the first capture fails, creates a compressed PDF blob, and leaves Print A4 available independently.

Institutional desktop layout now bounds the growing context panel and gives the catalogue/product results explicit remaining-height and independent-scroll behaviour at desktop sizes without changing basket or checkout logic.

## 7. Proof POS V2 transaction engine was not changed
Validation explicitly fails if any of these change from the protected baseline:
- `src/services/pos-v2/posCheckoutV2Repository.ts`
- `src/services/pos-v2/posCheckoutV2Calculator.ts`
- `src/services/pos-v2/posCheckoutV2Service.ts`
- `src/services/posCheckoutTierService.ts`
- `src/services/posTierCartService.ts`
- `firestore.rules`

No stock, batch, payment, outbox, activation, tenant configuration, FEFO or production data operation is performed.

## 8. Tests added
`tests/pos-phase1-ui-docs.test.ts` covers receipt number display and fallback, institution/patient/anonymous/missing identity rendering, all three required search fields, A4 branch resolution and absence of the Main Store fallback, resilient PDF export contract, and institutional desktop product-list accessibility.

## 9. Gate results
The final implementation commit is created only after these pass:
- `npm ci`
- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- protected POS V2 core diff guard

## 10. Risks
PDF generation remains browser-side, so browser download policies can still block saving. Print A4 remains available. Resolving an absent stored branch name performs one branch-document read. On short desktop viewports the institutional context panel may scroll independently by design.

## 11. Rollback
Revert the single Phase 1 implementation commit. No data migration, Firestore rules rollback, stock repair, payment repair or configuration rollback is required.

## 12. Recommended live validation
1. Confirm a recent Masaka V2 sale shows its canonical receipt number in Receipt Ledger.
2. Confirm institution, named patient and anonymous walk-in labels.
3. Search by receipt number, institution name and patient name.
4. Open a Masaka A4 invoice and confirm Masaka rather than Main Store.
5. Test PDF download on desktop Chrome and mobile Safari, including a tenant logo.
6. Confirm Print A4 remains usable.
7. At 100% desktop zoom choose Institutional and confirm context fields, product search/results, basket and checkout remain reachable.
