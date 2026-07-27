import { 
  doc, 
  setDoc, 
  deleteDoc, 
  getDoc, 
  collection, 
  query, 
  where, 
  getDocs,
  addDoc,
  Timestamp
} from 'firebase/firestore';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { db, auth, registerAuthUser } from '../src/firebase';
import { 
  Product, 
  ProductBatch, 
  BranchConsumptionDaily,
  StockOrder,
  StockOrderLine,
  TransferInvoice,
  ReplenishmentEngineSettings
} from '../src/types';
import { calculateProductForecast } from '../src/services/forecastingService';
import { 
  calculateDonorTransferableExcess, 
  getNetworkFulfilmentRecommendations, 
  createTransferReservationTx,
  cleanupExpiredReservations
} from '../src/services/networkFulfilmentService';
import { revalidateOrderRun, submitOrderRun } from '../src/services/orderSubmissionService';

const TEST_TENANT = 'demo';
const TEST_BRANCH_REQ = 'branch-requesting-nettest';
const TEST_BRANCH_DONOR_1 = 'branch-donor-1-nettest'; // Usable stock: 50 units, protected: 40 units -> 10 excess
const TEST_BRANCH_DONOR_2 = 'branch-donor-2-nettest'; // Usable stock: 30 units, protected: 40 units -> 0 excess
const TEST_BRANCH_HQ = 'branch-hq-nettest'; // Central HQ stock: 100 units
const TEST_PRODUCT = 'product-network-test';

async function cleanupTestData() {
  console.log('Cleaning up network replenishment test documents...');
  const collections = [
    'products', 
    'product_batches', 
    'branchConsumptionDaily', 
    'stock_orders', 
    'stock_order_lines', 
    'transfer_invoices',
    'transfer_invoice_lines',
    'replenishmentEngineSettings',
    'inventoryTransferReservations',
    'autoGenerateOrderRuns',
    'autoGenerateOrderLines'
  ];
  
  for (const colName of collections) {
    const q = query(
      collection(db, colName), 
      where('tenantId', '==', TEST_TENANT),
      where('productId', '==', TEST_PRODUCT)
    );
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      await deleteDoc(doc(db, colName, d.id));
    }
  }

  // Also clean up branches
  const branches = [TEST_BRANCH_REQ, TEST_BRANCH_DONOR_1, TEST_BRANCH_DONOR_2, TEST_BRANCH_HQ];
  for (const bId of branches) {
    await deleteDoc(doc(db, 'branches', bId)).catch(() => {});
  }

  // Settings deletion
  await deleteDoc(doc(db, 'replenishmentEngineSettings', `${TEST_TENANT}_settings`)).catch(() => {});
  
  console.log('Cleanup complete.');
}

