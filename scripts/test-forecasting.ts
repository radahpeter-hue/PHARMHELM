import { 
  doc, 
  setDoc, 
  deleteDoc, 
  getDoc, 
  collection, 
  query, 
  where, 
  getDocs,
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
  GRNRecord,
  ReplenishmentEngineSettings
} from '../src/types';
import { calculateProductForecast, getReplenishmentSettings } from '../src/services/forecastingService';

const TEST_TENANT = 'demo';
const TEST_BRANCH = 'test-forecast-branch';
const TEST_PRODUCT = 'test-forecast-prod';
const TEST_SUPPLIER = 'test-supplier-123';

async function cleanupTestData() {
  console.log('Cleaning up forecasting test documents...');
  const collections = [
    'products', 
    'product_batches', 
    'branchConsumptionDaily', 
    'stock_orders', 
    'stock_order_lines', 
    'transfer_invoices',
    'grn_records',
    'replenishmentEngineSettings'
  ];
  
  for (const colName of collections) {
    const q = query(
      collection(db, colName), 
      where('tenantId', '==', TEST_TENANT)
    );
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      await deleteDoc(doc(db, colName, d.id));
    }
  }
  console.log('Cleanup complete.');
}

async function setupTestData() {
  console.log('Setting up mock database documents for forecasting tests...');

  // 1. Replenishment settings
  const settings: ReplenishmentEngineSettings = {
    tenantId: TEST_TENANT,
    defaultLookbackDays: 30,
    defaultCoverageDays: 30,
    defaultLeadTimeDays: 5,
    defaultSafetyDays: 10,
    trendWeight: 0.50,
    trendMinimumMultiplier: 0.60,
    trendMaximumMultiplier: 1.40,
    stockoutAdjustmentCap: 3.0,
    minimumValidHistoryDays: 14,
    seasonalityEnabled: false,
    seasonalityMinimumMonths: 24,
    currentPeriodWeight: 0.70,
    historicalPeriodWeight: 0.30,
    observedLeadTimeDeliveryCount: 5,
    minimumLeadTimeObservations: 2,
    leadTimeMethod: 'HIGHER_OF_MANUAL_AND_OBSERVED',
    confidenceHighThreshold: 80,
    confidenceModerateThreshold: 55
  };
  await setDoc(doc(db, 'replenishmentEngineSettings', `${TEST_TENANT}_settings`), settings);

  // 2. Product (multiplier = 10)
  const product: Product = {
    id: TEST_PRODUCT,
    tenantId: TEST_TENANT,
    productId: TEST_PRODUCT,
    sku: 'SKU-FORECAST',
    name: 'Forecasting Aspirin',
    category: 'sellable_non_cosmetic',
    costPricePerPack: 4000,
    sellingPricePerUnit: 600,
    taxExempt: false,
    taxRate: 18,
    unitsPerPack: 10,
    unit: 'pack',
    baseUnit: 'tablet',
    unitOfSell: 'pack',
    stock: 200
  };
  // Store custom fields dynamically
  (product as any).leadTimeDays = 6;
  (product as any).supplierId = TEST_SUPPLIER;
  (product as any).minimumAcceptableShelfLifeDays = 90;

  await setDoc(doc(db, 'products', TEST_PRODUCT), product);

  // 3. Batches
  // Batch 1: Usable (100 tablets), expires in 200 days
  const expiryDate1 = new Date();
  expiryDate1.setDate(expiryDate1.getDate() + 200);
  const batch1: ProductBatch = {
    id: 'batch-f1',
    tenantId: TEST_TENANT,
    productId: TEST_PRODUCT,
    branchId: TEST_BRANCH,
    quantity: 100,
    expiryDate: expiryDate1.toISOString().split('T')[0],
    batchNumber: 'B-F1',
    purchasePrice: 400,
    sellingPrice: 600,
    batch_status: 'active',
    lastUpdated: new Date().toISOString()
  };
  await setDoc(doc(db, 'product_batches', 'batch-f1'), batch1);

  // Batch 2: Near Expiry (50 tablets), expires in 95 days (usable stock accepts only remainingAcceptable = remaining - 90 = 5 days of consumption!)
  const expiryDate2 = new Date();
  expiryDate2.setDate(expiryDate2.getDate() + 95);
  const batch2: ProductBatch = {
    id: 'batch-f2',
    tenantId: TEST_TENANT,
    productId: TEST_PRODUCT,
    branchId: TEST_BRANCH,
    quantity: 50,
    expiryDate: expiryDate2.toISOString().split('T')[0],
    batchNumber: 'B-F2',
    purchasePrice: 400,
    sellingPrice: 600,
    batch_status: 'active',
    lastUpdated: new Date().toISOString()
  };
  await setDoc(doc(db, 'product_batches', 'batch-f2'), batch2);

  // Batch 3: Quarantined (30 tablets)
  const expiryDate3 = new Date();
  expiryDate3.setDate(expiryDate3.getDate() + 250);
  const batch3: ProductBatch = {
    id: 'batch-f3',
    tenantId: TEST_TENANT,
    productId: TEST_PRODUCT,
    branchId: TEST_BRANCH,
    quantity: 30,
    expiryDate: expiryDate3.toISOString().split('T')[0],
    batchNumber: 'B-F3',
    purchasePrice: 400,
    sellingPrice: 600,
    batch_status: 'quarantined',
    lastUpdated: new Date().toISOString()
  };
  await setDoc(doc(db, 'product_batches', 'batch-f3'), batch3);

  // 4. Completed POs and GRNs for Observed Lead Time (Supplier has 2 deliveries)
  // Delivery 1: order approved at T-10, GRN received at T-2. Lead time = 8 days
  const po1: StockOrder = {
    id: 'po-1',
    tenantId: TEST_TENANT,
    order_number: 'PO-1',
    requesting_branch_id: TEST_BRANCH,
    order_type: 'monthly',
    category: 'sellable_non_cosmetic',
    generation_method: 'manual',
    status: 'fully_received',
    total_order_value_ugx: 10000,
    is_emergency: false,
    created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    created_by: 'system',
    approved_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
  };
  await setDoc(doc(db, 'stock_orders', 'po-1'), po1);

  const grn1: GRNRecord = {
    id: 'grn-1',
    tenantId: TEST_TENANT,
    grn_number: 'GRN-1',
    order_id: 'po-1',
    supplier_id: TEST_SUPPLIER,
    supplier_name: 'Mock Supplier',
    receivedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    receivedBy: 'tester',
    status: 'completed',
    total_value_ugx: 10000,
    items: []
  };
  await setDoc(doc(db, 'grn_records', 'grn-1'), grn1);

  // Delivery 2: order approved at T-6, GRN received at T-2. Lead time = 4 days
  // Median of [4, 8] is (4 + 8) / 2 = 6 days.
  const po2: StockOrder = {
    id: 'po-2',
    tenantId: TEST_TENANT,
    order_number: 'PO-2',
    requesting_branch_id: TEST_BRANCH,
    order_type: 'monthly',
    category: 'sellable_non_cosmetic',
    generation_method: 'manual',
    status: 'fully_received',
    total_order_value_ugx: 20000,
    is_emergency: false,
    created_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    created_by: 'system',
    approved_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString()
  };
  await setDoc(doc(db, 'stock_orders', 'po-2'), po2);

  const grn2: GRNRecord = {
    id: 'grn-2',
    tenantId: TEST_TENANT,
    grn_number: 'GRN-2',
    order_id: 'po-2',
    supplier_id: TEST_SUPPLIER,
    supplier_name: 'Mock Supplier',
    receivedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    receivedBy: 'tester',
    status: 'completed',
    total_value_ugx: 20000,
    items: []
  };
  await setDoc(doc(db, 'grn_records', 'grn-2'), grn2);

  // 5. Dispatched Incoming orders (Confirmed Incoming)
  // Stock order line dispatched = 3 packs = 30 tablets
  const poDispatched: StockOrder = {
    id: 'po-disp',
    tenantId: TEST_TENANT,
    order_number: 'PO-DISP',
    requesting_branch_id: TEST_BRANCH,
    order_type: 'weekly',
    category: 'sellable_non_cosmetic',
    generation_method: 'auto_generated',
    status: 'dispatched',
    total_order_value_ugx: 5000,
    is_emergency: false,
    created_at: new Date().toISOString(),
    created_by: 'system'
  };
  await setDoc(doc(db, 'stock_orders', 'po-disp'), poDispatched);

  const poLine: StockOrderLine = {
    id: 'line-disp',
    tenantId: TEST_TENANT,
    order_id: 'po-disp',
    product_id: TEST_PRODUCT,
    product_name: 'Forecasting Aspirin',
    qty_ordered: 3,
    qty_supplied: 3,
    unit_cost_ugx: 400,
    line_total_ugx: 1200,
    line_status: 'dispatched'
  };
  await setDoc(doc(db, 'stock_order_lines', 'line-disp'), poLine);

  console.log('Setup finished.');
}

