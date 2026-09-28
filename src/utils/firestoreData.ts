function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function omitUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter(entry => entry !== undefined)
      .map(entry => omitUndefinedDeep(entry)) as T;
  }

  if (!isPlainObject(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    result[key] = omitUndefinedDeep(entry);
  }
  return result as T;
}
