/**
 * Transform keys between camelCase and snake_case
 * Hỗ trợ nested objects và arrays
 */

/** snake_case → camelCase
 *
 * Hỗ trợ cả SCREAMING_SNAKE_CASE từ server:
 *   user_name  → userName  (standard)
 *   USER_NAME  → userName  (screaming snake)
 *   USER_ID    → userId
 *
 * Lưu ý: số sau dấu _ cũng được xử lý đúng:
 *   page_1_count   → page1Count
 *   HTTP_200_OK    → http200Ok
 */
export function toCamelCase(str: string): string {
  // Detect SCREAMING_SNAKE_CASE: toàn chữ hoa + có dấu _
  const isScreaming = /^[A-Z][A-Z0-9_]*$/.test(str) && str.includes('_');
  const normalized = isScreaming ? str.toLowerCase() : str;
  // Match _ theo sau bởi chữ thường [a-z] HOẶC số [0-9] → loại bỏ _ và capitalize/giữ chữ
  return normalized.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
}

/** camelCase → snake_case
 *
 * Hỗ trợ cả acronyms:
 *   userID    → user_id    (không phải user_i_d)
 *   XMLParser → xml_parser (không phải x_m_l_parser)
 */
export function toSnakeCase(str: string): string {
  return str
    // "XMLParser" → "XML_Parser": đặt _ giữa chuỗi hoa liên tiếp và chữ thường theo sau
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    // "userID" → "user_ID": đặt _ giữa chữ thường và chữ hoa tiếp theo
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  // Kiểm tra prototype chain: chỉ accept plain objects (Object.create(null) hoặc {})
  // Loại bỏ Date, Map, Set, RegExp, v.v. — chúng có prototype riêng
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function transformKeysDeep(
  obj: unknown,
  transformer: (key: string) => string
): unknown {
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
  return obj;
}

/** Chuyển tất cả keys của object sang camelCase (đệ quy) */
export function keysToCamelCase<T = unknown>(obj: unknown): T {
  return transformKeysDeep(obj, toCamelCase) as T;
}

/** Chuyển tất cả keys của object sang snake_case (đệ quy) */
export function keysToSnakeCase<T = unknown>(obj: unknown): T {
  return transformKeysDeep(obj, toSnakeCase) as T;
}
