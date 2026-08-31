type StaffLike = {
  id?: string;
  uid?: string;
  authEmail?: string;
  email?: string;
  contactEmail?: string;
  loginHandle?: string;
  username?: string;
  employee_id?: string;
  full_name?: string;
  phone_number?: string;
  assigned_branches?: string[];
  secondaryRoles?: string[];
  [key: string]: any;
};

const normalize = (value?: string) => (value || '').trim().toLowerCase();

const identityKeys = (item: StaffLike) => {
  const keys = [
    item.uid && `uid:${normalize(item.uid)}`,
    item.authEmail && `email:${normalize(item.authEmail)}`,
    item.email && `email:${normalize(item.email)}`,
    item.contactEmail && `email:${normalize(item.contactEmail)}`,
    item.loginHandle && `handle:${normalize(item.loginHandle)}`,
    item.username && `handle:${normalize(item.username)}`,
    item.employee_id && `employee:${normalize(item.employee_id)}`,
  ].filter(Boolean) as string[];

  if (keys.length === 0 && item.full_name && item.phone_number) {
    keys.push(`person:${normalize(item.full_name)}:${normalize(item.phone_number)}`);
  }
  return keys;
};

const mergeRecords = <T extends StaffLike>(left: T, right: T): T => {
  const leftCanonical = Boolean(left.uid && left.id === left.uid);
  const rightCanonical = Boolean(right.uid && right.id === right.uid);
  const primary = rightCanonical && !leftCanonical ? right : left;
  const secondary = primary === left ? right : left;

  return {
    ...secondary,
    ...primary,
    assigned_branches: Array.from(new Set([
      ...(secondary.assigned_branches || []),
      ...(primary.assigned_branches || []),
    ])),
    secondaryRoles: Array.from(new Set([
      ...(secondary.secondaryRoles || []),
      ...(primary.secondaryRoles || []),
    ])),
  } as T;
};

/**
 * Produces one operational record per identity without deleting source data.
 * UID-keyed records win, while branch and secondary-role assignments are merged.
 */
export function deduplicateStaff<T extends StaffLike>(items: T[]): T[] {
  const records: T[] = [];
  const keyToIndex = new Map<string, number>();

  items.forEach(item => {
    const keys = identityKeys(item);
    const existingIndex = keys
      .map(key => keyToIndex.get(key))
      .find((index): index is number => index !== undefined);

    if (existingIndex === undefined) {
      const index = records.push(item) - 1;
      keys.forEach(key => keyToIndex.set(key, index));
      return;
    }

    records[existingIndex] = mergeRecords(records[existingIndex], item);
    identityKeys(records[existingIndex]).forEach(key => keyToIndex.set(key, existingIndex));
  });

  return records;
}
