/** Manual-entry policy only; never filters or rewrites historical records. */
export function canUseBranchExpenseCategory(category: string, originalCategory?: string): boolean {
  const normalized = category.trim().toLowerCase();
  if (!['salary', 'salaries'].includes(normalized)) return true;
  return !!originalCategory && normalized === originalCategory.trim().toLowerCase();
}
