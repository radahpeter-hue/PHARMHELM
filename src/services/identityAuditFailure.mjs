/** Deliberately omit server messages, record paths, credentials and personal data. */
export function identityAuditFailure(error, collection) {
  const code = Number(error?.code);
  return {
    mode: 'READ_ONLY', status: 'AUDIT_INCOMPLETE', collection,
    code: Number.isInteger(code) ? code : null,
    category: code === 8 ? 'RESOURCE_EXHAUSTED' : code === 7 ? 'PERMISSION_DENIED'
      : code === 16 ? 'UNAUTHENTICATED' : code === 14 ? 'UNAVAILABLE' : 'UNCLASSIFIED',
    quotaMentioned: /quota/i.test(String(error?.details || error?.message || '')),
    identityDataAssessed: false
  };
}
