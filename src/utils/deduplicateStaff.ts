// Utility to deduplicate staff or client entries based on full_name and phone_number
/**
 * Deduplicate an array of items that have `full_name` and `phone_number` fields.
 * Uses the `${full_name}-${phone_number}` key for uniqueness.
 * @param items Array of items to deduplicate.
 * @returns Deduplicated array preserving the first occurrence of each key.
 */
export function deduplicateStaff<T extends { full_name: string; phone_number: string }>(
  items: T[]
): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.full_name}-${item.phone_number}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
