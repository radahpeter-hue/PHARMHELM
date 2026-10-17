/** Stage 2 Martin Pharma Operational dispatch reconciliation. READ ONLY.
 * This script never writes to Firestore and never prints staff, patient,
 * supplier or underlying document IDs. It is run only with CI audit identity.
 */
import { writeFileSync } from 'node:fs';
const projectId = 'gen-lang-client-0911422817';
const databaseId = 'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75';
const tenantId = 'zehqTDcKyrDAOHKK3stJ';
const orderNumber = 'ORD-2026-15022';

const output = process.argv[2] || '/tmp/pharmhelm-stage2-operational-audit.json';
const report = {
  mode: 'READ_ONLY',
  scope: 'Martin Pharma Stage 2 Operational Dispatch',
  orderNumber,
  found: false,
  orderStatus: null,
  orderClass: null,
  transfers: [],
  issues: []
};
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Stage 2 live reconciliation must not use the emulator.');
const { initializeApp, applicationDefault, deleteApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = initializeApp({ credential: applicationDefault(), projectId }, 'stage2-operations-readonly');
try {
  const db = getFirestore(app, databaseId);
  // Single-field queries avoid deployment of new production indexes.
  const orders = await db.collection('stock_orders').where('order_number', '==', orderNumber).get();
  const matching = orders.docs.filter(x => x.get('tenantId') === tenantId);
  if (matching.length !== 1) {
    report.issues.push(matching.length === 0 ? 'ORDER_NOT_FOUND' : 'DUPLICATE_ORDER_REFERENCE');
  } else {
    const order = matching[0];
    report.found = true;
    report.orderStatus = order.get('status') || null;
    report.orderClass = order.get('inventoryClass') || order.get('category') || null;
    const transfers = await db.collection('operational_transfers').where('sourceOrderId', '==', order.id).get();
    const associated = transfers.docs.filter(x => x.get('tenantId') === tenantId);
    if (!associated.length) report.issues.push('NO_OPERATIONAL_TRANSFER_STAGED');
    for (const transfer of associated) {
      const data = transfer.data();
      const lineQuery = await db.collection('operational_transfer_lines').where('transferId', '==', transfer.id).get();
      const lines = lineQuery.docs.filter(x => x.get('tenantId') === tenantId);
      let prepared = 0, dispatched = 0, received = 0, queried = 0, validMovement = 0, invalidMovement = 0, missingMovement = 0;
      for (const line of lines) {
        const row = line.data();
        if (row.status === 'prepared') prepared++;
        if (row.status === 'dispatched') dispatched++;
        if (row.status === 'received') received++;
        if (row.status === 'queried') queried++;
        if (!row.dispatchMovementId) {
          if (row.status !== 'prepared') missingMovement++;
          continue;
        }
        const movement = await db.collection('operational_inventory_movements').doc(row.dispatchMovementId).get();
        if (!movement.exists) {
          if (row.status !== 'prepared') missingMovement++;
          continue;
        }
        const m = movement.data();
        if (m.tenantId === tenantId && m.sourceLineId === line.id &&
          m.movementType === 'TRANSFER_OUT' && Number(m.quantityDelta) === -Number(row.quantityDispatched)) validMovement++;
        else invalidMovement++;
      }
      const expected = Number(data.expectedLineCount || 0);
      const issues = [];
      if (expected < 1 || lines.length !== expected) issues.push('INCOMPLETE_OR_EXTRA_LINES');
      if (invalidMovement) issues.push('INVALID_DISPATCH_MOVEMENT');
      if (missingMovement) issues.push('MISSING_DISPATCH_MOVEMENT');
      if (associated.length > 1) issues.push('MULTIPLE_TRANSFERS_FOR_ORDER');
      report.transfers.push({
        fulfillmentSource: data.fulfillmentSource || null,
        status: data.status || null,
        expectedLines: expected,
        stagedLines: lines.length,
        prepared, dispatched, received, queried,
        validDispatchMovements: validMovement,
        invalidDispatchMovements: invalidMovement,
        missingDispatchMovements: missingMovement,
        issues,
        // Do not declare live transfer safely retryable from counts alone;
        // a fresh transactional recheck is still required before dispatch.
        requiresAuthorizedReview: true
      });
    }
  }
} finally {
  await deleteApp(app);
  writeFileSync(output, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
