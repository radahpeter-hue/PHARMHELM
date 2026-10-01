function deterministicDocumentId(prefix: string, tenantId: string, attemptId: string): string {
  const raw = `${tenantId}__${attemptId}`;
  let checksum = 5381;
  for (let i = 0; i < raw.length; i += 1) checksum = ((checksum << 5) + checksum) ^ raw.charCodeAt(i);
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return `${prefix}_${safe}_${(checksum >>> 0).toString(16)}`;
}

export function checkoutV2AttemptDocumentId(tenantId: string, attemptId: string): string {
  return deterministicDocumentId('attempt', tenantId, attemptId);
}

export function checkoutV2SaleDocumentId(tenantId: string, attemptId: string): string {
  return deterministicDocumentId('v2sale', tenantId, attemptId);
}
