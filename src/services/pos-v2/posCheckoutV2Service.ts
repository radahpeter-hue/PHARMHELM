import { auth } from '../../firebase';
import { PosCheckoutV2Error, mapCheckoutCalculationError } from './posCheckoutV2Errors';
import { commitCheckoutV2, prepareCheckoutV2Repository, recoverCompletedCheckoutV2 } from './posCheckoutV2Repository';
import type { CheckoutV2Request, PosCheckoutV2CompletedResult } from './posCheckoutV2Types';

function validateCheckoutV2Request(request: CheckoutV2Request) {
  if (!request || typeof request !== 'object') throw new PosCheckoutV2Error('INVALID_PRODUCT', 'Checkout request is required.');
  if (!String(request.attemptId || '').trim()) throw new PosCheckoutV2Error('IDEMPOTENCY_CONFLICT', 'A checkout attempt ID is required.');
  if (!String(request.branchId || '').trim()) throw new PosCheckoutV2Error('BRANCH_NOT_AUTHORIZED', 'An active branch is required.');
  if (!Array.isArray(request.items) || request.items.length === 0) throw new PosCheckoutV2Error('INVALID_PRODUCT', 'Checkout requires at least one sale line.');
  for (const [index, item] of request.items.entries()) {
    if (!item || !String(item.productId || '').trim()) throw new PosCheckoutV2Error('INVALID_PRODUCT', `Sale line ${index + 1} has no product or service identifier.`);
    const quantity = Number(item.commercialQuantity ?? item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
      throw new PosCheckoutV2Error('INVALID_PRODUCT', `Sale line ${index + 1} must have a positive whole commercial quantity.`);
    }
  }
}

function mapRepositoryError(error: unknown): PosCheckoutV2Error {
  if (error instanceof PosCheckoutV2Error) return error;
  const code = String((error as any)?.code || '').toLowerCase();
  const message = error instanceof Error ? error.message : String(error || 'Unknown POS V2 checkout error.');

  if (code.includes('permission-denied') || /missing or insufficient permissions/i.test(message)) {
    return new PosCheckoutV2Error('AUTHORIZATION_DENIED', 'The authoritative Firestore rules rejected the checkout transaction.', { diagnostic: message });
  }
  if (code.includes('unavailable') || code.includes('deadline-exceeded')) {
    return new PosCheckoutV2Error('DATABASE_UNAVAILABLE', 'The database is temporarily unavailable. The checkout can be retried with the same attempt ID.', { diagnostic: message });
  }
  if (code.includes('aborted') || code.includes('failed-precondition')) {
    return new PosCheckoutV2Error('TRANSACTION_CONFLICT', 'Inventory changed while the sale was being committed. Retry the same checkout attempt.', { diagnostic: message });
  }
  return mapCheckoutCalculationError(error);
}

/**
 * POS Transaction Engine V2 orchestration entrypoint.
 *
 * This function intentionally performs no printing, React state manipulation,
 * consumption posting, welfare posting, quotation conversion, loyalty work or
 * navigation. Batch 3 extends the repository transaction with payment/outbox
 * writes without changing this service boundary.
 */
export async function executeCheckoutV2(request: CheckoutV2Request): Promise<PosCheckoutV2CompletedResult> {
  try {
    validateCheckoutV2Request(request);
    const user = auth.currentUser;
    if (!user?.uid) throw new PosCheckoutV2Error('AUTHORIZATION_DENIED', 'An authenticated Firebase user is required.');

    const prepared = await prepareCheckoutV2Repository(user.uid, request);
    return await commitCheckoutV2(request, prepared);
  } catch (error) {
    throw mapRepositoryError(error);
  }
}

export async function recoverCheckoutV2Attempt(params: {
  tenantId: string;
  branchId: string;
  attemptId: string;
}): Promise<PosCheckoutV2CompletedResult | null> {
  try {
    const user = auth.currentUser;
    if (!user?.uid) throw new PosCheckoutV2Error('AUTHORIZATION_DENIED', 'An authenticated Firebase user is required.');
    return await recoverCompletedCheckoutV2({ uid: user.uid, ...params });
  } catch (error) {
    throw mapRepositoryError(error);
  }
}
