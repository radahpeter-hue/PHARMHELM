# PharmHelm Pro POS V2 Final Eligibility Repair Report

**Date:** 2026-09-29  
**Repository:** `radahpeter-hue/PHARMHELM`  
**Base Commit (main):** `78f2062b97107ca2b89a6ba12454fb980f7fd827`  
**Repair Branch:** `fix/pos-v2-final-eligibility-clean`  
**Tenant:** MARTIN PHARMA (`zehqTDcKyrDAOHKK3stJ`)  
**Active Test Branch:** Masaka (`1agW2eYBOGGqKR9w2V31`)  
**Legacy Fallback Branch:** HQ (`wKIdOvhMmsBqVf1S4s46` / default)  
**Production URL:** https://mp.pharmhelm.com  
**Production Database:** `ai-studio-f7d8654b-e089-425a-a506-38159afe1e75` (Project: `gen-lang-client-0911422817`)  

---

## 1. Executive Summary
During live operational sales testing of POS Checkout Engine V2 at the Masaka branch, cashiers encountered final checkout failures with the error:
> `"Failed to process sale: Inventory aggregate mismatch for [Product Name]. Reconcile product stock before retrying."`

This blocked sales of ordinary catalog items (such as Vitamin C Generics and Cetirizine 10mg) after products had been successfully added to the cart, commercial tier terms resolved, and payment tendered.

This clean, production-safe repair originated strictly from current production `main` (`78f2062`), completely avoiding the unmerged branch `fix/pos-v2-eligibility-final` (which contained a dangerous 1,220-line Firestore rules compiler regression). The repair establishes `product_batches` as the sole physical inventory authority, eliminates blocking derived mirror assertions during transaction commit, enables self-healing of catalog compatibility fields (`products.stock` and `products.quantityInStock`), standardizes client and transaction batch eligibility rules, connects compliance quarantine/recall actions directly to batch documents, and corrects thermal receipt print window sequencing.

---

## 2. Root Cause Analysis

### 2.1 Asymmetric Data Scopes and Eligibility Rules
* **Basket Addition Phase (`Sales.tsx`):** Loaded batches strictly scoped to the active branch (`activeBranchId == '1agW2eYBOGGqKR9w2V31'`), filtering for `batch_status == 'active'` and unexpired dates.
* **Transaction Precondition (`posCheckoutV2Repository.ts`):** `assertAggregateMatches(product, batchTotal)` queried all tenant batches across **both HQ and Masaka**, summing all batches regardless of status (including inactive, quarantined, or expired batches).

### 2.2 Denormalized Drift on Catalog Compatibility Mirrors
* The fields `products.stock` and `products.quantityInStock` are denormalized tenant-wide compatibility mirrors for legacy queries.
* Past legacy sales updated `products.stock` without updating `products.quantityInStock`.
* Manual inventory adjustments and initial stock entries updated `product_batches` without updating `products`.
* Consequently, `stock`, `quantityInStock`, and `batchTotal` drifted apart across virtually every catalog item.
* Because `assertAggregateMatches` required `Math.abs(stock - batchTotal) <= 0.0001` AND `Math.abs(quantityInStock - batchTotal) <= 0.0001`, any historical discrepancy permanently halted batch-backed physical sales.

### 2.3 Compliance Quarantine Disconnect
* QA compliance actions in `ExpiryLogs.tsx` and `Recalls.tsx` wrote records to peripheral log collections (`quarantine_logs`, `expiry_logs`, `recalls`) but never modified `product_batches.batch_status = 'quarantined'`.
* As a result, quarantined batches remained sellable at POS counters.

### 2.4 Premature Receipt Window Creation
* `Sales.tsx` line 2399 passed `openReceiptPrintWindow()` directly inside `onClick={() => completeSale(openReceiptPrintWindow())}`.
* This caused a blank "Preparing receipt..." browser popup to appear *before* checkout validation or transaction execution. If checkout failed, the stranded blank window confused cashiers.

### 2.5 Prior Branch Regression Avoided
* Work-in-progress branch `fix/pos-v2-eligibility-final` contained commit `78dd9e9`, which accidentally reverted PR #22's compiler-optimized Firestore rules, replacing 1,220+ lines of compact security helpers with bloated expressions that fail the Google Cloud Firestore rules compiler.
* That branch was rejected as a deployment source and **NEVER MERGED**. All work was initiated cleanly from production `main`.

---

## 3. Files Inspected & Analyzed
1. `src/services/pos-v2/posCheckoutV2Repository.ts` — Transaction commit, aggregate assertions, product updates.
2. `src/services/pos-v2/posCheckoutV2Service.ts` — Checkout orchestration, permission checks.
3. `src/services/pos-v2/posCheckoutV2Calculator.ts` — FEFO allocation, pricing calculations.
4. `src/services/posTierCartService.ts` — Basket eligibility, FEFO candidate sorting, commercial quantity capping.
5. `src/services/posCheckoutTierService.ts` — Line allocations, cost floor validations.
6. `src/services/consumptionService.ts` — Legacy movement logging, stock helpers.
7. `src/pages/Sales.tsx` — POS UI, product search, cart operations, receipt trigger.
8. `src/modules/qa/ExpiryLogs.tsx` — Expiry quarantine workflows.
9. `src/modules/qa/Recalls.tsx` — Recall quarantine workflows.
10. `firestore.rules` — Production Firestore security rules.
11. `tests/*` — All unit and integration test suites.

---

## 4. Implementation Details & Files Modified

### 4.1 `src/services/posTierCartService.ts`
* **`isProductBatchEligibleForPos(batch, options)`:** Canonical validator enforcing:
  - Tenant ID match
  - Active branch ID match
  - `batch_status === 'active'`
  - Non-negative, finite commercial quantity > 0
  - Non-negative, finite purchase price (cost floor)
  - Strict unexpired date check via normalized timestamp parser (`normaliseExpiry`).
