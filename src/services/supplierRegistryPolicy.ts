import {SYSTEM_ROLES} from '../config/rbac';
export const SUPPLIER_CAPABILITIES = ['DRUGS', 'COSMETICS', 'CONSUMABLES', 'DEVICES', 'NON_SELLABLE_OPERATIONAL'] as const;
export function supplierSystemRoleAccess(roleName:string, module:'clients'|'procurement'): boolean | undefined {
  const aliases:Record<string,string> = {'ceo / md':'ceo','procurement personnel':'procurement officer','it support personnel':'it support staff'};
  const role = roleName.trim().toLowerCase();
  const definition = SYSTEM_ROLES.find(item=>item.name.toLowerCase()===(aliases[role] || role));
  return definition ? ['operate','all'].includes(definition.permissions[module].access) : undefined;
}
export function supplierEligibleForStream(supplier: {is_suspended?: boolean; inventoryCapabilities?: readonly string[]}, inventoryClass: 'SELLABLE' | 'OPERATIONAL'): boolean {
  if (supplier.is_suspended) return false;
  const capabilities = supplier.inventoryCapabilities || [];
  return inventoryClass === 'OPERATIONAL' ? capabilities.includes('NON_SELLABLE_OPERATIONAL')
    : capabilities.length === 0 || capabilities.some(value => value !== 'NON_SELLABLE_OPERATIONAL');
}
export function generatedSupplierCode(documentId: string): string {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(documentId)) throw new Error('Invalid supplier identity.');
  return `SUP-${documentId}`;
}
export function supplierRegistryFields(data: Record<string, any>) {
  const supplier_name = String(data.supplier_name || '').trim();
  if (!supplier_name) throw new Error('Enter a supplier name.');
  const capabilities = data.inventoryCapabilities || [];
  if (!Array.isArray(capabilities) || capabilities.some(value => !SUPPLIER_CAPABILITIES.includes(value))) throw new Error('Invalid supply capabilities.');
  return {
    supplier_name,
    commercial_category: String(data.commercial_category || 'Wholesale'),
    nda_wholesale_licence_number: String(data.nda_wholesale_licence_number || ''),
    nda_licence_expiry_date: String(data.nda_licence_expiry_date || ''),
    nda_licence_status: String(data.nda_licence_status || 'valid'),
    payment_terms: String(data.payment_terms || ''), tin: String(data.tin || ''),
    address: String(data.address || ''),
    is_suspended: Boolean(data.is_suspended), whtExempt: Boolean(data.whtExempt),
    inventoryCapabilities: [...new Set(capabilities)].sort()
  };
}
