export const POS_CANONICAL_PAYMENT_METHODS = [
  { id: 'cash', label: 'Cash' },
  { id: 'mtn_momo', label: 'MTN MoMo' },
  { id: 'airtel_money', label: 'Airtel Money' },
  { id: 'card', label: 'Card / POS' },
  { id: 'insurance', label: 'Insurance' },
  { id: 'institutional_credit', label: 'Institutional Credit' },
  { id: 'staff_welfare', label: 'Staff Welfare' }
] as const;

export type PosCanonicalPaymentMethod = typeof POS_CANONICAL_PAYMENT_METHODS[number]['id'];

const PAYMENT_ALIASES: Record<string, PosCanonicalPaymentMethod> = {
  cash: 'cash',
  momo: 'mtn_momo',
  mtn_momo: 'mtn_momo',
  'mtn momo': 'mtn_momo',
  airtel: 'airtel_money',
  airtel_money: 'airtel_money',
  'airtel money': 'airtel_money',
  card: 'card',
  pos: 'card',
  'card / pos': 'card',
  insurance: 'insurance',
  credit: 'institutional_credit',
  institutional_credit: 'institutional_credit',
  'institutional credit': 'institutional_credit',
  staff_welfare: 'staff_welfare',
  'staff welfare': 'staff_welfare'
};

function paymentKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[-]+/g, '_').replace(/\s+/g, ' ');
}

export function normalizePosPaymentMethod(value: unknown): PosCanonicalPaymentMethod | null {
  return PAYMENT_ALIASES[paymentKey(value)] || null;
}

export function assertPosPaymentMethod(value: unknown): PosCanonicalPaymentMethod {
  const normalized = normalizePosPaymentMethod(value);
  if (!normalized) throw new Error(`Unsupported POS payment method: ${String(value ?? '').trim() || '(empty)'}.`);
  return normalized;
}

export function posPaymentMethodLabel(value: unknown): string {
  const normalized = normalizePosPaymentMethod(value);
  return POS_CANONICAL_PAYMENT_METHODS.find(option => option.id === normalized)?.label
    || String(value ?? '').trim()
    || 'None';
}
