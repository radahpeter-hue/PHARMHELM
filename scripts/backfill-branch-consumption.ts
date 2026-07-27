import { signInWithEmailAndPassword } from 'firebase/auth';
import { 
  collection, 
  doc, 
  getDocs, 
  getDoc,
  query, 
  where, 
  runTransaction,
  Timestamp,
  setDoc
} from 'firebase/firestore';
import { db, auth } from '../src/firebase';
import { 
  logMovementAndAggregateInTx, 
  getBranchProductBatchRefs, 
  getBaseUnitMultiplier,
  getDateKeyForTimezone
} from '../src/services/consumptionService';
import { Product, Sale, InventoryMovementEvent, BranchConsumptionDaily } from '../src/types';
import * as fs from 'fs';
import * as path from 'path';

interface BackfillArgs {
  tenant: string;
  branch?: string;
  product?: string;
  from?: string;
  to?: string;
  dryRun: boolean;
  write: boolean;
  resume: boolean;
  reconcile: boolean;
  limit?: number;
  batchSize: number;
  output: string;
  email?: string;
  password?: string;
}

function parseArgs(args: string[]): BackfillArgs {
  const parsed: any = {
    dryRun: false,
    write: false,
    resume: false,
    reconcile: false,
    batchSize: 50,
    output: path.join('C:', 'Users', 'user', '.gemini', 'antigravity', 'brain', 'd045ae38-dceb-402f-94d6-dcc8096dc173', 'scratch', 'reconciliation-report.json')
  };

  for (const arg of args) {
    if (arg.startsWith('--tenant=')) parsed.tenant = arg.split('=')[1];
    else if (arg.startsWith('--branch=')) parsed.branch = arg.split('=')[1];
    else if (arg.startsWith('--product=')) parsed.product = arg.split('=')[1];
    else if (arg.startsWith('--from=')) parsed.from = arg.split('=')[1];
    else if (arg.startsWith('--to=')) parsed.to = arg.split('=')[1];
    else if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--write') parsed.write = true;
    else if (arg === '--resume') parsed.resume = true;
    else if (arg === '--reconcile') parsed.reconcile = true;
    else if (arg.startsWith('--limit=')) parsed.limit = parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--batch-size=')) parsed.batchSize = parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--output=')) parsed.output = arg.split('=')[1];
    else if (arg.startsWith('--email=')) parsed.email = arg.split('=')[1];
    else if (arg.startsWith('--password=')) parsed.password = arg.split('=')[1];
  }
  return parsed;
}

// Checkpoint schema
interface Checkpoint {
  processedSales: Record<string, boolean>;
}

const CHECKPOINT_PATH = path.join('C:', 'Users', 'user', '.gemini', 'antigravity', 'brain', 'd045ae38-dceb-402f-94d6-dcc8096dc173', 'scratch', 'backfill-checkpoint.json');

function loadCheckpoint(resume: boolean): Checkpoint {
  if (resume && fs.existsSync(CHECKPOINT_PATH)) {
    try {
      const data = fs.readFileSync(CHECKPOINT_PATH, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      console.warn('[Resume] Failed to parse checkpoint, starting fresh.', e);
    }
  }
  return { processedSales: {} };
}

function saveCheckpoint(checkpoint: Checkpoint) {
  try {
    const dir = path.dirname(CHECKPOINT_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2), 'utf8');
  } catch (e) {
    console.error('[Checkpoint] Failed to save checkpoint:', e);
  }
}

// Reconciliation report schema
interface ReconciliationRow {
  tenantId: string;
  branchId: string;
  productId: string;
  dateRange: string;
  rawSourceUnits: number;
  movementEventUnits: number;
  summaryUnits: number;
  difference: number;
  status: 'MATCHED' | 'MISMATCH' | 'MISSING_CONVERSION' | 'MISSING_PRODUCT' | 'INVALID_SOURCE_STATUS' | 'DUPLICATE_SOURCE' | 'FAILED';
  exceptionReason?: string;
}

