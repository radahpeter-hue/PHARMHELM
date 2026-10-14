import { doc, writeBatch, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';

import { manualStockOrderWrites } from './manualStockOrderPolicy';

export async function persistNewManualStockOrder(orderId: string, order: Record<string, any>, lines: Record<string, any>[], connection: Firestore = db) {
  const writes = manualStockOrderWrites(orderId, order, lines);
  const batch = writeBatch(connection);
  batch.set(doc(connection, 'stock_orders', orderId), order);
  for (const line of writes) batch.set(doc(connection, 'stock_order_lines', line.id), line.data);
  // Header and every line either persist together or none persist.
  await batch.commit();
}

export async function persistManualStockOrderDraft(orderId: string, order: Record<string, any>, previousLines: Record<string, any>[], lines: Record<string, any>[], connection: Firestore = db) {
  const writes = manualStockOrderWrites(orderId, order, lines);
  const retained = new Set(lines.map(line => line.product_id));
  const batch = writeBatch(connection);
  batch.update(doc(connection, 'stock_orders', orderId), order);
  for (const old of previousLines) if (!retained.has(old.product_id)) batch.delete(doc(connection, 'stock_order_lines', old.id));
  for (const line of writes) {
    const previous = previousLines.find(old => old.product_id === line.data.product_id);
    batch.set(doc(connection, 'stock_order_lines', previous?.id || line.id), line.data, {merge:true});
  }
  await batch.commit();
}
