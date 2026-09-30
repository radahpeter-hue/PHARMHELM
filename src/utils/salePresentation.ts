import type { Sale } from '../types';

export const getReceiptLedgerReference = (sale: Sale): string => {
  const receiptNumber = String(sale.receiptNumber || '').trim();
  if (receiptNumber) return receiptNumber;
  const suffix = String(sale.id || '').slice(-8).toUpperCase();
  return suffix ? `REF-${suffix}` : 'Reference unavailable';
};

export const getSaleIdentityLabel = (sale: Sale): string => {
  const institutionName = String(sale.institutionName || '').trim();
  if (institutionName) return institutionName;

  const patientName = String(sale.patientName || '').trim();
  if (patientName) return patientName;

  return sale.context === 'walk-in' ? 'Anonymous' : 'Identity not recorded';
};

export const matchesReceiptLedgerSearch = (sale: Sale, searchTerm: string): boolean => {
  const query = searchTerm.trim().toLowerCase();
  if (!query) return true;

  return [sale.receiptNumber, sale.patientName, sale.institutionName]
    .some(value => String(value || '').toLowerCase().includes(query));
};
