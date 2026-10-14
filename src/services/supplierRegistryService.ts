import { doc, getDoc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import { generatedSupplierCode, supplierRegistryFields, supplierSystemRoleAccess } from './supplierRegistryPolicy';

export async function saveSupplierRegistry(input: {id: string; tenantId: string; actorId: string; isNew: boolean; sourceModule:'clients'|'procurement'; roles:string[]; data: Record<string, any>}, connection: Firestore = db) {
  if (!input.tenantId || !input.actorId) throw new Error('Sign in to save a supplier.');
  const fields = supplierRegistryFields(input.data);
  let accessRole:string | undefined;
  for (const role of input.roles) {
    const systemAccess = supplierSystemRoleAccess(role,input.sourceModule);
    if (systemAccess) {accessRole=role;break;}
    if (systemAccess === false) continue;
    const realmSnapshot = await getDoc(doc(connection,'role_realms_of_operation',`${input.tenantId}_${role.replace(/\s+/g,'_').toLowerCase()}`));
    const realm = realmSnapshot.data();
    if (realm?.tenantId===input.tenantId && realm.roleType==='custom' && realm.roleName===role && ['view_functional','operate','all'].includes(realm.permissions?.[input.sourceModule]?.accessLevel)) {accessRole=role;break;}
  }
  if (!accessRole) throw new Error('Functional supplier access is required in this module.');
  const auditAccess={updatedAccessRole:accessRole,updatedModule:input.sourceModule};
  const ref = doc(connection, 'supplier_registry', input.id);
  return runTransaction(connection, async tx => {
    const snapshot = await tx.get(ref);
    if (snapshot.exists()) {
      const existing = snapshot.data();
      if (existing.tenantId !== input.tenantId) throw new Error('Supplier tenant mismatch.');
      if (input.isNew) {
        if (existing.createdBy !== input.actorId || Object.entries(fields).some(([key, value]) => JSON.stringify(existing[key]) !== JSON.stringify(value))) throw new Error('This supplier request was already saved. Refresh the register before editing it.');
        return {id:ref.id,supplierCode:existing.supplier_id};
      }
      const supplierCode = existing.supplier_id || generatedSupplierCode(ref.id);
      tx.update(ref, {...fields,...auditAccess,supplier_id:supplierCode,updatedBy:input.actorId,updatedAt:serverTimestamp()});
      return {id:ref.id,supplierCode};
    }
    if (!input.isNew) throw new Error('Supplier no longer exists. Refresh the register.');
    const supplierCode = generatedSupplierCode(ref.id);
    tx.set(ref,{...fields,...auditAccess,tenantId:input.tenantId,supplier_id:supplierCode,status:'active',createdBy:input.actorId,updatedBy:input.actorId,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    return {id:ref.id,supplierCode};
  });
}
