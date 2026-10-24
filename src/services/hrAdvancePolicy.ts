/**
 * HR advance requests are non-posting documents. Approval never implies cash payment.
 * All UGX values are whole-number safe integers.
 */
export function validateAdvanceRequest(amount: number, repaymentMonths: number): string | null {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return 'Advance amount must be a positive whole-number UGX value.';
  }
  if (!Number.isSafeInteger(repaymentMonths) || repaymentMonths < 1 || repaymentMonths > 120) {
    return 'Repayment period must be between 1 and 120 whole months.';
  }
  return null;
}

export function sumApprovedUnpaidAdvanceRequests(
  requests: ReadonlyArray<{ status: string; amount_requested: number }>
): number {
  return requests.reduce((total, request) => {
    if (request.status !== 'Approved') return total;
    if (!Number.isSafeInteger(request.amount_requested) || request.amount_requested <= 0) {
      throw new Error('Invalid approved advance amount');
    }
    const next = total + request.amount_requested;
    if (!Number.isSafeInteger(next)) throw new Error('Unsafe approved advance total');
    return next;
  }, 0);
}