async function writeConsumptionLogs(days: number, values: { ord: number; exp: number; stocked: boolean; stockoutMins?: number }[]) {
  console.log(`Writing ${days} days of mock aggregates...`);
  const start = new Date();
  start.setDate(start.getDate() - days);

  for (let i = 0; i < days; i++) {
    const dKey = start.toISOString().split('T')[0];
    const val: any = values[i] || { ord: 0, exp: 0, stocked: true };
    const stockoutMins = val.stockoutMins !== undefined ? val.stockoutMins : (val.stocked ? 0 : 720);

    const summary: any = {
      tenantId: TEST_TENANT,
      branchId: TEST_BRANCH,
      productId: TEST_PRODUCT,
      dateKey: dKey,
      validConsumptionUnits: val.ord,
      exceptionalUnits: val.exp,
      wasStockedAllDay: val.stocked,
      stockoutMinutes: stockoutMins,
      closingUsableStock: val.stocked ? 100 : 0
    };
    await setDoc(doc(db, 'branchConsumptionDaily', `${TEST_TENANT}_${TEST_BRANCH}_${TEST_PRODUCT}_${dKey}`), summary);
    start.setDate(start.getDate() + 1);
  }
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`);
      failed++;
    }
  }

  // Auth setup
  try {
    try {
      await registerAuthUser('devtest-owner@pharmapro.io', 'tester123');
    } catch (e) {}
    await signInWithEmailAndPassword(auth, 'devtest-owner@pharmapro.io', 'tester123');
  } catch (e: any) {
    console.error('Test Auth failure:', e.message);
    process.exit(1);
  }

  await cleanupTestData();
  await setupTestData();

  try {
    // ----------------------------------------------------
    // Test 1: Flat trend, no stockouts (30 days)
    // ----------------------------------------------------
    // Every day: 10 tablets sold, 0 exceptional. Stocked all day.
    const values1 = Array(30).fill({ ord: 10, exp: 0, stocked: true });
    await writeConsumptionLogs(30, values1);

    const startStr = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endStr = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const input1 = {
      tenantId: TEST_TENANT,
      branchId: TEST_BRANCH,
      productId: TEST_PRODUCT,
      analysisStartDate: startStr,
      analysisEndDate: endStr,
      forecastCoverageDays: 30,
      includeExceptionalConsumption: false,
      useSeasonality: false
    };

    console.log('\nRunning forecasting Test 1...');
    let res1 = await calculateProductForecast(input1);
    console.log('Result 1:', JSON.stringify(res1, null, 2));

    assert(res1.calculationAllowed === true, 'Test 1: calculation should be allowed');
    assert(res1.adc === 10, 'Test 1: ADC should be exactly 10 tablets');
    assert(res1.trendMultiplier === 1.0, 'Test 1: trend multiplier should be 1.0 (flat)');
    assert(res1.projectedDailyConsumption === 10, 'Test 1: projected daily consumption should be 10');
    assert(res1.projectedConsumption === 300, 'Test 1: projected coverage consumption should be 300 (10 * 30)');
    
    // Effective lead time should pull from hierarchy: manualLeadTime of product (6 days) vs observed median (6 days) -> HIGHER_OF_MANUAL_AND_OBSERVED = 6 days.
    assert(res1.effectiveLeadTimeDays === 6, 'Test 1: Effective lead time should be 6 days');
    assert(res1.leadTimeStock === 60, 'Test 1: Lead time stock should be 60 (10 * 6)');
    assert(res1.safetyBuffer === 100, 'Test 1: Safety buffer should be 100 (10 * 10 days)');
    assert(res1.targetStockLevel === 460, 'Test 1: Target level should be 460 (300 + 60 + 100)');

    // Expiry-adjusted Usable Stock:
    // Batch 1 (100 qty): Acceptable Consumption Days = 200 - 90 = 110. Expected consumption = 10 * 110 = 1100. Min(100, 1100) = 100.
    // Batch 2 (50 qty): Acceptable Consumption Days = 95 - 90 = 5. Expected consumption = 10 * 5 = 50. Min(50, 50) = 50.
    // Batch 3 is quarantined, so excluded.
    // Total usable stock = 100 + 50 = 150.
    assert(res1.expiryAdjustedUsableStock === 150, 'Test 1: Expiry-adjusted usable stock should be 150');

    // Confirmed Incoming = 3 packs = 30 tablets (dispatched)
    assert(res1.confirmedIncoming === 30, 'Test 1: Confirmed incoming should be 30');

    // Net requirement = Target (460) - Usable (150) - Confirmed (30) = 280
    assert(res1.grossNetRequirement === 280, 'Test 1: Gross Net Requirement should be 280');

    // ----------------------------------------------------
    // Test 2: Partial stockouts and caps
    // ----------------------------------------------------
    // 30 days: 10 days out of stock for half-day (availability ratio = 0.5, ord sold = 5)
    // 20 days: fully stocked, ord sold = 10
    // Total consumption ord = (10 * 5) + (20 * 10) = 250.
    // Valid stocked days = (10 * 0.5) + (20 * 1) = 25.
    // Availability ratio = 25 / 30 = 0.8333
    // Raw adjusted = 250 / 0.8333 = 300.
    // Capped adjusted = 250 * 3 = 750. Raw is below cap, so adjusted consumption = 300.
    // ADC = 300 / 30 = 10.
    const values2 = Array(10).fill({ ord: 5, exp: 0, stocked: false })
      .concat(Array(20).fill({ ord: 10, exp: 0, stocked: true }));
    await writeConsumptionLogs(30, values2);

    console.log('\nRunning forecasting Test 2...');
    let res2 = await calculateProductForecast(input1);
    assert(res2.adc === 10, 'Test 2: ADC adjusted for stockouts should be 10');

    // Test 3: Stockout Cap applied
    // 30 days: 28 days completely out of stock (availability ratio = 0, ord = 0)
    // 2 days fully stocked (availability ratio = 1.0, ord = 10)
    // Total consumption ord = 20.
    // Valid stocked days = 2.
    // Availability ratio = 2/30 = 0.0667.
    // Raw adjusted = 20 / 0.0667 = 300.
    // Capped adjusted = 20 * 3.0 (cap) = 60.
    // Raw (300) > Capped (60), so adjusted consumption is capped at 60!
    // ADC = 60 / 30 = 2.0.
    const values3 = Array(28).fill({ ord: 0, exp: 0, stocked: false, stockoutMins: 1440 })
      .concat(Array(2).fill({ ord: 10, exp: 0, stocked: true }));
    // Note: To make test pass minimumValidHistoryDays, we must adjust minimum history to be 2. Let's update settings document.
    const currentSettings = await getReplenishmentSettings(TEST_TENANT);
    await setDoc(doc(db, 'replenishmentEngineSettings', `${TEST_TENANT}_settings`), {
      ...currentSettings,
      minimumValidHistoryDays: 1 // Allow 1 day minimum history for test validation
    });

    await writeConsumptionLogs(30, values3);

    console.log('\nRunning forecasting Test 3...');
    let res3 = await calculateProductForecast(input1);
    assert(res3.adc === 2, 'Test 3: ADC should be capped at 2.0 (20 * 3 / 30)');
    assert(res3.warnings.some(w => w.includes('adjustment capped')), 'Test 3: Cap warning should be present');

    // ----------------------------------------------------
    // Test 4: Trend multiplier and new demand rule
    // ----------------------------------------------------
    // 30 days:
    // Earlier half (days 0-15): 0 sales
    // Recent half (days 15-30): 10 sales daily.
    // Earlier ADC = 0, Recent ADC = 10.
    // Trend multiplier should trigger the new demand rule = 1.5.
    const values4 = Array(15).fill({ ord: 0, exp: 0, stocked: true })
      .concat(Array(15).fill({ ord: 10, exp: 0, stocked: true }));
    await writeConsumptionLogs(30, values4);

    console.log('\nRunning forecasting Test 4...');
    let res4 = await calculateProductForecast(input1);
    assert(res4.trendMultiplier === 1.5, 'Test 4: Trend multiplier should be 1.5 due to new demand rule');

  } catch (e: any) {
    console.error('Test execution failed:', e.message);
    failed++;
  }

  await cleanupTestData();

  console.log(`\n=== Forecasting Test Results: Passed: ${passed}, Failed: ${failed} ===`);
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