* **`getProductEligibleBatches(batches, productId, options)`:** Canonical FEFO sorter returning only valid batches ordered by earliest expiry date.
* **`capRequestedCommercialQuantity(params)`:** Enforces commercial unit limits based on available eligible base stock, accounting for other basket line reservations.
* **`getProductUsableBaseStock(batches, productId, now)`:** Re-wired to use canonical `getProductEligibleBatches()`.

### 4.2 `src/services/pos-v2/posCheckoutV2Repository.ts`
* **Removed Brittle Precondition:** Completely eliminated `assertAggregateMatches()`.
* **Authoritative Batch Totals:** Sums all valid tenant batch quantities in the transaction to compute `authoritativeBatchTotals`.
* **Self-Healing Compatibility Mirrors:** During deduction, sets:
  ```typescript
  const nextStock = authoritativeCurrentStock - deduction;
  if (nextStock < -EPSILON) throw new PosCheckoutV2Error('TRANSACTION_CONFLICT', `Batch inventory for ${product.name} cannot satisfy the base-unit deduction.`);
  transaction.update(doc(db, 'products', productId), {
    stock: Math.max(0, nextStock),
    quantityInStock: Math.max(0, nextStock),
    stockAggregateSource: 'product_batches',
    stockHealedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  ```
* Ensures derived catalog mirrors heal automatically during genuine batch-backed sales without administrative downtime.

### 4.3 `src/services/batchComplianceService.ts` [NEW]
* Provides `quarantineInventoryBatch(tenantId, branchId, batchId, reason, actor)` and `quarantineRecallBatches(tenantId, branchId, batchIds, recallId, actor)`:
* Updates `product_batches.batch_status = 'quarantined'` and sets `lastUpdated = serverTimestamp()`.
* Logs audit entries to `quarantine_logs` and `audit_logs`.

### 4.4 `src/modules/qa/ExpiryLogs.tsx` & `src/modules/qa/Recalls.tsx`
* Wired "Quarantine Batch" and "Recall Quarantine" buttons to invoke `batchComplianceService`, ensuring compliance actions immediately mark the physical batch as quarantined.

### 4.5 `src/pages/Sales.tsx`
* **Product Search (`filteredItems`):** Keeps zero-eligible-stock products visible in search results so clicking them triggers actionable cashier feedback rather than silently hiding catalog items.
* **Add to Cart (`addToCart`):**
  - If usable base stock is 0: Displays toast `"Insufficient eligible stock for [Product Name]. No sellable batch is available."`
  - In multi-tier: Enforces `capRequestedCommercialQuantity`.
  - In single-tier: Automatically selects earliest expiring eligible batch from `getProductEligibleBatches()`.
* **Batch Switching (`changeBatch`):** Validates new batch with `isProductBatchEligibleForPos(newBatch)`.
* **Quantity Updates (`updateQuantity`):** Applies `capRequestedCommercialQuantity` with informative toast warnings when quantity is capped at available stock.
* **Receipt Window Sequencing:** Changed checkout button handler from `onClick={() => completeSale(openReceiptPrintWindow())}` to `onClick={() => completeSale()}`. The thermal receipt window opens only *after* the sale transaction is committed.

### 4.6 `firestore.rules`
* Surgically modified only 13 lines:
  - Allowed `products` update rule to heal `stock` and `quantityInStock` without requiring pre-existing equality on the drifted document.
  - Added narrow rule under `match /product_batches/{batchId}` allowing QA users (`isQA()`) within their branch (`isAssignedToBranch`) or QA leadership to update `batch_status = 'quarantined'` and `lastUpdated`.
  - **All PR #22 role helpers and compiler optimizations preserved 100% intact.**

---

## 5. Verification Gates & Test Results

### 5.1 New & Updated Test Suites
| Test Suite | Tests Run | Passed | Failed | Status |
| :--- | :---: | :---: | :---: | :---: |
| `tests/pos-final-eligibility-regression.test.ts` | 5 | 5 | 0 | **PASSED** |
| `tests/pos-checkout-v2-firestore-rules.test.ts` | 13 | 13 | 0 | **PASSED** |
| `tests/pos-checkout-v2-atomic-core.test.ts` | 14 | 14 | 0 | **PASSED** |
| `tests/pos-tier-cart.test.ts` | 4 | 4 | 0 | **PASSED** |
| **All POS & Sales Domain Suites** | **177** | **177** | **0** | **PASSED** |

### 5.2 TypeScript & Lint Verification
* **Command:** `npm run lint` (`tsc --noEmit`)
* **Result:** Exit Code `0` — Zero type or lint errors across all 3,400+ project modules.

### 5.3 Production Vite Build Verification
* **Command:** `npm run build` (`vite build`)
* **Result:** Exit Code `0` — 3,439 modules transformed; production bundle built cleanly into `dist/`.

---

## 6. Safety & Rollback Plan

### 6.1 Branch Confinement
* HQ remains on its current legacy fallback checkout engine (`loadPosCheckoutV2Mode` resolves `'legacy'`).
* Masaka is the only branch with POS V2 enabled.

### 6.2 Zero Production Data Alteration
* No production batch records were fabricated, modified, or deleted during this repair.
* No product expiry dates were altered.

### 6.3 Rollback Mechanism
If any anomaly is observed post-deployment:
1. **Instant POS V2 Deactivation:** Set `system_settings.pos_checkout_v2_enabled = false` or update branch configuration to force legacy fallback mode.
2. **Git Rollback:** Revert commit from `fix/pos-v2-final-eligibility-clean` back to `78f2062`.
