export type PosCheckoutV2ErrorCode =
  | 'AUTHORIZATION_DENIED'
  | 'TENANT_MISMATCH'
  | 'BRANCH_NOT_AUTHORIZED'
  | 'INVALID_PRODUCT'
  | 'INVALID_TIER'
  | 'PACKAGING_CHANGED'
  | 'PRICE_CHANGED'
  | 'NO_SELLABLE_BATCH'
  | 'INSUFFICIENT_STOCK'
  | 'COST_FLOOR_VIOLATION'
  | 'PAYMENT_MISMATCH'
  | 'STOCK_AGGREGATE_MISMATCH'
  | 'IDEMPOTENCY_CONFLICT'
  | 'CONFIGURATION_ERROR'
  | 'TRANSACTION_CONFLICT'
  | 'DATABASE_UNAVAILABLE';

export class PosCheckoutV2Error extends Error {
  readonly code: PosCheckoutV2ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: PosCheckoutV2ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PosCheckoutV2Error';
    this.code = code;
    this.details = details;
  }
}

const messageIncludes = (message: string, fragment: string) =>
  message.toLowerCase().includes(fragment.toLowerCase());

export function mapCheckoutCalculationError(error: unknown): PosCheckoutV2Error {
  if (error instanceof PosCheckoutV2Error) return error;

  const message = error instanceof Error ? error.message : String(error || 'Unknown POS checkout error.');

  if (messageIncludes(message, 'tenant mismatch')) {
    return new PosCheckoutV2Error('TENANT_MISMATCH', message);
  }
  if (messageIncludes(message, 'different branch') || messageIncludes(message, 'branch mismatch')) {
    return new PosCheckoutV2Error('BRANCH_NOT_AUTHORIZED', message);
  }
  if (messageIncludes(message, 'no longer exists') || messageIncludes(message, 'invalid product')) {
    return new PosCheckoutV2Error('INVALID_PRODUCT', message);
  }
  if (messageIncludes(message, 'packaging changed') || messageIncludes(message, 'stored base quantity')) {
    return new PosCheckoutV2Error('PACKAGING_CHANGED', message);
  }
  if (messageIncludes(message, 'configured price changed')) {
    return new PosCheckoutV2Error('PRICE_CHANGED', message);
  }
  if (messageIncludes(message, 'tier is no longer enabled') || messageIncludes(message, 'multi-tier configuration changed')) {
    return new PosCheckoutV2Error('INVALID_TIER', message);
  }
  if (messageIncludes(message, 'insufficient unexpired fefo stock')) {
    return new PosCheckoutV2Error('INSUFFICIENT_STOCK', message);
  }
  if (messageIncludes(message, 'below the actual allocated batch cost')) {
    return new PosCheckoutV2Error('COST_FLOOR_VIOLATION', message);
  }

  return new PosCheckoutV2Error('TRANSACTION_CONFLICT', message);
}
