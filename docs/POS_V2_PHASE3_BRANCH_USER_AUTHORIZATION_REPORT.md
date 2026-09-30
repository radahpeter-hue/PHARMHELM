# POS V2 Production Remediation Phase 3
## Branch User Authorization / Dispenser Checkout Access Report

Date: 30 September 2026  
Repository: `radahpeter-hue/PHARMHELM`  
Phase 3 branch: `fix/pos-v2-phase3-branch-user-authorization`  
Production project: `gen-lang-client-0911422817`  
Named Firestore database: `ai-studio-f7d8654b-e089-425a-a506-38159afe1e75`  
Tenant: MARTIN PHARMA  
Test branch: Masaka (`1agW2eYBOGGqKR9w2V31`)

## 1. Executive conclusion

The Masaka Dispenser checkout failure was not caused by a missing Dispenser POS permission, a Role Registry defect, a stale branch assignment, the secondary Cashier role, or a defect in the POS V2 transaction engine.

The failure was reproduced in the Firestore emulator with the same authority shape as the Masaka test Dispenser. The transaction failed because the Firestore rules exceeded the platform limit of 1,000 rule expressions while evaluating the atomic POS V2 transaction.

The safe repair is a rule-evaluation optimization only. The existing, already-authorized narrow POS mutation paths for `products` and `product_batches` were reordered ahead of broader Inventory and QA authorization alternatives. No permission was added, removed or widened.

After this reorder, the identical emulator transaction completed successfully for a Dispenser with Masaka branch authority and secondary Cleaner/Cashier roles.

## 2. Production test identity reviewed

The test account identified by the branch security roster is Kalebu Francis (`@k.francis`). The UI records:

- primary operational role: Dispenser;
- secondary roles: Cleaner and Cashier;
- primary branch: Masaka;
- Masaka authorized;
- MARTIN PHARMA HQ not authorized.

A read-only production authority diagnostic was run against the named Firestore database. The authoritative staff record matched the operational security card: the user was active, the primary role was Dispenser, the secondary roles included Cleaner and Cashier, and the Masaka branch was present in the authoritative branch assignment.

This ruled out stale UID authority, missing staff migration, wrong tenant assignment and wrong branch assignment as the checkout cause.

## 3. Role and RBAC findings

The existing PharmHelm RBAC model already grants Dispenser functional POS access while keeping general Inventory administration restricted.

The correct boundary remains:

- Dispenser: Sales/POS functional operation;
- Dispenser: Inventory view access only;
- Dispenser: no general Inventory operator authority;
- branch scope remains mandatory;
- a primary Cashier remains prohibited from completing sales.

Kalebu's secondary Cashier role does not activate the primary-Cashier exclusion. Firestore checks `getUserData().role` for the Cashier exclusion, while the primary role is Dispenser.

No Role Registry definition was changed in Phase 3. Dispenser was not added to `isInventoryOperator()`.

## 4. Exact root cause

POS V2 commits its canonical sale atomically. Among the transaction writes are:

- `sales`;
- `pos_payments`;
- `pos_transaction_outbox`;
- `pos_checkout_attempts`;
- `product_batches`;
- `products`.

The former `products` update rule evaluated the broad `isInventoryOperator()` alternative before the legitimate narrow POS mutation exception.

The former `product_batches` update rule evaluated `isInventoryOperator()` and QA authorization alternatives before the legitimate narrow POS batch-deduction exception.

For a Dispenser those broad alternatives are intentionally false. Their evaluation nevertheless consumes rule expressions. Across the full atomic POS transaction, the accumulated rule evaluation exceeded Firestore's maximum of 1,000 expressions, producing a permission-denied checkout failure.

This also explains why roles with broader Inventory/admin authority appeared able to sell while the Dispenser failed: those roles can short-circuit earlier through broader authorization paths, whereas Dispenser correctly relies on the narrow POS mutation path.

## 5. Repair implemented

Only the order of existing authorization alternatives was changed.

### Products

The narrow `isPOSOperator()` compatibility-stock mutation path is now evaluated before `isInventoryOperator()`.

Its restrictions remain unchanged, including the exact allowed field sets, non-negative stock validation, `stock == quantityInStock` reconciliation and `stockAggregateSource == 'product_batches'` requirement.

### Product batches

The branch-scoped `isPOSOperator()` quantity-deduction path is now evaluated before the broader Inventory and QA alternatives.

Its restrictions remain unchanged, including:

- assigned branch requirement;
- quantity-only plus timestamp mutation;
- numeric quantity requirement;
- non-negative quantity requirement.

