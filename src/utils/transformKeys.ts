/**
 * Transform keys between camelCase and snake_case recursively.
 */

/**
 * Supports standard snake_case plus SCREAMING_SNAKE_CASE from APIs.
 */
export function toCamelCase(str: string): string {
  const isScreaming = /^[A-Z][A-Z0-9_]*$/.test(str) && str.includes('_');
  const normalized = isScreaming ? str.toLowerCase() : str;
  return normalized.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
}

/**
 * Preserves acronyms as a single word: userID → user_id, XMLParser → xml_parser.
 */
export function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function transformKeysDeep(
  obj: unknown,
  transformer: (key: string) => string
): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => transformKeysDeep(item, transformer));
  }
  if (isPlainObject(obj)) {
    const result: PlainObject = {};
    for (const [key, value] of Object.entries(obj)) {
      result[transformer(key)] = transformKeysDeep(value, transformer);
    }
    return result;
  }
  if (obj instanceof Date) return obj;
  if (obj instanceof RegExp) return obj;
  if (obj instanceof Map) {
    return new Map([...obj].map(([k, v]) => [k, transformKeysDeep(v, transformer)]));
  }
  if (obj instanceof Set) {
    return new Set([...obj].map((v) => transformKeysDeep(v, transformer)));
  }
  return obj;
}

export function keysToCamelCase<T = unknown>(obj: unknown): T {
  return transformKeysDeep(obj, toCamelCase) as T;
}

export function keysToSnakeCase<T = unknown>(obj: unknown): T {
  return transformKeysDeep(obj, toSnakeCase) as T;
}
