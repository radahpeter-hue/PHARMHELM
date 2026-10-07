/** Compare receipt data without treating Firestore map key order as a change.
 * Array order, field values and nested allocation identities remain significant. */
function orderedReceiptValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedReceiptValue);
  if (value && typeof value === 'object') {
    const toJSON = (value as { toJSON?: () => unknown }).toJSON;
    if (typeof toJSON === 'function') return orderedReceiptValue(toJSON.call(value));
    return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, orderedReceiptValue(entry)]));
  }
  return value;
}

export function receiptItemsMatch(left: unknown, right: unknown): boolean {
  return JSON.stringify(orderedReceiptValue(left)) === JSON.stringify(orderedReceiptValue(right));
}
