export type OpexClassifiableExpense = {
  source?: string;
  sourceType?: string;
  excludeFromOpexRollup?: boolean;
};

export const isExcludedFromOpex = (expense: OpexClassifiableExpense): boolean => {
  if (typeof expense.excludeFromOpexRollup === 'boolean') return expense.excludeFromOpexRollup;
  const source = (expense.source || '').trim().toLowerCase();
  const sourceType = (expense.sourceType || '').trim().toLowerCase();
  return source === 'cash_grn' || source === 'credit_payment' || sourceType === 'procurement' || sourceType === 'credit';
};
