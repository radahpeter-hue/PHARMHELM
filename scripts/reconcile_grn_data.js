// scripts/reconcile_grn_data.js
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
async function runReconciliation() {
  console.log('Starting GRN Reconciliation Scan...\n');
  const grnRecords = await db.collection('grn_records').get();
  const pettyCash = await db.collection('petty_cash_ledger').get();
  const grnMap = new Map();
  grnRecords.forEach(doc => grnMap.set(doc.data().grn_number, doc.data()));
  const pettyCashMap = new Map();
  pettyCash.forEach(doc => pettyCashMap.set(doc.data().reference_number, doc.data()));
  const issues = { missingPettyCash: [], duplicateGRNs: [] };
  const orderGRNCount = {};
  grnRecords.forEach(doc => {
      const orderId = doc.data().order_id;
      if (!orderGRNCount[orderId]) orderGRNCount[orderId] = [];
      orderGRNCount[orderId].push(doc.data().grn_number);
      
      if (doc.data().payment_type === 'cash') {
          const pcEntry = pettyCashMap.get(doc.data().invoice_number) || pettyCashMap.get(doc.data().grn_number);
          if (!pcEntry) issues.missingPettyCash.push({ grnNumber: doc.data().grn_number, invoiceNumber: doc.data().invoice_number, amount: doc.data().total_value_ugx });
      }
  });
  for (const [orderId, grns] of Object.entries(orderGRNCount)) {
      if (grns.length > 1) issues.duplicateGRNs.push({ orderId, grns });
  }
  console.log('=== RECONCILIATION REPORT ===\n');
  console.log(`Duplicate GRNs for Single Order: ${issues.duplicateGRNs.length}`);
  issues.duplicateGRNs.forEach(i => console.log(`  - Order ${i.orderId}: ${i.grns.join(', ')}`));
  console.log(`\nCash GRNs Missing Petty Cash Deduction: ${issues.missingPettyCash.length}`);
  issues.missingPettyCash.forEach(i => console.log(`  - GRN ${i.grnNumber} / Inv ${i.invoiceNumber} (UGX ${i.amount})`));
}
runReconciliation().catch(console.error);