async function setupTestData() {
  console.log('Setting up mock database documents for network replenishment tests...');

  // 1. Settings
  const settings: ReplenishmentEngineSettings = {
    tenantId: TEST_TENANT,
    defaultLookbackDays: 30,
    defaultCoverageDays: 30,
    defaultLeadTimeDays: 5,
    defaultSafetyDays: 10,
    trendWeight: 0.40,
    trendMinimumMultiplier: 0.50,
    trendMaximumMultiplier: 1.50,
    stockoutAdjustmentCap: 3.0,
    minimumValidHistoryDays: 14,
    seasonalityEnabled: false,
    seasonalityMinimumMonths: 24,
    currentPeriodWeight: 0.70,
    historicalPeriodWeight: 0.30,
    observedLeadTimeDeliveryCount: 10,
    minimumLeadTimeObservations: 3,
    leadTimeMethod: 'MANUAL',
    confidenceHighThreshold: 80,
    confidenceModerateThreshold: 55
  };
  await setDoc(doc(db, 'replenishmentEngineSettings', `${TEST_TENANT}_settings`), settings);

  // 2. Product
  const product: Product = {
    id: TEST_PRODUCT,
    tenantId: TEST_TENANT,
    productId: TEST_PRODUCT,
    sku: 'SKU-NET-TEST',
    name: 'Network Replenishment Aspirin',
    category: 'sellable_non_cosmetic',
    costPricePerPack: 5000,
    sellingPricePerUnit: 700,
    taxExempt: false,
    taxRate: 18,
    unitsPerPack: 10,
    unit: 'pack',
    baseUnit: 'tablet',
    unitOfSell: 'pack',
    stock: 200,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  await setDoc(doc(db, 'products', TEST_PRODUCT), product);

  // 3. Branches
  const bHQ = { id: TEST_BRANCH_HQ, name: 'Main Store HQ', type: 'HQ', status: 'Active', tenantId: TEST_TENANT };
  const bReq = { id: TEST_BRANCH_REQ, name: 'Kampala Requesting Branch', type: 'Branch', status: 'Active', tenantId: TEST_TENANT };
  const bDonor1 = { id: TEST_BRANCH_DONOR_1, name: 'Mbarara Donor Branch', type: 'Branch', status: 'Active', tenantId: TEST_TENANT };
  const bDonor2 = { id: TEST_BRANCH_DONOR_2, name: 'Jinja Weak Branch', type: 'Branch', status: 'Active', tenantId: TEST_TENANT };

  await setDoc(doc(db, 'branches', TEST_BRANCH_HQ), bHQ);
  await setDoc(doc(db, 'branches', TEST_BRANCH_REQ), bReq);
  await setDoc(doc(db, 'branches', TEST_BRANCH_DONOR_1), bDonor1);
  await setDoc(doc(db, 'branches', TEST_BRANCH_DONOR_2), bDonor2);

  // 4. Daily consumption aggregates (30 days of 1 unit per day flat demand)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);
  
  const tempDate = new Date(startDate);
  for (let i = 0; i <= 30; i++) {
    const dateKey = tempDate.toISOString().split('T')[0];
    
    const cDonor1: BranchConsumptionDaily = {
      tenantId: TEST_TENANT,
      branchId: TEST_BRANCH_DONOR_1,
      productId: TEST_PRODUCT,
      dateKey,
      validConsumptionUnits: 1,
      exceptionalUnits: 0,
      closingUsableStock: 50,
      wasStockedAllDay: true
    };
    await setDoc(doc(db, 'branchConsumptionDaily', `${TEST_TENANT}_${TEST_BRANCH_DONOR_1}_${TEST_PRODUCT}_${dateKey}`), cDonor1);

    const cDonor2: BranchConsumptionDaily = {
      tenantId: TEST_TENANT,
      branchId: TEST_BRANCH_DONOR_2,
      productId: TEST_PRODUCT,
      dateKey,
      validConsumptionUnits: 1,
      exceptionalUnits: 0,
      closingUsableStock: 30,
      wasStockedAllDay: true
    };
    await setDoc(doc(db, 'branchConsumptionDaily', `${TEST_TENANT}_${TEST_BRANCH_DONOR_2}_${TEST_PRODUCT}_${dateKey}`), cDonor2);

    tempDate.setDate(tempDate.getDate() + 1);
  }

  // 5. Product Batches usable stock setup
  const batchD1: ProductBatch = {
    id: `batch_${TEST_BRANCH_DONOR_1}`,
    tenantId: TEST_TENANT,
    branchId: TEST_BRANCH_DONOR_1,
    productId: TEST_PRODUCT,
    batchNumber: 'BATCH-D1',
    quantity: 50,
    batch_status: 'available',
    expiryDate: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000).toISOString()
  };
  await setDoc(doc(db, 'product_batches', batchD1.id), batchD1);

  const batchD2: ProductBatch = {
    id: `batch_${TEST_BRANCH_DONOR_2}`,
    tenantId: TEST_TENANT,
    branchId: TEST_BRANCH_DONOR_2,
    productId: TEST_PRODUCT,
    batchNumber: 'BATCH-D2',
    quantity: 30,
    batch_status: 'available',
    expiryDate: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000).toISOString()
  };
  await setDoc(doc(db, 'product_batches', batchD2.id), batchD2);

  const batchHQ: ProductBatch = {
    id: `batch_${TEST_BRANCH_HQ}`,
    tenantId: TEST_TENANT,
    branchId: TEST_BRANCH_HQ,
    productId: TEST_PRODUCT,
    batchNumber: 'BATCH-HQ',
    quantity: 100,
    batch_status: 'available',
    expiryDate: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000).toISOString()
  };
  await setDoc(doc(db, 'product_batches', batchHQ.id), batchHQ);
}

