import {
  collection, deleteField, doc, getDocFromServer, getDocsFromServer, query, runTransaction, where,
  type DocumentReference, type Firestore, type Transaction
} from 'firebase/firestore';
import { db } from '../firebase';
import type { StockOrder, StockOrderLine } from '../types';

import { manualStockOrderWrites } from './manualStockOrderPolicy';

type OrderData = Record<string, any>;
type LineWrite = { id: string; data?: OrderData };
type PendingSave = {
  id: string;
  header: OrderData;
  writes: LineWrite[];
  next: number;
};

const changedDraft = 'This draft changed while it was open. Select it again from Draft Orders.';
const interruptedSave = 'This order has an unfinished save. Reopen it from Draft Orders to recover the full order and make changes.';

function writeLines(transaction: Transaction, connection: Firestore, writes: LineWrite[]) {
  for (const { id, data } of writes) {
    const ref = doc(connection, 'stock_order_lines', id);
    if (data) transaction.set(ref, data, { merge: true });
    else transaction.delete(ref);
  }
}

function sliceSize(order: OrderData) {
  // Reserve rule evaluation capacity for the order header and role/branch checks.
  return order.inventoryClass === 'OPERATIONAL' ? 2 : 4;
}

function sameSave(previous: PendingSave, next: PendingSave) {
  const intent = (header: OrderData) => {
    const { submitted_at, updatedAt, ...data } = header;
    return data;
  };
  // Firestore can reorder map keys on read.
  const normalize = (value: any): any => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
    }
    return value;
  };
  return JSON.stringify(normalize([intent(previous.header), previous.writes]))
    === JSON.stringify(normalize([intent(next.header), next.writes]));
}

async function finishSave(
  connection: Firestore,
  orderRef: DocumentReference,
  save: PendingSave
) {
  for (;;) {
    const finished = await runTransaction(connection, async transaction => {
      const snapshot = await transaction.get(orderRef);
      const current = snapshot.data();
      if (!current) throw new Error(changedDraft);
      const pending = current.manualOrderSave as PendingSave | undefined;
      if (!pending && current.manualOrderRevision === save.id
          && current.status === save.header.status) return true;
      if (current.status !== 'draft' || pending?.id !== save.id) throw new Error(changedDraft);
      if (pending.next < pending.writes.length) {
        const writes = pending.writes.slice(pending.next, pending.next + sliceSize(pending.header));
        writeLines(transaction, connection, writes);
        transaction.update(orderRef, { 'manualOrderSave.next': pending.next + writes.length });
        return false;
      }

      transaction.update(orderRef, {
        ...pending.header, manualOrderSave: deleteField(), manualOrderRevision: pending.id
      });
      return true;
    });
    if (finished) return;
  }
}

function fetchOrderLines(connection: Firestore, orderId: string, tenantId: string) {
  return getDocsFromServer(query(
    collection(connection, 'stock_order_lines'), where('tenantId', '==', tenantId),
    where('order_id', '==', orderId)
  ));
}

export async function loadManualStockOrderDraft(orderId: string, connection: Firestore = db) {
  const snapshot = await getDocFromServer(doc(connection, 'stock_orders', orderId));
  const order = snapshot.data();
  if (order?.status !== 'draft') throw new Error(changedDraft);
  const pending = order.manualOrderSave as PendingSave | undefined;
  const draft = { ...order, ...pending?.header, id: orderId, status: 'draft' } as StockOrder;
  const lines = pending
    ? pending.writes.flatMap(({id, data}) => data ? [{ ...data, id } as StockOrderLine] : [])
    : (await fetchOrderLines(connection, orderId, draft.tenantId)).docs.map(line => (
        { ...line.data(), id: line.id } as StockOrderLine
      ));
  return { draft, lines, pending: Boolean(pending), revision: (pending?.id ?? order.manualOrderRevision ?? null) as string | null };
}

