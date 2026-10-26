import { collection, getDocs, query, where, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import { buildReceivablesRegister } from './creditRecognition';
export function creditReadScope(profile: Record<string, any>): string[] | null {
  const roles = [profile.role, ...(profile.secondaryRoles || [])].map(r => String(r).toLowerCase());
  if (roles.some(r => ['owner', 'ceo', 'ceo / md'].includes(r))) return null;
  return [...new Set([...(profile.assigned_branches || []), profile.branch_id, profile.default_branch_id].filter(Boolean))] as string[];
}
export async function loadCreditRegister(tenantId: string, branchIds: string[] | null, connection: Firestore = db) {
  if (!tenantId || branchIds?.length === 0) return [];
  const read = async (name: string, branchField?: string) => {
    const snapshots = await Promise.all((branchField && branchIds ? branchIds : [null]).map(branch =>
      getDocs(query(collection(connection, name), where('tenantId', '==', tenantId),
        ...(branch ? [where(branchField!, '==', branch)] : [])))));
    return snapshots.flatMap(s => s.docs.map(d => ({ ...d.data(), id: d.id })));
  };
  const [records, sales, clients, institutions, branches] = await Promise.all([
    read('credit_receivables', 'branch_id'), read('sales', 'branchId'), read('clients'), read('institutions'), read('branches')
  ]);
  return buildReceivablesRegister(records, sales, clients, institutions, branches);
}
