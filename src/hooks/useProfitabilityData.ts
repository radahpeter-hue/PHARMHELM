import { useEffect, useState } from 'react';
import { collection, doc, getDocFromServer, getDocsFromServer, query, where, type QueryConstraint } from 'firebase/firestore';
import { db } from '../firebase';
import { LOGISTICS_EXPENSE_COLLECTIONS } from '../domain/finance/cashOutflows';
import { profitabilityChargeCodes, profitabilityLossEvents, type ProfitabilityData, type ProfitabilityRecord } from '../domain/finance/profitability';

type Source = keyof ProfitabilityData;
const readSources: { source: Source; label: string; filters?: () => QueryConstraint[] }[] = [
  { source: 'sales', label: 'Sales' },
  { source: 'branch_expenses', label: 'Branch expenses' },
  { source: 'management_expenses', label: 'Management expenses' },
  { source: 'payroll', label: 'Payroll' },
  ...LOGISTICS_EXPENSE_COLLECTIONS.map(source => ({ source, label: 'Logistics expenses' })),
  { source: 'marketing_expenses', label: 'Marketing expenses' },
  { source: 'operational_inventory_maintenance', label: 'Operational maintenance' },
  { source: 'operational_finance_events', label: 'Operational consumables',
    filters: () => [where('eventKind', '==', 'OPERATIONAL_CONSUMABLE_OPEX')] },
  { source: 'inventoryMovementEvents', label: 'Inventory losses', filters: () => [where('eventType', 'in', profitabilityLossEvents)] },
  ...(['petty_cash_ledger', 'banking_records'] as const).flatMap(source => [
    { source, label: 'Supplier fees', filters: () => [where('supplierCharge', '==', true)] },
    { source, label: 'Financial charges', filters: () => [where('movementClass', 'in', profitabilityChargeCodes)] },
  ]),
  { source: 'finance_ledger', label: 'Other finance entries' },
];

async function readProfitabilityData(tenantId: string) {
  const data: ProfitabilityData = {};
  const unavailable = new Set<string>();
  // Legacy receipts and expenses mix timestamp types and field names. Keep the tenant filter and
  // narrow high-volume ledgers by accounting class so switching periods requires no new reads.
  const reads = await Promise.allSettled(readSources.map(async ({ source, filters }) => {
    const snapshot = await getDocsFromServer(query(collection(db, source), where('tenantId', '==', tenantId), ...(filters?.() ?? [])));
    return snapshot.docs.map(row => ({ ...row.data(), id: row.id } as ProfitabilityRecord));
  }));
  reads.forEach((result, index) => {
    const { source, label } = readSources[index];
    if (result.status === 'fulfilled') {
      data[source] = [...(data[source] ?? []), ...result.value];
    } else {
      unavailable.add(label);
      console.error(`Unable to load profitability source ${source}`, result.reason);
    }
  });

  const grnIds = new Set<string>();
  for (const row of data.operational_finance_events ?? []) {
    if (typeof row.sourceId === 'string' && row.sourceId && !row.sourceId.includes('/')) grnIds.add(row.sourceId);
  }
  for (const row of [...(data.petty_cash_ledger ?? []), ...(data.banking_records ?? [])]) {
    if ((row.supplierCharge === true || row.movementClass === 'supplier_payment_charge') &&
        typeof row.grnId === 'string' && row.grnId && !row.grnId.includes('/')) grnIds.add(row.grnId);
  }
  const grns = await Promise.allSettled([...grnIds].map(async id => {
    const row = await getDocFromServer(doc(db, 'grn_records', id));
    return row.exists() && row.data().tenantId === tenantId ? { ...row.data(), id: row.id } as ProfitabilityRecord : null;
  }));
  data.grn_records = grns.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
  return { data, unavailable: [...unavailable] };
}

export function useProfitabilityData(tenantId: string | undefined) {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ tenantId: string; version: number; data: ProfitabilityData; unavailable: string[] }>();
  useEffect(() => {
    if (!tenantId) return;
    let current = true;
    void readProfitabilityData(tenantId).then(data => {
      if (current) setResult({ tenantId, version, ...data });
    }).catch(error => {
      console.error('Unable to load profitability data', error);
      if (current) setResult({ tenantId, version, data: {}, unavailable: ['Profitability data'] });
    });
    return () => { current = false; };
  }, [tenantId, version]);

  const current = result?.tenantId === tenantId && result?.version === version ? result : undefined;
  return { result: current, refresh: () => setVersion(value => value + 1) };
}
