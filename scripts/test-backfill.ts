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
import { Product, ProductBatch, Sale, InventoryMovementEvent, BranchConsumptionDaily } from '../src/types';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const TEST_TENANT = 'demo';
const TEST_BRANCH = 'test-backfill-branch';
const TEST_PRODUCT = 'test-backfill-prod';

async function cleanupTestData() {
  console.log('Cleaning up test documents...');
  const collections = ['products', 'product_batches', 'sales', 'inventoryMovementEvents', 'branchConsumptionDaily'];
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

  // Remove local test checkpoint file if exists
  const CHECKPOINT_PATH = path.join('C:', 'Users', 'user', '.gemini', 'antigravity', 'brain', 'd045ae38-dceb-402f-94d6-dcc8096dc173', 'scratch', 'backfill-checkpoint.json');
  if (fs.existsSync(CHECKPOINT_PATH)) {
    fs.unlinkSync(CHECKPOINT_PATH);
  }

  console.log('Cleanup complete.');
}

async function setupTestData() {
  console.log('Setting up mock database documents for backfill test...');
  
  // 1. Create a product with multiplier = 10
  const product: Product = {
    id: TEST_PRODUCT,
    tenantId: TEST_TENANT,
    productId: TEST_PRODUCT,
    sku: 'SKU-BACKFILL',
    name: 'Backfill Test Aspirin',
    category: 'sellable_non_cosmetic',
    costPricePerPack: 5000,
    sellingPricePerUnit: 700,
    taxExempt: false,
    taxRate: 18,
    unitsPerPack: 10,
    unit: 'pack',
    baseUnit: 'tablet',
    unitOfSell: 'pack',
    stock: 100
  };
  await setDoc(doc(db, 'products', TEST_PRODUCT), product);

  // 2. Create batch
  const batch: ProductBatch = {
    id: 'batch-backfill',
    tenantId: TEST_TENANT,
    productId: TEST_PRODUCT,
    branchId: TEST_BRANCH,
    quantity: 100,
    expiryDate: '2030-12-31',
    batchNumber: 'B-BACK-01',
    purchasePrice: 500,
    sellingPrice: 700,
    batch_status: 'active',
    lastUpdated: new Date().toISOString()
  };
  await setDoc(doc(db, 'product_batches', 'batch-backfill'), batch);

  // 3. Create historical sales:
  // Sale 1: Completed sale on 2026-07-10 (quantity 2 packs = 20 tablets)
  const sale1: Sale = {
    id: 'sale-1',
    tenantId: TEST_TENANT,
    branchId: TEST_BRANCH,
    receiptNumber: 'REC-1',
    timestamp: '2026-07-10T12:00:00Z',
    subtotal: 1400,
    tax: 0,
    total: 1400,
    paymentMethod: 'cash',
    cashierId: 'test-cashier',
    status: 'completed',
    items: [
      {
        productId: TEST_PRODUCT,
        batchId: 'batch-backfill',
        name: 'Backfill Test Aspirin',
        quantity: 2,
        unitPrice: 700,
        total: 1400
      }
    ]
  };
  await setDoc(doc(db, 'sales', 'sale-1'), sale1);

  // Sale 2: Voided sale. Sold on 2026-07-11 (quantity 1 pack = 10 tablets). Voided on 2026-07-12.
  const sale2: Sale = {
    id: 'sale-2',
    tenantId: TEST_TENANT,
    branchId: TEST_BRANCH,
    receiptNumber: 'REC-2',
    timestamp: '2026-07-11T12:00:00Z',
    subtotal: 700,
    tax: 0,
    total: 700,
    paymentMethod: 'cash',
    cashierId: 'test-cashier',
    status: 'voided',
    voidedAt: '2026-07-12T15:30:00Z',
    voidedBy: 'test-cashier',
    voidReason: 'Test Void',
    items: [
      {
        productId: TEST_PRODUCT,
        batchId: 'batch-backfill',
        name: 'Backfill Test Aspirin',
        quantity: 1,
        unitPrice: 700,
        total: 700
      }
    ]
  };
  await setDoc(doc(db, 'sales', 'sale-2'), sale2);

  // Sale 3: completed sale on 2026-07-15, which will be filtered out by date query bounds
  const sale3: Sale = {
    id: 'sale-3',
    tenantId: TEST_TENANT,
    branchId: TEST_BRANCH,
    receiptNumber: 'REC-3',
    timestamp: '2026-07-15T12:00:00Z',
    subtotal: 700,
    tax: 0,
    total: 700,
    paymentMethod: 'cash',
    cashierId: 'test-cashier',
    status: 'completed',
    items: [
      {
        productId: TEST_PRODUCT,
        batchId: 'batch-backfill',
        name: 'Backfill Test Aspirin',
        quantity: 1,
        unitPrice: 700,
        total: 700
      }
    ]
  };
  await setDoc(doc(db, 'sales', 'sale-3'), sale3);

  console.log('Mock setup complete.');
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

  const reportPath = path.join('C:', 'Users', 'user', '.gemini', 'antigravity', 'brain', 'd045ae38-dceb-402f-94d6-dcc8096dc173', 'scratch', 'test-reconcile-report.json');

  try {
    // Test 1: Dry run performs 0 writes
    console.log('\nRunning Test 1: Dry run verification...');
    const dryRunOutput = execSync(
      `npx tsx scripts/backfill-branch-consumption.ts --tenant=${TEST_TENANT} --branch=${TEST_BRANCH} --from=2026-07-09 --to=2026-07-13 --dry-run --email=devtest-owner@pharmapro.io --password=tester123`,
      { encoding: 'utf8' }
    );
    console.log(dryRunOutput);

    // Assert that no movement events exist
    const eventsSnap = await getDocs(query(collection(db, 'inventoryMovementEvents'), where('tenantId', '==', TEST_TENANT)));
    assert(eventsSnap.empty, 'Dry run should write zero movement events');
    const summariesSnap = await getDocs(query(collection(db, 'branchConsumptionDaily'), where('tenantId', '==', TEST_TENANT)));
    assert(summariesSnap.empty, 'Dry run should write zero daily aggregates');

    // Test 2: Write run writes correct events and daily aggregates
    console.log('\nRunning Test 2: Write mode validation...');
    const writeOutput = execSync(
      `npx tsx scripts/backfill-branch-consumption.ts --tenant=${TEST_TENANT} --branch=${TEST_BRANCH} --from=2026-07-09 --to=2026-07-13 --write --email=devtest-owner@pharmapro.io --password=tester123 --output=${reportPath}`,
      { encoding: 'utf8' }
    );
    console.log(writeOutput);

    // Verify events written:
    // Sale 1 event: sales_sale-1_test-backfill-prod_0
    const ev1Doc = await getDoc(doc(db, 'inventoryMovementEvents', `sales_sale-1_${TEST_PRODUCT}_0`));
    assert(ev1Doc.exists(), 'SALE event for sale-1 should exist');
    assert(ev1Doc.data()?.quantityDeltaBaseUnits === -20, 'quantityDeltaBaseUnits should be -20');

    // Sale 2 event: sales_sale-2_test-backfill-prod_0
    const ev2Doc = await getDoc(doc(db, 'inventoryMovementEvents', `sales_sale-2_${TEST_PRODUCT}_0`));
    assert(ev2Doc.exists(), 'SALE event for sale-2 should exist');
    
    // Sale 2 reversal event: sales_sale-2_test-backfill-prod_reversal_0
    const ev2RevDoc = await getDoc(doc(db, 'inventoryMovementEvents', `sales_sale-2_${TEST_PRODUCT}_reversal_0`));
    assert(ev2RevDoc.exists(), 'SALE_REVERSAL event for sale-2 should exist');
    assert(ev2RevDoc.data()?.quantityDeltaBaseUnits === 10, 'quantityDeltaBaseUnits should be +10 (restocking)');
    assert(ev2RevDoc.data()?.consumptionDeltaBaseUnits === -10, 'consumptionDeltaBaseUnits should be -10');

    // Sale 3 event should NOT exist because it was outside range (2026-07-15)
    const ev3Doc = await getDoc(doc(db, 'inventoryMovementEvents', `sales_sale-3_${TEST_PRODUCT}_0`));
    assert(!ev3Doc.exists(), 'SALE event for sale-3 (outside date range) should not exist');

    // Verify daily summaries:
    // 2026-07-10 should have 20 units sold
    const sum1Doc = await getDoc(doc(db, 'branchConsumptionDaily', `${TEST_TENANT}_${TEST_BRANCH}_${TEST_PRODUCT}_2026-07-10`));
    assert(sum1Doc.exists(), 'Daily summary for 2026-07-10 should exist');
    assert(sum1Doc.data()?.validConsumptionUnits === 20, '2026-07-10 consumption should be 20');

    // 2026-07-11 should have 10 units sold
    const sum2Doc = await getDoc(doc(db, 'branchConsumptionDaily', `${TEST_TENANT}_${TEST_BRANCH}_${TEST_PRODUCT}_2026-07-11`));
    assert(sum2Doc.exists(), 'Daily summary for 2026-07-11 should exist');
    assert(sum2Doc.data()?.validConsumptionUnits === 10, '2026-07-11 consumption should be 10');

    // 2026-07-12 should have -10 units (reversal)
    const sum3Doc = await getDoc(doc(db, 'branchConsumptionDaily', `${TEST_TENANT}_${TEST_BRANCH}_${TEST_PRODUCT}_2026-07-12`));
    assert(sum3Doc.exists(), 'Daily summary for 2026-07-12 should exist');
    assert(sum3Doc.data()?.validConsumptionUnits === 0, '2026-07-12 net consumption should be 0');
    assert(sum3Doc.data()?.unitsReturnedToStock === 10, '2026-07-12 returned to stock should be 10');

    // Test 3: Re-run is idempotent (no duplicates or double count)
    console.log('\nRunning Test 3: Idempotency check...');
    const writeOutput2 = execSync(
      `npx tsx scripts/backfill-branch-consumption.ts --tenant=${TEST_TENANT} --branch=${TEST_BRANCH} --from=2026-07-09 --to=2026-07-13 --write --email=devtest-owner@pharmapro.io --password=tester123 --output=${reportPath}`,
      { encoding: 'utf8' }
    );
    console.log(writeOutput2);

    // Verify consumption didn't double
    const sum1DocAgain = await getDoc(doc(db, 'branchConsumptionDaily', `${TEST_TENANT}_${TEST_BRANCH}_${TEST_PRODUCT}_2026-07-10`));
    assert(sum1DocAgain.data()?.validConsumptionUnits === 20, 'Idempotent run should not increase consumption units');

    // Test 4: Reconciliation mismatch detection
    console.log('\nRunning Test 4: Mismatch detection...');
    // Manually corrupt summary document
    await setDoc(doc(db, 'branchConsumptionDaily', `${TEST_TENANT}_${TEST_BRANCH}_${TEST_PRODUCT}_2026-07-10`), {
      ...sum1Doc.data(),
      validConsumptionUnits: 999 // Mismatch!
    });

    const reconcileOutput = execSync(
      `npx tsx scripts/backfill-branch-consumption.ts --tenant=${TEST_TENANT} --branch=${TEST_BRANCH} --from=2026-07-09 --to=2026-07-13 --reconcile --email=devtest-owner@pharmapro.io --password=tester123 --output=${reportPath}`,
      { encoding: 'utf8' }
    );
    console.log(reconcileOutput);

    // Parse output file
    const reportData = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const mismatchRow = reportData.find((r: any) => r.status === 'MISMATCH');
    assert(!!mismatchRow, 'Reconciliation report should flag the mismatched row');
    assert(mismatchRow.difference === -979, 'Difference should reflect discrepancy (20 - 999 = -979)');

  } catch (e: any) {
    console.error('Test execution failed:', e.message);
    failed++;
  }

  await cleanupTestData();

  console.log(`\n=== Backfill Test Results: Passed: ${passed}, Failed: ${failed} ===`);
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
