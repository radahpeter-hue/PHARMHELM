export interface OperationalIdentityFields {
  name: string;
  category?: string;
  type: 'fixed' | 'non-fixed';
  unitPerPack: number;
  unitOfIssue: string;
}

export function operationalIdentityFingerprint(data: OperationalIdentityFields): string {
  return [data.name, data.category, data.type, data.unitPerPack, data.unitOfIssue]
    .map(value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' '))
    .join('|');
}

function stableHash(value: string): string {
  let code = 2166136261;
  for (let index = 0; index < value.length; index++) {
    code ^= value.charCodeAt(index);
    code = Math.imul(code, 16777619);
  }
  return (code >>> 0).toString(36);
}

export function deterministicOperationalMasterId(tenantId: string, fingerprint: string): string {
  return `opmaster_${stableHash(`${tenantId}|${fingerprint}`)}_${stableHash(fingerprint.split('').reverse().join(''))}`;
}

/** A tenant-scoped transaction lock shared by every registration of one item identity. */
export function deterministicOperationalIdentityClaimId(tenantId: string, fingerprint: string): string {
  const bytes = new TextEncoder().encode(`${tenantId}|${fingerprint}`);
  return `opidentity_${btoa(String.fromCharCode(...bytes)).replace(/\//g, '_').replace(/\+/g, '-').replace(/=/g, '')}`;
}

export function deterministicOperationalLocationId(tenantId: string, masterItemId: string, branchId: string): string {
  return `oploc_${stableHash(`${tenantId}|${masterItemId}|${branchId}`)}_${stableHash(`${branchId}|${masterItemId}|${tenantId}`)}`;
}
