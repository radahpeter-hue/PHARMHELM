function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function childPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

export function normalizePosV2RevisionFirestoreValue<T>(value: T, path = 'request'): T {
  if (value === undefined) {
    throw new Error(`Unsafe Firestore value at ${path}: undefined is not allowed.`);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Unsafe Firestore value at ${path}: number must be finite.`);
    return value;
  }
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    throw new Error(`Unsafe Firestore value at ${path}: ${typeof value} is not supported.`);
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (entry === undefined) throw new Error(`Unsafe Firestore value at ${path}[${index}]: undefined array entries are not allowed.`);
      return normalizePosV2RevisionFirestoreValue(entry, `${path}[${index}]`);
    }) as T;
  }
  if (typeof value === 'object') {
    if (!isPlainObject(value)) return value;
    const normalized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) continue;
      normalized[key] = normalizePosV2RevisionFirestoreValue(entry, childPath(path, key));
    }
    return normalized as T;
  }
  throw new Error(`Unsafe Firestore value at ${path}.`);
}

export function assertPosV2RevisionFirestoreSafe(value: unknown, path = 'request'): void {
  if (value === undefined) throw new Error(`Unsafe Firestore value at ${path}: undefined is not allowed.`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Unsafe Firestore value at ${path}: number must be finite.`);
    return;
  }
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    throw new Error(`Unsafe Firestore value at ${path}: ${typeof value} is not supported.`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPosV2RevisionFirestoreSafe(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    if (!isPlainObject(value)) return;
    for (const [key, entry] of Object.entries(value)) {
      assertPosV2RevisionFirestoreSafe(entry, childPath(path, key));
    }
    return;
  }
  throw new Error(`Unsafe Firestore value at ${path}.`);
}
