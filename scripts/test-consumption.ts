import { 
  doc, 
  setDoc, 
  deleteDoc, 
  getDoc, 
  runTransaction, 
  collection, 
  query, 
  where, 
  getDocs,
  Timestamp
} from 'firebase/firestore';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { db, auth, registerAuthUser } from '../src/firebase';
import { 
  logMovementAndAggregateInTx, 
  getBranchProductBatchRefs, 
  getBaseUnitMultiplier,
  getDateKeyForTimezone
} from '../src/services/consumptionService';
import { Product, ProductBatch, InventoryMovementEvent, BranchConsumptionDaily } from '../src/types';

const TEST_TENANT_A = 'demo'; // legitimate tenant
const TEST_TENANT_B = 'demo-B'; // forbidden tenant
const TEST_BRANCH_A = 'test-branch-A';
const TEST_BRANCH_B = 'test-branch-B';
const TEST_PRODUCT_1 = 'test-prod-1';
const TEST_PRODUCT_2 = 'test-prod-2';

async function cleanupTestData() {
  console.log('Cleaning up test data...');
  const collections = ['products', 'product_batches', 'inventoryMovementEvents', 'branchConsumptionDaily'];
  for (const colName of collections) {
    const qA = query(
      collection(db, colName), 
      where('tenantId', '==', TEST_TENANT_A),
      where('productId', 'in', [TEST_PRODUCT_1, TEST_PRODUCT_2])
    );
    const snapA = await getDocs(qA);
    for (const d of snapA.docs) {
      try {
        await deleteDoc(doc(db, colName, d.id));
      } catch (e) {
        // Safe skip for forbidden resources in cleanups
      }
    }
  }
  console.log('Cleanup finished.');
}