async function run() {
  const startTime = Date.now();
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  console.log('=== PharmHelm Pro Backfill Engine ===');
  console.log('Parsed CLI options:', JSON.stringify(args, null, 2));

  // Validation
  if (!args.tenant) {
    console.error('Error: --tenant=<tenantId> is a mandatory option.');
    process.exit(1);
  }

  if (args.from && isNaN(Date.parse(args.from))) {
    console.error(`Error: Invalid --from date format: ${args.from}`);
    process.exit(1);
  }
  if (args.to && isNaN(Date.parse(args.to))) {
    console.error(`Error: Invalid --to date format: ${args.to}`);
    process.exit(1);
  }

  if (!args.write && !args.dryRun && !args.reconcile) {
    console.log('Note: Neither --write nor --reconcile specified. Running in dry-run mode by default.');
    args.dryRun = true;
  }

  // Auth setup
  const authEmail = args.email || 'admin@pharmapro.io';
  const authPassword = args.password || 'admin123';
  console.log(`Authenticating as administrative user: ${authEmail}...`);
  try {
    await signInWithEmailAndPassword(auth, authEmail, authPassword);
    console.log('Authentication successful.');
  } catch (e: any) {
    console.error(`Authentication failed for ${authEmail}:`, e.message);
    process.exit(1);
  }

  // Load and cache products
  console.log('Caching products catalogue...');
  const productsMap = new Map<string, Product>();
  const productsSnap = await getDocs(query(collection(db, 'products'), where('tenantId', '==', args.tenant)));
  productsSnap.forEach(d => {
    productsMap.set(d.id, d.data() as Product);
  });
  console.log(`Cached ${productsMap.size} products.`);

  // Load checkpoint
  const checkpoint = loadCheckpoint(args.resume);
  if (args.resume) {
    console.log(`[Resume] Loaded checkpoint. Already processed sales count: ${Object.keys(checkpoint.processedSales).length}`);
  }

  // Query sales
  console.log('Querying historical sales transactions...');
  const salesQuery = query(collection(db, 'sales'), where('tenantId', '==', args.tenant));
  const salesSnap = await getDocs(salesQuery);
  let rawSalesList = salesSnap.docs.map(d => ({ ...d.data(), id: d.id } as Sale));

  // Sort sales chronologically
  rawSalesList.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Filter sales client-side for dates and branch
  let filteredSales = rawSalesList.filter(s => {
    // Branch filter
    if (args.branch && s.branchId !== args.branch) return false;
    // Status exclusion
    if (s.status !== 'completed' && s.status !== 'voided') return false;
    return true;
  });

  console.log(`Total tenant sales: ${rawSalesList.length}, matching criteria: ${filteredSales.length}`);

  // Data metrics tracking
  let metrics = {
    branchesProcessed: new Set<string>(),
    productsProcessed: new Set<string>(),
    sourceRecordsRead: 0,
    movementEventsCreated: 0,
    summariesUpdated: 0,
    duplicatesPrevented: 0,
    missingProductMappings: 0,
    missingUnitConversions: 0,
    missingBranchIds: 0,
    missingTenantIds: 0,
    reconciliationMismatchCount: 0
  };

  const exceptions: { docId: string; type: string; reason: string }[] = [];

  if (args.reconcile) {
    console.log('\n--- Running Reconciliation Report ---');
    await executeReconciliation(args, filteredSales, productsMap, metrics);
    console.log(`Total Runtime: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
    process.exit(0);
  }

  // Processing sales
  console.log('\n--- Processing Historical Sales ---');
  let processedCount = 0;
  for (const sale of filteredSales) {
    if (args.limit && processedCount >= args.limit) {
      console.log(`Reached limit boundary: ${args.limit}`);
      break;
    }

    if (args.resume && checkpoint.processedSales[sale.id]) {
      // Already processed in previous run
      continue;
    }

    metrics.sourceRecordsRead++;
    processedCount++;

    const isVoided = sale.status === 'voided';
    const saleDate = new Date(sale.timestamp);
    const voidDate = sale.voidedAt ? new Date(sale.voidedAt) : saleDate;

    // Apply date range filter client-side if specified
    const isSaleInDateRange = (!args.from || saleDate >= new Date(args.from)) && (!args.to || saleDate <= new Date(args.to));
    const isVoidInDateRange = isVoided && (!args.from || voidDate >= new Date(args.from)) && (!args.to || voidDate <= new Date(args.to));

    if (!isSaleInDateRange && !isVoidInDateRange) {
      continue;
    }

    if (!sale.tenantId) {
      metrics.missingTenantIds++;
      exceptions.push({ docId: sale.id, type: 'MISSING_TENANT', reason: 'Document has no tenantId' });
      continue;
    }
    if (!sale.branchId) {
      metrics.missingBranchIds++;
      exceptions.push({ docId: sale.id, type: 'MISSING_BRANCH', reason: 'Document has no branchId' });
      continue;
    }

    metrics.branchesProcessed.add(sale.branchId);

    // Process each item in sale
    let itemIdx = -1;
    for (const item of sale.items || []) {
      itemIdx++;
      if (item.isService) continue;

      const product = productsMap.get(item.productId);
      if (!product) {
        metrics.missingProductMappings++;
        exceptions.push({ docId: sale.id, type: 'MISSING_PRODUCT', reason: `Product ID ${item.productId} not found in master catalog` });
        continue;
      }

      metrics.productsProcessed.add(item.productId);

      if (args.product && item.productId !== args.product) {
        continue;
      }

      const multiplier = getBaseUnitMultiplier(product);
      if (!multiplier || multiplier <= 0) {
        metrics.missingUnitConversions++;
        exceptions.push({ docId: sale.id, type: 'MISSING_CONVERSION', reason: `Invalid multiplier for product ID ${item.productId}` });
        continue;
      }

      const qtyBaseUnits = (item.quantity || 0) * multiplier;
      const isExceptional = !!sale.isExceptionalConsumption;
      const exceptionalReason = sale.exceptionalConsumptionReason || null;

      // 1. Write SALE movement event if in range
      if (isSaleInDateRange) {
        const saleEventId = `sales_${sale.id}_${item.productId}_${itemIdx}`;
        if (args.dryRun) {
          console.log(`[DRY RUN] Would write SALE event ${saleEventId} for Qty: ${qtyBaseUnits}`);
          metrics.movementEventsCreated++;
        } else if (args.write) {
          try {
            const batchRefs = await getBranchProductBatchRefs(sale.tenantId, sale.branchId, item.productId);
            await runTransaction(db, async (transaction) => {
              // Check idempotency first inside tx
              const evRef = doc(db, 'inventoryMovementEvents', saleEventId);
              const evSnap = await transaction.get(evRef);
              if (evSnap.exists()) {
                metrics.duplicatesPrevented++;
                return;
              }

              await logMovementAndAggregateInTx(transaction, batchRefs, {
                tenantId: sale.tenantId,
                branchId: sale.branchId,
                productId: item.productId,
                eventType: 'SALE',
                quantityDeltaBaseUnits: -qtyBaseUnits,
                consumptionDeltaBaseUnits: qtyBaseUnits,
                isExceptional,
                exceptionalReason,
                sourceCollection: 'sales',
                sourceDocumentId: sale.id,
                sourceLineId: String(itemIdx),
                reversalOfEventId: null,
                createdBy: sale.servedBy || sale.cashierId || 'system_backfill',
                effectiveAt: saleDate
              });
            });
            metrics.movementEventsCreated++;
            metrics.summariesUpdated++;
          } catch (e: any) {
            console.error(`Failed writing SALE event for sale ${sale.id} line ${itemIdx}:`, e.message);
            exceptions.push({ docId: sale.id, type: 'FAILED_WRITE', reason: `SALE: ${e.message}` });
          }
        }
      }

      // 2. Write compensating SALE_REVERSAL event if voided and in range
      if (isVoided && isVoidInDateRange) {
        const reversalEventId = `sales_${sale.id}_${item.productId}_reversal_${itemIdx}`;
        if (args.dryRun) {
          console.log(`[DRY RUN] Would write SALE_REVERSAL event ${reversalEventId} for Qty: -${qtyBaseUnits}`);
          metrics.movementEventsCreated++;
        } else if (args.write) {
          try {
            const batchRefs = await getBranchProductBatchRefs(sale.tenantId, sale.branchId, item.productId);
            await runTransaction(db, async (transaction) => {
              const evRef = doc(db, 'inventoryMovementEvents', reversalEventId);
              const evSnap = await transaction.get(evRef);
              if (evSnap.exists()) {
                metrics.duplicatesPrevented++;
                return;
              }

              await logMovementAndAggregateInTx(transaction, batchRefs, {
                tenantId: sale.tenantId,
                branchId: sale.branchId,
                productId: item.productId,
                eventType: 'SALE_REVERSAL',
                quantityDeltaBaseUnits: qtyBaseUnits, // Returns stock
                consumptionDeltaBaseUnits: -qtyBaseUnits, // Subtracts consumption
                isExceptional,
                exceptionalReason,
                sourceCollection: 'sales',
                sourceDocumentId: sale.id,
                sourceLineId: String(itemIdx),
                reversalOfEventId: `sales_${sale.id}_${item.productId}_${itemIdx}`,
                createdBy: sale.servedBy || sale.cashierId || 'system_backfill',
                effectiveAt: voidDate
              });
            });
            metrics.movementEventsCreated++;
            metrics.summariesUpdated++;
          } catch (e: any) {
            console.error(`Failed writing SALE_REVERSAL event for sale ${sale.id} line ${itemIdx}:`, e.message);
            exceptions.push({ docId: sale.id, type: 'FAILED_WRITE', reason: `SALE_REVERSAL: ${e.message}` });
          }
        }
      }
    }

    // Save progress checkpoint
    checkpoint.processedSales[sale.id] = true;
    saveCheckpoint(checkpoint);
  }

  // Print final summary report
  console.log('\n=== Backfill Summary Metrics ===');
  console.log(`Branches Processed:         ${metrics.branchesProcessed.size}`);
  console.log(`Products Processed:         ${metrics.productsProcessed.size}`);
  console.log(`Source Records Read:        ${metrics.sourceRecordsRead}`);
  console.log(`Movement Events Logged:     ${metrics.movementEventsCreated}`);
  console.log(`Daily Summaries Updated:    ${metrics.summariesUpdated}`);
  console.log(`Duplicates Prevented:       ${metrics.duplicatesPrevented}`);
  console.log(`Missing Product Mappings:   ${metrics.missingProductMappings}`);
  console.log(`Missing Unit Conversions:   ${metrics.missingUnitConversions}`);
  console.log(`Missing Branch IDs:         ${metrics.missingBranchIds}`);
  console.log(`Missing Tenant IDs:         ${metrics.missingTenantIds}`);
  console.log(`Exceptions Logged:          ${exceptions.length}`);
  console.log(`Total Runtime:              ${((Date.now() - startTime) / 1000).toFixed(2)}s`);

  if (exceptions.length > 0) {
    console.log('\n=== Exceptions Report ===');
    console.log(JSON.stringify(exceptions.slice(0, 10), null, 2));
    if (exceptions.length > 10) console.log(`...and ${exceptions.length - 10} more exceptions.`);
  }

  // Auto-run reconciliation if write was completed
  if (args.write && !args.dryRun) {
    console.log('\n--- Executing Post-Backfill Reconciliation ---');
    await executeReconciliation(args, filteredSales, productsMap, metrics);
  }
}

async function executeReconciliation(
  args: BackfillArgs,
  filteredSales: Sale[],
  productsMap: Map<string, Product>,
  metrics: any
) {
  // We want to calculate:
  // Raw valid source consumption VS Movement event consumption VS Daily summary consumption
  const branchProductKeys = new Set<string>();
  
  // Group raw source consumption by branch, product, dateKey
  // key format: branchId_productId_dateKey
  const rawSourceConsumption: Record<string, { ordinary: number; exceptional: number }> = {};

  for (const sale of filteredSales) {
    const isVoided = sale.status === 'voided';
    const saleDate = new Date(sale.timestamp);
    const voidDate = sale.voidedAt ? new Date(sale.voidedAt) : saleDate;

    const dateKeySale = getDateKeyForTimezone(saleDate);
    const dateKeyVoid = getDateKeyForTimezone(voidDate);

    // Apply filters
    const isSaleInDateRange = (!args.from || dateKeySale >= args.from) && (!args.to || dateKeySale <= args.to);
    const isVoidInDateRange = isVoided && (!args.from || dateKeyVoid >= args.from) && (!args.to || dateKeyVoid <= args.to);

    if (args.branch && sale.branchId !== args.branch) continue;

    for (const item of sale.items || []) {
      if (item.isService) continue;
      if (args.product && item.productId !== args.product) continue;

      const product = productsMap.get(item.productId);
      if (!product) continue;

      const multiplier = getBaseUnitMultiplier(product);
      if (!multiplier || multiplier <= 0) continue;

      const qtyBaseUnits = item.quantity * multiplier;
      const isExceptional = !!sale.isExceptionalConsumption;

      // 1. Process Sale
      if (isSaleInDateRange) {
        const key = `${sale.branchId}_${item.productId}_${dateKeySale}`;
        branchProductKeys.add(`${sale.branchId}_${item.productId}`);
        if (!rawSourceConsumption[key]) rawSourceConsumption[key] = { ordinary: 0, exceptional: 0 };
        if (isExceptional) {
          rawSourceConsumption[key].exceptional += qtyBaseUnits;
        } else {
          rawSourceConsumption[key].ordinary += qtyBaseUnits;
        }
      }

      // 2. Process Reversal
      if (isVoided && isVoidInDateRange) {
        const key = `${sale.branchId}_${item.productId}_${dateKeyVoid}`;
        branchProductKeys.add(`${sale.branchId}_${item.productId}`);
        if (!rawSourceConsumption[key]) rawSourceConsumption[key] = { ordinary: 0, exceptional: 0 };
        if (isExceptional) {
          rawSourceConsumption[key].exceptional -= qtyBaseUnits;
        } else {
          rawSourceConsumption[key].ordinary -= qtyBaseUnits;
        }
      }
    }
  }

  // Load all movement events for this tenant
  const eventsSnap = await getDocs(query(collection(db, 'inventoryMovementEvents'), where('tenantId', '==', args.tenant)));
  const movementConsumption: Record<string, { ordinary: number; exceptional: number }> = {};

  eventsSnap.forEach(d => {
    const ev = d.data() as InventoryMovementEvent;
    if (args.branch && ev.branchId !== args.branch) return;
    if (args.product && ev.productId !== args.product) return;

    const dateVal = (ev.effectiveAt && typeof (ev.effectiveAt as any).toDate === 'function')
      ? (ev.effectiveAt as any).toDate()
      : new Date(ev.effectiveAt);
    const dateKey = getDateKeyForTimezone(dateVal);
    if (args.from && dateKey < args.from) return;
    if (args.to && dateKey > args.to) return;

    const key = `${ev.branchId}_${ev.productId}_${dateKey}`;
    if (!movementConsumption[key]) movementConsumption[key] = { ordinary: 0, exceptional: 0 };

    if (ev.eventType === 'SALE' || ev.eventType === 'DISPENSING') {
      if (ev.isExceptional) {
        movementConsumption[key].exceptional += ev.consumptionDeltaBaseUnits;
      } else {
        movementConsumption[key].ordinary += ev.consumptionDeltaBaseUnits;
      }
    } else if (ev.eventType === 'SALE_REVERSAL' || ev.eventType === 'RETURN_TO_STOCK') {
      if (ev.isExceptional) {
        movementConsumption[key].exceptional += ev.consumptionDeltaBaseUnits; // negative
      } else {
        movementConsumption[key].ordinary += ev.consumptionDeltaBaseUnits; // negative
      }
    }
  });

  // Load all daily summaries
  const summariesSnap = await getDocs(query(collection(db, 'branchConsumptionDaily'), where('tenantId', '==', args.tenant)));
  const summaryConsumption: Record<string, { ordinary: number; exceptional: number }> = {};

  summariesSnap.forEach(d => {
    const s = d.data() as BranchConsumptionDaily;
    if (args.branch && s.branchId !== args.branch) return;
    if (args.product && s.productId !== args.product) return;
    if (args.from && s.dateKey < args.from) return;
    if (args.to && s.dateKey > args.to) return;

    const key = `${s.branchId}_${s.productId}_${s.dateKey}`;
    summaryConsumption[key] = {
      ordinary: s.validConsumptionUnits || 0,
      exceptional: s.exceptionalUnits || 0
    };
  });

  // Reconcile and report row-by-row
  const reportRows: ReconciliationRow[] = [];
  const dateKeysList = new Set<string>();
  
  // Gather all unique dateKeys present in the datasets
  Object.keys(rawSourceConsumption).forEach(k => dateKeysList.add(k.split('_')[2]));
  Object.keys(movementConsumption).forEach(k => dateKeysList.add(k.split('_')[2]));
  Object.keys(summaryConsumption).forEach(k => dateKeysList.add(k.split('_')[2]));

  let totalMatched = 0;
  let totalMismatch = 0;

  for (const bpKey of branchProductKeys) {
    const [branchId, productId] = bpKey.split('_');
    
    for (const dKey of dateKeysList) {
      const key = `${branchId}_${productId}_${dKey}`;
      
      const raw = rawSourceConsumption[key] || { ordinary: 0, exceptional: 0 };
      const rawTotal = Math.max(0, raw.ordinary + raw.exceptional);
      
      const ev = movementConsumption[key] || { ordinary: 0, exceptional: 0 };
      const evTotal = Math.max(0, ev.ordinary + ev.exceptional);
      
      const sum = summaryConsumption[key] || { ordinary: 0, exceptional: 0 };
      const sumTotal = Math.max(0, sum.ordinary + sum.exceptional);

      if (rawTotal === 0 && evTotal === 0 && sumTotal === 0) continue;

      const difference = rawTotal - sumTotal;
      const isMatch = rawTotal === evTotal && evTotal === sumTotal;

      const row: ReconciliationRow = {
        tenantId: args.tenant,
        branchId,
        productId,
        dateRange: dKey,
        rawSourceUnits: rawTotal,
        movementEventUnits: evTotal,
        summaryUnits: sumTotal,
        difference,
        status: isMatch ? 'MATCHED' : 'MISMATCH'
      };

      if (!isMatch) {
        totalMismatch++;
        metrics.reconciliationMismatchCount++;
        row.exceptionReason = `Discrepancy of ${difference} units. Raw: ${rawTotal}, Event: ${evTotal}, Summary: ${sumTotal}`;
      } else {
        totalMatched++;
      }

      reportRows.push(row);
    }
  }

  // Print summary to terminal
  console.log(`Reconciliation check completed:`);
  console.log(`MATCHED keys: ${totalMatched}`);
  console.log(`MISMATCHED keys: ${totalMismatch}`);

  if (totalMismatch > 0) {
    console.warn(`WARNING: Detected ${totalMismatch} reconciliation mismatches!`);
  } else {
    console.log('SUCCESS: All processed entries match perfectly.');
  }

  // Write report file
  try {
    const dir = path.dirname(args.output);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(args.output, JSON.stringify(reportRows, null, 2), 'utf8');
    console.log(`Reconciliation report written to: ${args.output}`);
  } catch (e) {
    console.error('Failed to write reconciliation report:', e);
  }
}

run().then(() => {
  console.log('Backfill process complete. Exiting.');
  process.exit(0);
}).catch(err => {
  console.error('Backfill script error:', err);
  process.exit(1);
});
