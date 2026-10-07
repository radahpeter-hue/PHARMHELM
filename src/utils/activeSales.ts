/** Superseded receipts remain audit evidence and must not contribute revenue twice. */
export function isActiveSale(sale: { supersededBySaleId?: string; revisionLifecycle?: string; status?: string; isRevisionReplacement?: boolean; revisionOfSaleId?: string }): boolean {
  const replacedOriginal = sale.revisionLifecycle === 'COMPLETED' && !sale.isRevisionReplacement && !sale.revisionOfSaleId;
  return !sale.supersededBySaleId && !replacedOriginal && sale.status !== 'voided' && sale.status !== 'returned';
}