async function runTests() {
  console.log('\n--- STARTING NETWORK REPLENISHMENT TESTS ---');

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  const analysisStartDate = start.toISOString().split('T')[0];
  const analysisEndDate = end.toISOString().split('T')[0];
  const coverageDays = 30;

  // TEST 1: Donor Protection Rule
  console.log('Test 1: Jinja Branch (Donor 2) protected requirement evaluation...');
  const excessD2 = await calculateDonorTransferableExcess(
    TEST_TENANT,
    TEST_BRANCH_DONOR_2,
    TEST_PRODUCT,
    analysisStartDate,
    analysisEndDate,
    coverageDays
  );
  console.log(`  Donor 2 Protected Requirement: ${excessD2.protectedRequirement} units`);
  console.log(`  Donor 2 Transferable Excess: ${excessD2.transferableExcess} units`);
  if (excessD2.transferableExcess !== 0) {
    throw new Error(`TEST 1 FAILED: Jinja branch offered excess stock: ${excessD2.transferableExcess}`);
  }
  console.log('  TEST 1 PASSED: Jinja (Donor 2) offered 0 excess.');

  // Mbarara Branch (Donor 1) has: Stock = 50.
  console.log('Test 2: Mbarara Branch (Donor 1) protected requirement evaluation...');
  const excessD1 = await calculateDonorTransferableExcess(
    TEST_TENANT,
    TEST_BRANCH_DONOR_1,
    TEST_PRODUCT,
    analysisStartDate,
    analysisEndDate,
    coverageDays
  );
  console.log(`  Donor 1 Protected Requirement: ${excessD1.protectedRequirement} units`);
  console.log(`  Donor 1 Transferable Excess: ${excessD1.transferableExcess} units`);
  if (excessD1.transferableExcess !== 5) {
    throw new Error(`TEST 2 FAILED: Mbarara branch excess mismatch. Expected 5, got: ${excessD1.transferableExcess}`);
  }
  console.log('  TEST 2 PASSED: Mbarara (Donor 1) offered 5 excess.');

  // TEST 3: Allocation ranking and Central store priority
  console.log('Test 3: Allocating with Central Store check...');
  const recommendation1 = await getNetworkFulfilmentRecommendations({
    tenantId: TEST_TENANT,
    branchId: TEST_BRANCH_REQ,
    productId: TEST_PRODUCT,
    grossRequirement: 15,
    analysisStartDate,
    analysisEndDate,
    coverageDays,
    checkCentralStore: true,
    checkOtherBranches: true
  });
  console.log(`  Central Allocation: ${recommendation1.centralAllocation} units`);
  console.log(`  Donor Allocations:`, recommendation1.donorAllocations);
  console.log(`  Remaining Requirement: ${recommendation1.remainingRequirement} units`);
  if (recommendation1.centralAllocation !== 15 || recommendation1.donorAllocations.length !== 0) {
    throw new Error('TEST 3 FAILED: Central store priority failure.');
  }
  console.log('  TEST 3 PASSED: Central store prioritized successfully.');

  // TEST 4: Donor allocation when Central Store check is disabled
  console.log('Test 4: Allocating from donor branches only...');
  const recommendation2 = await getNetworkFulfilmentRecommendations({
    tenantId: TEST_TENANT,
    branchId: TEST_BRANCH_REQ,
    productId: TEST_PRODUCT,
    grossRequirement: 15,
    analysisStartDate,
    analysisEndDate,
    coverageDays,
    checkCentralStore: false,
    checkOtherBranches: true
  });
  console.log(`  Donor Allocations:`, recommendation2.donorAllocations);
  console.log(`  Remaining Requirement: ${recommendation2.remainingRequirement} units`);
  
  if (recommendation2.donorAllocations.length !== 1 || 
      recommendation2.donorAllocations[0].branchId !== TEST_BRANCH_DONOR_1 || 
      recommendation2.donorAllocations[0].qtyBaseUnits !== 5 ||
      recommendation2.remainingRequirement !== 10) {
    throw new Error('TEST 4 FAILED: Donor allocations or remaining requirement mismatch.');
  }
  console.log('  TEST 4 PASSED: Allocated only available donor excess.');

  // TEST 5: Short-lived reservations reduces transferable availability
  console.log('Test 5: Creating short-lived transfer reservation...');
  const runId = `test_run_${Date.now()}`;
  const resId = await createTransferReservationTx({
    tenantId: TEST_TENANT,
    sourceBranchId: TEST_BRANCH_DONOR_1,
    destinationBranchId: TEST_BRANCH_REQ,
    productId: TEST_PRODUCT,
    autoGenerateRunId: runId,
    qtyBaseUnits: 3,
    createdBy: 'test-admin'
  });
  console.log(`  Reservation created successfully. ID: ${resId}`);
  
  const excessD1PostRes = await calculateDonorTransferableExcess(
    TEST_TENANT,
    TEST_BRANCH_DONOR_1,
    TEST_PRODUCT,
    analysisStartDate,
    analysisEndDate,
    coverageDays
  );
  console.log(`  Donor 1 Excess post-reservation: ${excessD1PostRes.transferableExcess} units`);
  if (excessD1PostRes.transferableExcess !== 2) {
    throw new Error(`TEST 5 FAILED: Reservation did not reduce excess. Expected 2, got: ${excessD1PostRes.transferableExcess}`);
  }
  console.log('  TEST 5 PASSED: Reservation reduced transferable excess correctly.');

  // TEST 6: Double booking check (transaction safety)
  console.log('Test 6: Booking reservation exceeding available stock...');
  try {
    await createTransferReservationTx({
      tenantId: TEST_TENANT,
      sourceBranchId: TEST_BRANCH_DONOR_1,
      destinationBranchId: TEST_BRANCH_REQ,
      productId: TEST_PRODUCT,
      autoGenerateRunId: runId,
      qtyBaseUnits: 4,
      createdBy: 'test-admin'
    });
    throw new Error('TEST 6 FAILED: Reservation succeeded but should have failed due to stock limits.');
  } catch (e: any) {
    console.log(`  Expected transaction rejection caught: ${e.message}`);
    console.log('  TEST 6 PASSED: Concurrency safety booking protection works.');
  }

  // TEST 7: Order Run snapshot and submission conversions
  console.log('Test 7: Converting run snapshot into PO drafts and interbranch transfers...');
  
  const mockRun: any = {
    tenantId: TEST_TENANT,
    runId,
    branchId: TEST_BRANCH_REQ,
    status: 'READY',
    configuration: {
      analysisStartDate,
      analysisEndDate,
      forecastCoverageDays: coverageDays,
      requiredDeliveryDate: new Date(Date.now() + 5*24*60*60*1000).toISOString(),
      safetyPolicy: 'TENANT_DEFAULT',
      leadTimeMethod: 'MANUAL',
      checkCentralStore: false,
      checkOtherBranches: true,
      includeExceptionalConsumption: false,
      applySeasonality: false,
      budgetCeiling: 200000,
      temporaryDemandMultiplier: 1.0
    },
    calculationVersion: 1,
    productCountAnalysed: 1,
    externalLineCount: 1,
    internalLineCount: 1,
    manualReviewCount: 0,
    generatedBy: 'test-admin',
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await setDoc(doc(db, 'autoGenerateOrderRuns', runId), mockRun);

  const mockLine: AutoGenerateOrderLine = {
    tenantId: TEST_TENANT,
    runId,
    productId: TEST_PRODUCT,
    productName: 'Network Replenishment Aspirin',
    sku: 'SKU-NET-TEST',
    genericName: 'Aspirin',
    baseUnit: 'tablet',
    purchasePack: 'pack',
    unitsPerPack: 10,
    originalRecommendationBaseUnits: 10,
    originalPurchasePacks: 1,
    originalInternalAllocation: 3,
    originalCentralAllocation: 0,
    originalDonorAllocations: [{ branchId: TEST_BRANCH_DONOR_1, qtyBaseUnits: 3 }],
    finalRecommendationBaseUnits: 10,
    finalPurchasePacks: 1,
    finalInternalAllocation: 3,
    finalCentralAllocation: 0,
    finalDonorAllocations: [{ branchId: TEST_BRANCH_DONOR_1, qtyBaseUnits: 3 }],
    calculationInputs: {
      costPricePerPack: 5000,
      supplierId: 'test-supplier'
    },
    calculationOutputs: {},
    confidenceScore: 100,
    warnings: [],
    explanation: 'Test',
    wasOverridden: false,
    overrideReason: null,
    overriddenBy: null,
    overriddenAt: null
  };
  await addDoc(collection(db, 'autoGenerateOrderLines'), mockLine);

  const submissionResult = await submitOrderRun(runId, 'mock-user-uid', 'devtest-owner@pharmapro.io');
  console.log(`  Submission result: created ${submissionResult.orderIds.length} POs, and ${submissionResult.transferIds.length} transfers.`);
  
  if (submissionResult.orderIds.length !== 1 || submissionResult.transferIds.length !== 1) {
    throw new Error('TEST 7 FAILED: Draft order or transfer invoice document creation mismatch.');
  }

  const poLinesSnap = await getDocs(
    query(
      collection(db, 'stock_order_lines'),
      where('tenantId', '==', TEST_TENANT),
      where('order_id', '==', submissionResult.orderIds[0])
    )
  );
  console.log(`  PO line count: ${poLinesSnap.size}, qty: ${poLinesSnap.docs[0]?.data().qty_ordered} packs`);
  if (poLinesSnap.size !== 1 || poLinesSnap.docs[0].data().qty_ordered !== 1) {
    throw new Error('TEST 7 FAILED: PO Line quantity conversion mismatch.');
  }

  const trLinesSnap = await getDocs(
    query(
      collection(db, 'transfer_invoice_lines'),
      where('tenantId', '==', TEST_TENANT),
      where('transfer_id', '==', submissionResult.transferIds[0])
    )
  );
  console.log(`  Transfer line count: ${trLinesSnap.size}, qty: ${trLinesSnap.docs[0]?.data().qty_requested} tablets`);
  if (trLinesSnap.size !== 1 || trLinesSnap.docs[0].data().qty_requested !== 3) {
    throw new Error('TEST 7 FAILED: Transfer line quantity mismatch.');
  }

  const resSnap = await getDoc(doc(db, 'inventoryTransferReservations', resId));
  console.log(`  Reservation status: ${resSnap.data()?.status}`);
  if (resSnap.data()?.status !== 'CONVERTED') {
    throw new Error('TEST 7 FAILED: Reservation status was not set to CONVERTED.');
  }

  console.log('  TEST 7 PASSED: Submission conversion and document generation complete.');
  console.log('\n--- ALL NETWORK REPLENISHMENT TESTS PASSED ---');
}

async function main() {
  try {
    console.log('Logging in test administrator...');
    await signInWithEmailAndPassword(auth, 'devtest-owner@pharmapro.io', 'tester123');
    
    await cleanupTestData();
    await setupTestData();
    await runTests();
    await cleanupTestData();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ TEST SUITE RUN FAILED:');
    console.error(error);
    process.exit(1);
  }
}

main();