Inventory operators retain their previous broader authority. QA quarantine authority remains unchanged and quarantine-only.

## 6. Security invariants preserved

The repair preserves:

- tenant isolation;
- branch isolation;
- primary Cashier exclusion from sale completion;
- Dispenser Inventory view-only boundary;
- branch-scoped POS stock deduction;
- narrow product aggregate healing fields;
- QA quarantine restrictions;
- FEFO behavior;
- atomic checkout semantics;
- payment/outbox linkage;
- duplicate-sale/idempotency controls;
- auditability.

No POS V2 transaction-engine behavior was changed.

## 7. Emulator reproduction and proof

A dedicated Firestore emulator scenario was created using:

- primary role `Dispenser`;
- secondary roles `cleaner` and `cashier`;
- Masaka branch assignment;
- one product and one branch-scoped batch;
- the six POS V2 atomic write categories.

### Before the repair

The transaction was rejected with Firestore's rule-evaluation error indicating that the maximum of 1,000 expressions had been reached.

### After the repair

The same emulator scenario passed and completed all six write categories under the revised rules.

This demonstrates that the repair addresses the reproduced authorization failure without granting broader authority.

## 8. Regression validation

### Passed

- TypeScript validation passed.
- The dedicated Dispenser boundary tests passed.
- Existing POS authorization tests passed.
- Existing POS V2 Firestore rule tests passed.
- Existing POS V2 calculation, FEFO, payment, outbox, idempotency and activation tests passed.
- The emulator reproduction passed after the rule reorder.

The new boundary tests explicitly verify that:

1. Dispenser remains a functional POS role.
2. Firestore recognizes Dispenser at the POS boundary.
3. Dispenser is not promoted to a general Inventory operator.
4. POS batch deduction remains branch-scoped and narrow.
5. POS product aggregate healing remains narrow.

### Unrelated existing test failure

The broad repository test command completed 215 tests with 214 passing and one failing assertion in `tests/pos-phase1-ui-docs.test.ts` concerning the A4 invoice/PDF source-string expectation.

That test file is byte-identical between `main` and the Phase 3 branch, and the corresponding `A4InvoiceTemplate.tsx` component is also byte-identical between `main` and the Phase 3 branch. The failure is therefore outside the Phase 3 authorization change and was not modified as part of this repair.

## 9. Protected POS V2 engine verification

The protected POS V2 transaction engine remains unchanged from `main`.

Verified unchanged by matching Git blob identities for:

- `src/services/pos-v2/posCheckoutV2Repository.ts`;
- `src/services/pos-v2/posCheckoutV2Calculator.ts`;
- `src/services/pos-v2/posCheckoutV2Service.ts`.

Phase 3 did not modify FEFO allocation, sale construction, payment construction, outbox construction, transaction composition, receipt identity or downstream posting behavior.

## 10. Files introduced or changed by Phase 3

Core repair:

- `firestore.rules`

Regression/diagnostic support:

- `tests/pos-v2-dispenser-boundary.test.ts`
- `scripts/diagnose-pos-v2-dispenser-authority.mjs`
- `scripts/phase3-dispenser-rules-emulator.mjs`
- `scripts/apply-phase3-pos-rules-short-circuit.mjs`
- `.github/workflows/pos-v2-phase3-dispenser-authority-diagnostic.yml`
- `.github/workflows/pos-v2-phase3-dispenser-rules-emulator.yml`
- `.github/workflows/pos-v2-phase3-apply-rules-short-circuit.yml`
- `.github/workflows/pos-v2-phase3-regression-validation.yml`
- `docs/POS_V2_PHASE3_BRANCH_USER_AUTHORIZATION_REPORT.md`

The production staff record was not modified by the diagnostic.

## 11. Production status and next controlled step

At the time of this report:

- the repair exists only on the Phase 3 branch;
- nothing has been merged to `main`;
- the revised Firestore rules have not been deployed to production;
- no live Kalebu checkout has been performed as part of this remediation.

The next controlled step, only after explicit authorization, is:

1. review the final Phase 3 branch diff;
2. merge the narrow rules repair to `main`;
3. deploy the verified rules to the named production Firestore database using the repository's fail-closed deployment path;
4. confirm deployment/rules fingerprint success;
5. perform one controlled Masaka live checkout while signed in as Kalebu Francis;
6. verify the canonical sale, payment, checkout attempt, outbox, exact batch deduction and aggregate product stock update;
7. confirm the Dispenser still has view-only general Inventory access after the successful sale.

Phase 3 should not be considered production-complete until that controlled live validation is green.
