import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src=readFileSync(new URL('../src/pages/StockInOut.tsx',import.meta.url),'utf8');
const start=src.indexOf('  const handleReceiveSubmit = async () => {');
const end=src.indexOf('\nreturn (',start);
const handler=src.slice(start,end);

test('Sellable reception increments existing batch and product stock atomically',()=>{
  assert.match(src,/writeBatch, increment \} from 'firebase\/firestore'/);
  assert.match(handler,/quantity: increment\(totalUnitsAccepted\)/);
  assert.match(handler,/quantityInStock: increment\(totalUnitsAccepted\)/);
  assert.doesNotMatch(handler,/quantity: \(existingBatch\.quantity \|\| 0\) \+ totalUnitsAccepted/);
  assert.doesNotMatch(handler,/quantityInStock: \(product\.quantityInStock \|\| 0\) \+ totalUnitsAccepted/);
});

test('simultaneous first receptions use one stable product batch document',()=>{
  assert.match(handler,/const newBatchId = \['stockin', profile\.tenantId, activeBranchId, line\.product_id/);
  assert.match(handler,/line\.batch_number \|\| 'N\/A', line\.expiry_date \|\| ''/);
  assert.match(handler,/const newBatchRef = doc\(db, 'product_batches', newBatchId\)/);
  assert.match(handler,/batch\.set\(newBatchRef, \{[\s\S]*?quantity: increment\(totalUnitsAccepted\),[\s\S]*?\}, \{ merge: true \}\)/);
  assert.doesNotMatch(handler,/doc\(collection\(db, 'product_batches'\)\)/);
});

test('analytics errors after stock commit never release a receipt for duplicate posting',()=>{
  assert.match(handler,/let receptionCommitted = false/);
  assert.match(handler,/await batch\.commit\(\);\s*receptionCommitted = true;/);
  assert.match(handler,/if \(receptionClaimed && !receptionCommitted\)/);
});

test('each receipt is claimed under transaction before any stock write and remains class scoped',()=>{
  assert.match(handler,/await runTransaction\(db, async transaction =>/);
  assert.match(handler,/if \(status !== 'dispatched'\)/);
  assert.match(handler,/status: 'receiving'/);
  assert.match(handler,/invoiceLines\.some\(line => line\.inventoryClass === 'OPERATIONAL'\)/);
});

test('post-commit Sellable movement records flag stock as already applied',()=>{
  assert.match(handler,/batch\.set\(doc\(db, 'sellable_receipt_movement_outbox'/);
  assert.match(handler,/await replaySellableReceiptMovement\(/);
  const recovery = readFileSync(new URL('../src/services/sellableReceiptRecoveryService.ts',import.meta.url),'utf8');
  assert.match(recovery,/eventType: 'TRANSFER_IN'/);
  assert.match(recovery,/stockAlreadyApplied: true/);
  assert.match(recovery,/if \(intent.status === 'processed'\) return 'already_processed'/);
  assert.match(recovery,/where\('status', '==', 'pending'\)/);
});