async function setupTestData() {
  console.log('Setting up mock database documents...');
  
  // Product 1: Pack of 10 tablets
  const prod1: Product = {
    id: TEST_PRODUCT_1,
    tenantId: TEST_TENANT_A,
    productId: TEST_PRODUCT_1,
    sku: 'SKU-PROD1',
    name: 'Test Aspirin 100mg',
    category: 'sellable_non_cosmetic',
    costPricePerPack: 5000,
    sellingPricePerUnit: 700,
    taxExempt: false,
    taxRate: 18,
    unitsPerPack: 10,
    unit: 'pack',
    baseUnit: 'tablet',
    unitOfSell: 'pack',
    stock: 50
  };
  await setDoc(doc(db, 'products', TEST_PRODUCT_1), prod1);

  // Product 2: Single tablet
  const prod2: Product = {
    id: TEST_PRODUCT_2,
    tenantId: TEST_TENANT_A,
    productId: TEST_PRODUCT_2,
    sku: 'SKU-PROD2',
    name: 'Test Paracetamol 500mg',
    category: 'sellable_non_cosmetic',
    costPricePerPack: 1000,
    sellingPricePerUnit: 200,
    taxExempt: false,
    taxRate: 18,
    unitsPerPack: 1,
    unit: 'tablet',
    baseUnit: 'tablet',
    unitOfSell: 'tablet',
    stock: 0
  };
  await setDoc(doc(db, 'products', TEST_PRODUCT_2), prod2);

  // Batches
  const batch1: ProductBatch = {
    id: 'batch-1',
    tenantId: TEST_TENANT_A,
    productId: TEST_PRODUCT_1,
    branchId: TEST_BRANCH_A,
    quantity: 50,
    expiryDate: '2030-12-31',
    batchNumber: 'B-ASP-01',
    purchasePrice: 500,
    sellingPrice: 700,
    batch_status: 'active',
    lastUpdated: new Date().toISOString()
  };
  await setDoc(doc(db, 'product_batches', 'batch-1'), batch1);

  const batch2: ProductBatch = {
    id: 'batch-2',
    tenantId: TEST_TENANT_A,
    productId: TEST_PRODUCT_2,
    branchId: TEST_BRANCH_A,
    quantity: 0,
    expiryDate: '2030-12-31',
    batchNumber: 'B-PARA-01',
    purchasePrice: 150,
    sellingPrice: 200,
    batch_status: 'active',
    lastUpdated: new Date().toISOString()
  };
  await setDoc(doc(db, 'product_batches', 'batch-2'), batch2);

  console.log('Seeding finished.');
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

  let testUserUid = '';
  try {
    console.log('Registering/Authenticating test user...');
    try {
      testUserUid = await registerAuthUser('devtest-owner@pharmapro.io', 'tester123');
      console.log('Registered new auth user:', testUserUid);
    } catch (e: any) {
      if (e.code === 'auth/email-already-in-use' || e.message?.includes('already-in-use')) {
        const credential = await signInWithEmailAndPassword(auth, 'devtest-owner@pharmapro.io', 'tester123');
        testUserUid = credential.user.uid;
        console.log('Signed in existing auth user:', testUserUid);
      } else {
        throw e;
      }
    }

    // Now sign in to trigger active session
    await signInWithEmailAndPassword(auth, 'devtest-owner@pharmapro.io', 'tester123');

    // Create staff document FIRST (so getUserData rule succeeds for all subsequent reads/writes)
    await setDoc(doc(db, 'staff', testUserUid), {
      uid: testUserUid,
      tenantId: TEST_TENANT_A,
      email: 'devtest-owner@pharmapro.io',
      role: 'owner',
      full_name: 'Dev Tester',
      displayName: 'Dev Tester'
    });

    await cleanupTestData();
    await setupTestData();

    const dateKey = getDateKeyForTimezone(new Date(), 'Africa/Kampala');

    // TEST 1: Base unit conversion
    const prod1Snap = await getDoc(doc(db, 'products', TEST_PRODUCT_1));
    const prod1Data = prod1Snap.data() as Product;
    const mult1 = getBaseUnitMultiplier(prod1Data);
    assert(mult1 === 10, 'TEST 1.1: Product 1 multiplier is 10 (pack of 10)');

    const prod2Snap = await getDoc(doc(db, 'products', TEST_PRODUCT_2));
    const prod2Data = prod2Snap.data() as Product;
    const mult2 = getBaseUnitMultiplier(prod2Data);
    assert(mult2 === 1, 'TEST 1.2: Product 2 multiplier is 1 (tablet)');

    // TEST 2: Completed sale increases ordinary consumption once
    const batchRefs1 = await getBranchProductBatchRefs(TEST_TENANT_A, TEST_BRANCH_A, TEST_PRODUCT_1);
    
    await runTransaction(db, async (transaction) => {
      await logMovementAndAggregateInTx(transaction, batchRefs1, {
        tenantId: TEST_TENANT_A,
        branchId: TEST_BRANCH_A,
        productId: TEST_PRODUCT_1,
        eventType: 'SALE',
        quantityDeltaBaseUnits: -20, // sold 2 packs (20 tablets)
        consumptionDeltaBaseUnits: 20,
        isExceptional: false,
        exceptionalReason: null,
        sourceCollection: 'sales',
        sourceDocumentId: 'sale-doc-123',
        sourceLineId: 'line-1',
        reversalOfEventId: null,
        createdBy: 'test-cashier',
        effectiveAt: new Date()
      });
    });

    const summaryRef1 = doc(db, 'branchConsumptionDaily', `${TEST_TENANT_A}_${TEST_BRANCH_A}_${TEST_PRODUCT_1}_${dateKey}`);
    const summarySnap1 = await getDoc(summaryRef1);
    const summary1 = summarySnap1.data() as BranchConsumptionDaily;

    assert(summary1 !== undefined, 'TEST 2.1: branchConsumptionDaily document created');
    assert(summary1.ordinaryUnitsSold === 20, 'TEST 2.2: ordinaryUnitsSold is 20');
    assert(summary1.validConsumptionUnits === 20, 'TEST 2.3: validConsumptionUnits is 20');
    assert(summary1.transactionCount === 1, 'TEST 2.4: transactionCount is 1');
    assert(summary1.consumptionTransactionCount === 1, 'TEST 2.5: consumptionTransactionCount is 1');

    // TEST 3: Retried sale posting does not double-count (Idempotency)
    await runTransaction(db, async (transaction) => {
      await logMovementAndAggregateInTx(transaction, batchRefs1, {
        tenantId: TEST_TENANT_A,
        branchId: TEST_BRANCH_A,
        productId: TEST_PRODUCT_1,
        eventType: 'SALE',
        quantityDeltaBaseUnits: -20,
        consumptionDeltaBaseUnits: 20,
        isExceptional: false,
        exceptionalReason: null,
        sourceCollection: 'sales',
        sourceDocumentId: 'sale-doc-123',
        sourceLineId: 'line-1',
        reversalOfEventId: null,
        createdBy: 'test-cashier',
        effectiveAt: new Date()
      });
    });

    const summarySnap2 = await getDoc(summaryRef1);
    const summary2 = summarySnap2.data() as BranchConsumptionDaily;
    assert(summary2.ordinaryUnitsSold === 20, 'TEST 3.1: ordinaryUnitsSold remains 20 (idempotent)');
    assert(summary2.transactionCount === 1, 'TEST 3.2: transactionCount remains 1');

    // TEST 4: Sale reversal subtracts original quantity
    await runTransaction(db, async (transaction) => {
      await logMovementAndAggregateInTx(transaction, batchRefs1, {
        tenantId: TEST_TENANT_A,
        branchId: TEST_BRANCH_A,
        productId: TEST_PRODUCT_1,
        eventType: 'SALE_REVERSAL',
        quantityDeltaBaseUnits: 20,
        consumptionDeltaBaseUnits: -20,
        isExceptional: false,
        exceptionalReason: null,
        sourceCollection: 'sales',
        sourceDocumentId: 'sale-doc-123',
        sourceLineId: 'line-1',
        reversalOfEventId: 'sales_sale-doc-123_test-prod-1_line-1',
        createdBy: 'test-cashier',
        effectiveAt: new Date()
      });
    });

    const summarySnap3 = await getDoc(summaryRef1);
    const summary3 = summarySnap3.data() as BranchConsumptionDaily;
    assert(summary3.validConsumptionUnits === 0, 'TEST 4.1: validConsumptionUnits reduced to 0 after reversal');

    // TEST 5: Return-to-stock reduces net consumption
    await runTransaction(db, async (transaction) => {
      // First log a sale of 10 units
      await logMovementAndAggregateInTx(transaction, batchRefs1, {
        tenantId: TEST_TENANT_A,
        branchId: TEST_BRANCH_A,
        productId: TEST_PRODUCT_1,
        eventType: 'SALE',
        quantityDeltaBaseUnits: -10,
        consumptionDeltaBaseUnits: 10,
        isExceptional: false,
        exceptionalReason: null,
        sourceCollection: 'sales',
        sourceDocumentId: 'sale-doc-456',
        sourceLineId: 'line-1',
        reversalOfEventId: null,
        createdBy: 'test-cashier',
        effectiveAt: new Date()
      });
    });

    await runTransaction(db, async (transaction) => {
      // Then return 4 units to stock
      await logMovementAndAggregateInTx(transaction, batchRefs1, {
        tenantId: TEST_TENANT_A,
        branchId: TEST_BRANCH_A,
        productId: TEST_PRODUCT_1,
        eventType: 'RETURN_TO_STOCK',
        quantityDeltaBaseUnits: 4,
        consumptionDeltaBaseUnits: -4,
        isExceptional: false,
        exceptionalReason: null,
        sourceCollection: 'sales',
        sourceDocumentId: 'sale-doc-456',
        sourceLineId: 'line-1_return',
        reversalOfEventId: null,
        createdBy: 'test-cashier',
        effectiveAt: new Date()
      });
    });

    const summarySnap4 = await getDoc(summaryRef1);
    const summary4 = summarySnap4.data() as BranchConsumptionDaily;
    assert(summary4.validConsumptionUnits === 6, 'TEST 5.1: validConsumptionUnits is 6 (10 - 4)');
    assert(summary4.unitsReturnedToStock === 4, 'TEST 5.2: unitsReturnedToStock is 4');

    // TEST 6: Transfer-out does not count as customer consumption
    await runTransaction(db, async (transaction) => {
      await logMovementAndAggregateInTx(transaction, batchRefs1, {
        tenantId: TEST_TENANT_A,
        branchId: TEST_BRANCH_A,
        productId: TEST_PRODUCT_1,
        eventType: 'TRANSFER_OUT',
        quantityDeltaBaseUnits: -5,
        consumptionDeltaBaseUnits: 0,
        isExceptional: false,
        exceptionalReason: null,
        sourceCollection: 'transfers',
        sourceDocumentId: 'trf-doc-123',
        sourceLineId: 'line-1',
        reversalOfEventId: null,
        createdBy: 'test-staff',
        effectiveAt: new Date()
      });
    });

    const summarySnap5 = await getDoc(summaryRef1);
    const summary5 = summarySnap5.data() as BranchConsumptionDaily;
    assert(summary5.unitsTransferredOut === 5, 'TEST 6.1: unitsTransferredOut is 5');
    assert(summary5.validConsumptionUnits === 6, 'TEST 6.2: validConsumptionUnits remains 6 (unchanged)');

    // TEST 7: Write-off does not count as customer consumption
    await runTransaction(db, async (transaction) => {
      await logMovementAndAggregateInTx(transaction, batchRefs1, {
        tenantId: TEST_TENANT_A,
        branchId: TEST_BRANCH_A,
        productId: TEST_PRODUCT_1,
        eventType: 'WRITE_OFF',
        quantityDeltaBaseUnits: -3,
        consumptionDeltaBaseUnits: 0,
        isExceptional: false,
        exceptionalReason: null,
        sourceCollection: 'writeoffs',
        sourceDocumentId: 'wo-doc-123',
        sourceLineId: 'line-1',
        reversalOfEventId: null,
        createdBy: 'test-staff',
        effectiveAt: new Date()
      });
    });

    const summarySnap6 = await getDoc(summaryRef1);
    const summary6 = summarySnap6.data() as BranchConsumptionDaily;
    assert(summary6.unitsWrittenOff === 3, 'TEST 7.1: unitsWrittenOff is 3');
    assert(summary6.validConsumptionUnits === 6, 'TEST 7.2: validConsumptionUnits remains 6 (unchanged)');

    // TEST 8: Exceptional sale is separated from ordinary consumption
    await runTransaction(db, async (transaction) => {
      await logMovementAndAggregateInTx(transaction, batchRefs1, {
        tenantId: TEST_TENANT_A,
        branchId: TEST_BRANCH_A,
        productId: TEST_PRODUCT_1,
        eventType: 'SALE',
        quantityDeltaBaseUnits: -15,
        consumptionDeltaBaseUnits: 15,
        isExceptional: true,
        exceptionalReason: 'Institutional bulk order',
        sourceCollection: 'sales',
        sourceDocumentId: 'sale-doc-789',
        sourceLineId: 'line-1',
        reversalOfEventId: null,
        createdBy: 'test-cashier',
        effectiveAt: new Date()
      });
    });

    const summarySnap7 = await getDoc(summaryRef1);
    const summary7 = summarySnap7.data() as BranchConsumptionDaily;
    assert(summary7.exceptionalUnits === 15, 'TEST 8.1: exceptionalUnits is 15');
    assert(summary7.validConsumptionUnits === 6, 'TEST 8.2: validConsumptionUnits remains 6 (separated)');

    // TEST 9: Tenant isolation (Tenant A cannot update Tenant B summaries)
    let permissionDeniedThrown = false;
    try {
      const batchRefsB1 = await getBranchProductBatchRefs(TEST_TENANT_B, TEST_BRANCH_A, TEST_PRODUCT_1);
      await runTransaction(db, async (transaction) => {
        await logMovementAndAggregateInTx(transaction, batchRefsB1, {
          tenantId: TEST_TENANT_B, // unauthorized tenant
          branchId: TEST_BRANCH_A,
          productId: TEST_PRODUCT_1,
          eventType: 'SALE',
          quantityDeltaBaseUnits: -5,
          consumptionDeltaBaseUnits: 5,
          isExceptional: false,
          exceptionalReason: null,
          sourceCollection: 'sales',
          sourceDocumentId: 'sale-doc-999',
          sourceLineId: 'line-1',
          reversalOfEventId: null,
          createdBy: 'test-cashier',
          effectiveAt: new Date()
        });
      });
    } catch (e: any) {
      if (e.message.includes('permission-denied') || e.code === 'permission-denied') {
        permissionDeniedThrown = true;
      }
    }
    assert(permissionDeniedThrown === true, 'TEST 9.1: Unauthorized write to Tenant B triggers Permission Denied');

    // TEST 10: Stockout availability tracking
    const batchRefs2 = await getBranchProductBatchRefs(TEST_TENANT_A, TEST_BRANCH_A, TEST_PRODUCT_2);
    
    await runTransaction(db, async (transaction) => {
      await logMovementAndAggregateInTx(transaction, batchRefs2, {
        tenantId: TEST_TENANT_A,
        branchId: TEST_BRANCH_A,
        productId: TEST_PRODUCT_2,
        eventType: 'POSITIVE_ADJUSTMENT',
        quantityDeltaBaseUnits: 0,
        consumptionDeltaBaseUnits: 0,
        isExceptional: false,
        exceptionalReason: null,
        sourceCollection: 'test',
        sourceDocumentId: 'init',
        sourceLineId: '1',
        reversalOfEventId: null,
        createdBy: 'system',
        effectiveAt: new Date()
      });
    });

    const summaryRef2 = doc(db, 'branchConsumptionDaily', `${TEST_TENANT_A}_${TEST_BRANCH_A}_${TEST_PRODUCT_2}_${dateKey}`);
    const summarySnapStockout = await getDoc(summaryRef2);
    const summaryStockout = summarySnapStockout.data() as BranchConsumptionDaily;

    assert(summaryStockout.wasStockedAllDay === false, 'TEST 10.1: Initial stock of 0 logs wasStockedAllDay = false');
    assert(summaryStockout.firstStockoutAt !== null, 'TEST 10.2: firstStockoutAt is set');

    // Log restock
    await runTransaction(db, async (transaction) => {
      await logMovementAndAggregateInTx(transaction, batchRefs2, {
        tenantId: TEST_TENANT_A,
        branchId: TEST_BRANCH_A,
        productId: TEST_PRODUCT_2,
        eventType: 'POSITIVE_ADJUSTMENT',
        quantityDeltaBaseUnits: 25,
        consumptionDeltaBaseUnits: 0,
        isExceptional: false,
        exceptionalReason: null,
        sourceCollection: 'test',
        sourceDocumentId: 'restock',
        sourceLineId: '1',
        reversalOfEventId: null,
        createdBy: 'system',
        effectiveAt: new Date()
      });
    });

    const summarySnapRestocked = await getDoc(summaryRef2);
    const summaryRestocked = summarySnapRestocked.data() as BranchConsumptionDaily;
    assert(summaryRestocked.lastRestockedAt !== null, 'TEST 10.3: lastRestockedAt is set after restocking');
    assert(summaryRestocked.closingUsableStock === 25, 'TEST 10.4: closingUsableStock updated to 25');

    // TEST 11: Summary values reconcile to movement events
    const eventsQuery = query(
      collection(db, 'inventoryMovementEvents'),
      where('tenantId', '==', TEST_TENANT_A),
      where('branchId', '==', TEST_BRANCH_A),
      where('productId', '==', TEST_PRODUCT_1),
      where('dateKey', '==', dateKey)
    );
    const eventsSnap = await getDocs(eventsQuery);
    const events = eventsSnap.docs.map(d => d.data() as InventoryMovementEvent);

    let sumOrdinarySoldGross = 0;
    let sumOrdinarySoldNet = 0;
    let sumExceptional = 0;
    let sumReturned = 0;
    let sumTransferredOut = 0;
    let sumWrittenOff = 0;

    events.forEach(ev => {
      if (ev.eventType === 'SALE') {
        if (ev.isExceptional) {
          sumExceptional += ev.consumptionDeltaBaseUnits;
        } else {
          sumOrdinarySoldGross += ev.consumptionDeltaBaseUnits;
          sumOrdinarySoldNet += ev.consumptionDeltaBaseUnits;
        }
      } else if (ev.eventType === 'SALE_REVERSAL') {
        if (ev.isExceptional) {
          sumExceptional += ev.consumptionDeltaBaseUnits;
        } else {
          sumOrdinarySoldNet += ev.consumptionDeltaBaseUnits;
        }
      } else if (ev.eventType === 'RETURN_TO_STOCK') {
        sumReturned += ev.quantityDeltaBaseUnits;
        sumOrdinarySoldNet += ev.consumptionDeltaBaseUnits;
      } else if (ev.eventType === 'TRANSFER_OUT') {
        sumTransferredOut += Math.abs(ev.quantityDeltaBaseUnits);
      } else if (ev.eventType === 'WRITE_OFF') {
        sumWrittenOff += Math.abs(ev.quantityDeltaBaseUnits);
      }
    });

    const summarySnapReconcile = await getDoc(summaryRef1);
    const summaryReconcile = summarySnapReconcile.data() as BranchConsumptionDaily;

    assert(summaryReconcile.ordinaryUnitsSold === sumOrdinarySoldGross, 'TEST 11.1: Gross ordinary units sold matches daily summary');
    assert(summaryReconcile.validConsumptionUnits === sumOrdinarySoldNet, 'TEST 11.1b: Net consumption matches sum of ordinary event deltas');
    assert(summaryReconcile.exceptionalUnits === sumExceptional, 'TEST 11.2: Exceptional units matches daily summary');
    assert(summaryReconcile.unitsTransferredOut === sumTransferredOut, 'TEST 11.3: Transferred out units match daily summary');
    assert(summaryReconcile.unitsWrittenOff === sumWrittenOff, 'TEST 11.4: Written off units match daily summary');

  } catch (error) {
    console.error('Error executing test sequence: ', error);
    failed++;
  } finally {
    await cleanupTestData();
    // delete devtest-owner staff doc
    if (testUserUid) {
      try {
        await deleteDoc(doc(db, 'staff', testUserUid));
      } catch (e) {}
    }
  }

  console.log(`\n=== TEST SUITE RESULTS ===`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
