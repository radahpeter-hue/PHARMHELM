# POS V2 Phase 2 Context Validation Report

## 1. Objective
Prevent invalid sale identity/context combinations from reaching either checkout engine, especially the protected POS V2 production transaction path.

## 2. Production state inherited from Phase 1
Phase 1 and PR #26 were already merged to `main`. The POS V2 canonical transaction chain is treated as working production functionality and is intentionally protected by this change.

## 3. Files inspected
- `src/pages/Sales.tsx`
- `src/types.ts`
- POS V2 activation/service references needed only to locate the checkout boundary
- current durable outbox credit receivable compatibility
- existing POS V2 tests and Phase 1 presentation tests

## 4. Existing context architecture discovered
The POS UI exposes three sale contexts: `walk-in`, `telepharmacy`, and `institutional`. `SaleContext` is currently typed as `string`.

## 5. Existing identity architecture
Patient/client identity is represented by `selectedPatient` and persisted using `patientId` and `patientName`. Institution identity is represented by `selectedInstitution` and persisted using `institutionId` and `institutionName`.

## 6. Credit representation
The business concept is now simply **Credit**. Credit may belong to either a named patient/client account or an institution account.

The POS therefore presents one user-facing `Credit` option. For production compatibility, the current V2 checkout continues to persist the established internal payment token `institutional_credit`, because the protected durable outbox receivables consumer currently keys off that token. That existing consumer already resolves either `institutionId`/`institutionName` or `patientId`/`patientName`, so patient-backed and institution-backed credit can both post through the existing durable chain without modifying the protected outbox worker.

The generic `credit` payment value also remains recognized by the validation helper for compatibility with existing/legacy data paths.

## 7. Validation gaps found
Existing `handleCheckout` logic blocked missing telepharmacy patient identity and missing institutional institution identity, but the rules were embedded in `Sales.tsx`, had inconsistent messages, and did not express one coherent rule that every credit transaction must have an accountable patient/client or institution.

## 8. Root cause
Context identity validation and payment/credit identity validation were not represented as one coherent pre-checkout rule set. Because payment method is selected in the checkout flow, validation only at the initial checkout-button boundary is insufficient.

## 9. Implementation
A pure `validateSaleCheckoutContext` helper is applied before the checkout modal is opened and again in `completeSale` before the synchronous submission lock, checkout-attempt creation, engine resolution, or POS V2 invocation.

Rules implemented:
- Anonymous walk-in: allowed for non-credit sales.
- Named walk-in: allowed.
- Telepharmacy: named client/patient required.
- Institutional: institution required.
- Credit: at least one identifiable patient/client or institution account required.
- The legacy internal `institutional_credit` token is subject to the exact same patient-or-institution rule and is no longer presented as institution-only in the POS.

No additional phone, address, demographic, prescriber, or institution requirements were introduced beyond existing rules.

## 10. Files changed
- `src/pages/Sales.tsx`
- `src/utils/saleContextValidation.ts`
- `tests/pos-phase2-context-validation.test.ts`
- `docs/POS_V2_PHASE2_CONTEXT_VALIDATION_REPORT.md`

## 11. Validation matrix
1. Walk-in + no patient + non-credit: PASS as anonymous.
2. Walk-in + named patient: PASS.
3. Telepharmacy + no patient: BLOCK.
4. Telepharmacy + patient: PASS.
5. Institutional + no institution: BLOCK.
6. Institutional + institution: PASS.
7. Credit + no patient/client and no institution: BLOCK.
8. Credit + patient/client: PASS subject to existing downstream credit rules.
9. Credit + institution: PASS subject to existing downstream credit rules.
10. Failed context validation returns before checkout execution and leaves basket state untouched.

## 12. User-facing credit behaviour
The payment selector displays `Credit`, not `Inst. Credit`.

The checkout is eligible when either:
- a patient/client account is attached, or
- an institution account is attached.

It is blocked when neither is attached with:

`An identifiable client or institution is required for a credit sale.`

## 13. Tests added
Focused unit tests cover the validation matrix, exact user-facing messages, patient-backed credit, institution-backed credit, legacy internal token compatibility, validation ordering before the checkout submission lock and V2 invocation, and the pure helper's lack of inventory/transaction/outbox side effects.

## 14. Quality gates
The final credit-scope correction gate completed successfully for:
- dependency installation
- targeted Phase 2 tests
- complete test command execution
- lint
- typecheck
- production build
- `git diff --check`
- protected-core/outbox/rules diff guard

The repository also has a previously identified stale Phase 1 A4 PDF assertion on current `main` after PR #26. Phase 2 does not alter that PDF implementation or test.

## 15. Proof POS V2 core was untouched
The final diff does not change:
- `src/services/pos-v2/posCheckoutV2Repository.ts`
- `src/services/pos-v2/posCheckoutV2Calculator.ts`
- `src/services/pos-v2/posCheckoutV2Service.ts`
- `src/services/posCheckoutTierService.ts`
- `src/services/posTierCartService.ts`
- `firestore.rules`
- `scripts/process-pos-v2-outbox.mjs`
- `scripts/pos-v2-batch4-core.mjs`

## 16. Why the internal token was not renamed
Changing the actual V2 payment/outbox token from `institutional_credit` to `credit` inside Phase 2 would require changing protected downstream consumer applicability and durable receivable posting. That would turn a low-risk UI/application validation correction into a transaction/posting change.

Instead, Phase 2 changes the **business meaning and visible label** to Credit while retaining the established internal compatibility token. A future internal-token cleanup can be performed separately with migration/backward-compatibility tests if desired.

## 17. Risks
Primary intended behavioural change is that no anonymous credit is permitted. A credit sale must identify the accountable patient/client or institution. The compatibility token is deliberately invisible to the dispenser.

## 18. Rollback plan
Revert the Phase 2 commits. No data migration, schema migration, Firestore rule change, stock rewrite, payment rewrite, outbox rewrite, or activation change is involved.

## 19. Recommended live validation
- Walk-in anonymous + cash: checkout remains eligible.
- Telepharmacy without client: block; add client; retry.
- Institutional without institution: block; add institution; retry.
- Credit with neither patient/client nor institution: block.
- Credit with patient/client attached: eligible subject to existing credit rules.
- Credit with institution attached: eligible subject to existing credit rules.
- Confirm basket and quantities remain intact after every invalid-path block.

Invalid-path tests should stop before any production transaction is created.

## 20. Remaining Phase 3/4/5 work
Not included. Dispenser authorization, FEFO multi-batch live validation, receipt revision, and transaction backdating remain explicitly out of scope.
