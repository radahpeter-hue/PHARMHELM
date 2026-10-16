/**
 * Pure validation for GRN-generated Management Petty Cash settlements.
 * The payable was recognized at GRN. A payment is a balance movement,
 * NEVER a second inventory or Operational OPEX recognition.
 */
export interface CashGrnSettlementPlan {
  originalInvoiceUGX: number;
  previouslyPaidUGX: number;
  paymentUGX: number;
  remainingUGX: number;
  paymentStatus: 'Paid' | 'Partially Paid';
  legacyPaymentStatus: 'Paid' | 'Partial';
  cashMovementType: 'outgoing';
  additionalOpexUGX: 0;
}

export function planCashGrnSettlement(invoiceAmount: number, alreadyPaid: number, payment: number): CashGrnSettlementPlan {
  for (const [value,name] of [[invoiceAmount,'Invoice'],[alreadyPaid,'Previously paid'],[payment,'Payment']] as const) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} amount is invalid.`);
  }
  if (invoiceAmount === 0 || payment === 0) throw new Error('A positive invoice and payment amount are required.');
  if (alreadyPaid > invoiceAmount) throw new Error('Previously paid exceeds the invoice.');
  if (payment > invoiceAmount - alreadyPaid) throw new Error('Payment exceeds the outstanding invoice balance.');
  const remainingUGX = invoiceAmount - alreadyPaid - payment;
  return {
    originalInvoiceUGX: invoiceAmount, previouslyPaidUGX: alreadyPaid,
    paymentUGX: payment, remainingUGX,
    paymentStatus: remainingUGX === 0 ? 'Paid' : 'Partially Paid',
    legacyPaymentStatus: remainingUGX === 0 ? 'Paid' : 'Partial',
    cashMovementType: 'outgoing', additionalOpexUGX: 0
  };
}
