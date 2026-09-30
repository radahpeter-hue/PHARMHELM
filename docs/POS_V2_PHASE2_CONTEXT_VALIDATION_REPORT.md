# POS V2 Phase 2 Context Validation Report

## 1. Objective
Prevent invalid sale identity/context combinations from reaching either checkout engine, especially the protected POS V2 production transaction path.

## 2. Production state inherited from Phase 1
Phase 1 and PR #26 were already merged to `main`. The POS V2 canonical transaction chain is treated as working production functionality and is intentionally protected by this change.

## 3. Files inspected
- `src/pages/Sales.tsx`
- `src/types.ts`
- POS V2 activation/service references needed only to locate the checkout boundary
- existing POS V2 tests and Phase 1 presentation tests

## 4. Existing context architecture discovered
The POS UI exposes three sale contexts: `walk-in`, `telepharmacy`, and `institutional`. `SaleContext` is currently typed as `string`.

## 5. Existing identity architecture
Patient/client identity is represented by `selectedPatient` and persisted using `patientId` and `patientName`. Institution identity is represented by `selectedInstitution` and persisted using `institutionId` and `institutionName`.

## 6. Institutional credit representation
Institutional credit is not a sale context. It is a `PaymentMethodType` value, `institutional_credit`. The generic `credit` payment method also exists.

## 7. Validation gaps found
Existing `handleCheckout` logic blocked missing telepharmacy patient identity and missing institutional institution identity, but the rules were embedded in `Sales.tsx`, had inconsistent messages, did not guarantee an institution for `institutional_credit`, and did not prevent anonymous generic credit.

## 8. Root cause
Context identity validation and payment/credit identity validation were not represented as one coherent pre-checkout rule set. Because payment method is selected in the checkout flow, validation only at the initial checkout-button boundary is insufficient.

## 9. Implementation
A pure `validateSaleCheckoutContext` helper is applied before the checkout modal is opened and again in `completeSale` before the synchronous submission lock, checkout-attempt creation, engine resolution, or POS V2 invocation.

Rules implemented:
- Anonymous walk-in: allowed.
- Named walk-in: allowed.
- Telepharmacy: named client/patient required.
- Institutional: institution required.
- Institutional credit: institution required.
- Generic credit: at least one identifiable client or institution required.

No additional phone, address, demographic, prescriber, or institution requirements were introduced beyond existing rules.

## 10. Files changed
- `src/pages/Sales.tsx`
- `src/utils/saleContextValidation.ts`
- `tests/pos-phase2-context-validation.test.ts`
- `docs/POS_V2_PHASE2_CONTEXT_VALIDATION_REPORT.md`

## 11. Validation matrix
1. Walk-in + no patient: PASS as anonymous.
2. Walk-in + patient: PASS.
3. Telepharmacy + no patient: BLOCK.
4. Telepharmacy + patient: PASS.
5. Institutional + no institution: BLOCK.
6. Institutional + institution: PASS.
7. Institutional credit + no institution: BLOCK.
8. Institutional credit + institution: PASS subject to existing downstream credit rules.
9. Anonymous generic credit: BLOCK.
10. Failed context validation returns before checkout execution and leaves basket state untouched.

## 12. Tests added
Focused unit tests cover the validation matrix, exact user-facing messages, identified generic credit, validation ordering before the checkout submission lock and V2 invocation, and the pure helper's lack of inventory/transaction/outbox side effects.

## 13. Test results
Dedicated Phase 2 CI results:
- `npm ci`: PASS.
- targeted Phase 2 context validation tests: PASS.
- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- `git diff --check`: PASS.
- protected-core diff guard: PASS.

The complete `npm test` command was also run. It reported 203 tests, with 202 passing and one failing test in `tests/pos-phase1-ui-docs.test.ts`. The failing assertion expects the old `waitForInvoiceAssets(element)` browser-rasterisation PDF path. That assertion is already stale on `main` because Phase 1 PR #26 intentionally replaced the A4 PDF path with deterministic jsPDF generation. The Phase 2 CI separately verified that the assertion exists on `main` while the current `main` A4 invoice implementation no longer contains the expected old path. No Phase 1 code or Phase 1 test was modified in this PR.

## 14. Build result
Production build: PASS.

Strict merge readiness remains blocked only by the pre-existing stale Phase 1 test described above if the requirement is that `npm test` must have zero failures. Phase 2-specific tests and all compile/build/diff safety gates are green.

## 15. Proof POS V2 core was untouched
The final PR diff does not change:
- `src/services/pos-v2/posCheckoutV2Repository.ts`
- `src/services/pos-v2/posCheckoutV2Calculator.ts`
- `src/services/pos-v2/posCheckoutV2Service.ts`
- `src/services/posCheckoutTierService.ts`
- `src/services/posTierCartService.ts`
- `firestore.rules`

The CI protected-core guard passed.

## 16. Risks
Primary intentional behaviour change is blocking a previously tolerated anonymous `credit` payment. Existing identified credit and institutional credit remain eligible for downstream credit checks.

The validator is called in both the initial checkout boundary and `completeSale`. This protects against payment-method changes made inside the checkout modal before final submission.

## 17. Rollback plan
Revert the Phase 2 changes. No data migration, schema migration, Firestore rule change, stock rewrite, payment rewrite, or activation change is involved.

## 18. Recommended live validation
- Walk-in anonymous: checkout remains eligible.
- Telepharmacy without client: block; add client; retry.
- Institutional without institution: block; add institution; retry.
- Institutional credit without institution: block; add institution; retry subject to existing credit eligibility.
- Anonymous generic credit, if reachable through any existing workflow: block until an identifiable client or institution is attached.
- Confirm basket and quantities remain intact after every invalid-path block.

Invalid-path tests should stop before any production transaction is created. No production test sale was executed during Phase 2 implementation.

## 19. Remaining Phase 3/4/5 work
Not included. Dispenser authorization, FEFO multi-batch live validation, receipt revision, and transaction backdating remain explicitly out of scope.
