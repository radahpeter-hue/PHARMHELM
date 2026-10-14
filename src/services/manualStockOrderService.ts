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