async function persistManualOrder(
  orderId: string,
  order: OrderData,
  lines: OrderData[],
  isNew: boolean,
  connection: Firestore,
  expectedRevision?: string | null
) {
  const requested = manualStockOrderWrites(orderId, order, lines);
  const orderRef = doc(connection, 'stock_orders', orderId);
  const initial = (await getDocFromServer(orderRef)).data();
  if ((!initial && !isNew) || (initial && initial.tenantId !== order.tenantId)
      || (initial && isNew && (initial.order_number !== order.order_number
        || initial.requesting_branch_id !== order.requesting_branch_id))) throw new Error(changedDraft);
  if (initial && initial.status !== 'draft') {
    if (isNew && initial.manualOrderRevision && initial.status === order.status) return;
    throw new Error(changedDraft);
  }

  const pending = initial?.manualOrderSave as PendingSave | undefined;
  const revision = pending?.id ?? initial?.manualOrderRevision ?? null;
  if (expectedRevision !== undefined && revision !== expectedRevision) throw new Error(changedDraft);

  const id = doc(collection(connection, 'stock_orders')).id;
  if (pending) {
    const plannedIds = new Map(pending.writes.flatMap(({ id, data }) => data ? [[data.product_id, id]] : []));
    const writes: LineWrite[] = requested.map(line => ({
      ...line, id: plannedIds.get(line.data.product_id) || line.id
    }));
    writes.push(...pending.writes.filter(write => !write.data));
    const retry = { id, header: { ...pending.header, ...order }, writes, next: 0 };
    if (sameSave(pending, retry)) {
      await finishSave(connection, orderRef, pending);
      return;
    }
    if (isNew) throw new Error(interruptedSave);
  }

  const previous = new Map<string, string>();
  if (initial) {
    const snapshot = await fetchOrderLines(connection, orderId, order.tenantId);
    for (const line of snapshot.docs) {
      const productId = line.data().product_id;
      if (previous.has(productId)) throw new Error('This draft has duplicate products. Review its lines before saving.');
      previous.set(productId, line.id);
    }
  }

  const retained = new Set(requested.map(line => line.data.product_id));
  const writes: LineWrite[] = requested.map(line => ({ ...line, id: previous.get(line.data.product_id) || line.id }));
  for (const [productId, lineId] of previous) if (!retained.has(productId)) writes.push({ id: lineId });
  const save: PendingSave = { id, header: order, writes, next: 0 };
  const staged = Boolean(pending) || writes.length > sliceSize(order);
  // Bound the recoverable manifest well below the Firestore document size limit.
  // Account separately for Firestore's per-map and per-entry overhead.
  if (staged && new TextEncoder().encode(JSON.stringify(save)).length > 600_000) {
    throw new Error('This order contains too much line data to save as one requisition.');
  }

  await runTransaction(connection, async transaction => {
    const current = (await transaction.get(orderRef)).data();
    const currentSave = current?.manualOrderSave as PendingSave | undefined;
    if (Boolean(current) !== Boolean(initial)
        || (current && (current.status !== 'draft'
          || current.manualOrderRevision !== initial?.manualOrderRevision
          || currentSave?.id !== pending?.id
          || currentSave?.next !== pending?.next))) throw new Error(changedDraft);
    if (!staged) {
      const header = { ...order, manualOrderRevision: id };
      if (current) transaction.update(orderRef, { ...header, manualOrderSave: deleteField() });
      else transaction.set(orderRef, header);
      writeLines(transaction, connection, writes);
      return;
    }
    if (current) transaction.update(orderRef, { manualOrderSave: save });
    else {
      const { submitted_at, ...draft } = order;
      transaction.set(orderRef, { ...draft, status: 'draft', manualOrderSave: save });
    }
  });

  if (staged) await finishSave(connection, orderRef, save);
}

export async function persistNewManualStockOrder(orderId: string, order: OrderData, lines: OrderData[], connection: Firestore = db) {
  await persistManualOrder(orderId, order, lines, true, connection);
}

export async function persistManualStockOrderDraft(orderId: string, order: OrderData, lines: OrderData[], revision: string | null, connection: Firestore = db) {
  await persistManualOrder(orderId, order, lines, false, connection, revision);
}
