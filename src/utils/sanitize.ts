/**
 * Input sanitization utility to prevent XSS and malicious characters.
 * Implements strict trimming and HTML entity encoding.
 */
export function sanitizeInput(input: string): string {
  if (!input || typeof input !== 'string') return input || '';
  return input
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Recursively sanitizes all string properties in an object or array.
 */
export function sanitizeObject<T>(obj: T): T {
  if (!obj) return obj;

  if (typeof obj === 'string') {
    return sanitizeInput(obj) as unknown as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item)) as unknown as T;
  }

  if (typeof obj === 'object') {
    const cleaned = { ...obj } as any;
    for (const key in cleaned) {
      if (Object.prototype.hasOwnProperty.call(cleaned, key)) {
        cleaned[key] = sanitizeObject(cleaned[key]);
      }
    }
    return cleaned;
  }

  return obj;
}
