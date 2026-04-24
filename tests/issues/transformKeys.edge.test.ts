/**
 * Issue #3: toCamelCase — SCREAMING_SNAKE_CASE detection edge cases
 *
 * Regex: /^[A-Z][A-Z0-9_]*$/.test(str) && str.includes('_')
 *
 * Edge cases:
 * - Single-word all-caps (e.g. "ID", "STATUS"): không có '_' → không phải SCREAMING
 *   → regex replace không match → trả nguyên "ID", "STATUS" (không lowercase)
 * - Keys như "A" (1 ký tự hoa): regex match ^[A-Z] + [A-Z0-9_]* (rỗng) → PASS
 *   nhưng không có '_' → không phải SCREAMING
 */

import { describe, it, expect } from 'vitest';
import { toCamelCase, toSnakeCase, keysToCamelCase, keysToSnakeCase } from '../../src/utils/transformKeys';

describe('transformKeys — edge cases', () => {
  // ── toCamelCase ────────────────────────────────────────────────────────────

  describe('toCamelCase', () => {
    // Standard cases
    it('snake_case → camelCase (standard)', () => {
      expect(toCamelCase('user_name')).toBe('userName');
      expect(toCamelCase('first_name')).toBe('firstName');
      expect(toCamelCase('zip_code')).toBe('zipCode');
    });

    // SCREAMING_SNAKE_CASE
    it('SCREAMING_SNAKE_CASE → camelCase', () => {
      expect(toCamelCase('USER_NAME')).toBe('userName');
      expect(toCamelCase('USER_ID')).toBe('userId');
      expect(toCamelCase('FIRST_NAME')).toBe('firstName');
    });

    // Edge case: single-word all-caps (không có '_')
    it('[EDGE CASE] single-word all-caps không transform (vì không có _)', () => {
      // "ID" không có '_' → isScreaming = false → không lowercase
      // → regex replace /_([a-z])/g không match → trả nguyên "ID"
      expect(toCamelCase('ID')).toBe('ID'); // không lowercase!
      expect(toCamelCase('STATUS')).toBe('STATUS');
      expect(toCamelCase('OK')).toBe('OK');
    });

    // Single char
    it('single char uppercase không transform', () => {
      expect(toCamelCase('A')).toBe('A');
    });

    // Already camelCase
    it('camelCase không thay đổi', () => {
      expect(toCamelCase('userName')).toBe('userName');
      expect(toCamelCase('userId')).toBe('userId');
    });

    // Mixed with numbers
    it('kế sau số được xử lý đúng (số sau _ cũng camelCase)', () => {
      // Sau fix: regex /_([a-z0-9])/g → xử lý cả chữ thường và số sau _
      expect(toCamelCase('page_1_count')).toBe('page1Count');  // ✅ fix
      expect(toCamelCase('error_404_message')).toBe('error404Message'); // ✅ fix
    });

    // Numbers in SCREAMING
    it('SCREAMING với số giữa — được xử lý đúng sau fix', () => {
      // HTTP_200_OK → lowercase: http_200_ok → /_([a-z0-9])/g → match '_2', '_o'
      // → 'http200Ok' ✅
      expect(toCamelCase('HTTP_200_OK')).toBe('http200Ok'); // ✅ fix
      // API_V2_URL → api_v2_url → /_([a-z0-9])/g → match _v, _2, _u
      expect(toCamelCase('API_V2_URL')).toBe('apiV2Url'); // ✅
    });

    // Empty string
    it('empty string không throw', () => {
      expect(toCamelCase('')).toBe('');
    });

    // No transformation needed
    it('lowercase không thay đổi', () => {
      expect(toCamelCase('name')).toBe('name');
    });
  });

  // ── toSnakeCase ────────────────────────────────────────────────────────────

  describe('toSnakeCase', () => {
    it('camelCase → snake_case (standard)', () => {
      expect(toSnakeCase('userName')).toBe('user_name');
      expect(toSnakeCase('firstName')).toBe('first_name');
    });

    it('acronym handling — userID → user_id', () => {
      expect(toSnakeCase('userID')).toBe('user_id');
      expect(toSnakeCase('XMLParser')).toBe('xml_parser');
      expect(toSnakeCase('getHTTPResponse')).toBe('get_http_response');
    });

    it('single word lowercase không thay đổi', () => {
      expect(toSnakeCase('name')).toBe('name');
      expect(toSnakeCase('id')).toBe('id');
    });

    it('single char', () => {
      expect(toSnakeCase('A')).toBe('a');
    });

    it('already snake_case không thay đổi nhiều', () => {
      // toSnakeCase('user_name') → không có uppercase → trả 'user_name'
      expect(toSnakeCase('user_name')).toBe('user_name');
    });

    it('number trong key', () => {
      expect(toSnakeCase('page1Count')).toBe('page1_count');
    });

    it('empty string không throw', () => {
      expect(toSnakeCase('')).toBe('');
    });
  });

  // ── Round-trip: camelCase → snake_case → camelCase ─────────────────────────

  describe('round-trip transformation', () => {
    const testCases = [
      { camel: 'userName', snake: 'user_name' },
      { camel: 'firstName', snake: 'first_name' },
      { camel: 'zipCode', snake: 'zip_code' },
      { camel: 'pageCount', snake: 'page_count' },
    ];

    for (const { camel, snake } of testCases) {
      it(`round-trip: ${camel} ↔ ${snake}`, () => {
        expect(toSnakeCase(camel)).toBe(snake);
        expect(toCamelCase(snake)).toBe(camel);
      });
    }
  });

  // ── keysToCamelCase với nested objects ─────────────────────────────────────

  describe('keysToCamelCase — deep transformation', () => {
    it('transform nested object keys', () => {
      const input = {
        user_name: 'alice',
        address_data: {
          zip_code: '12345',
          street_name: 'Main St',
        },
      };
      expect(keysToCamelCase(input)).toEqual({
        userName: 'alice',
        addressData: {
          zipCode: '12345',
          streetName: 'Main St',
        },
      });
    });

    it('transform array of objects', () => {
      const input = [
        { user_id: 1, user_name: 'alice' },
        { user_id: 2, user_name: 'bob' },
      ];
      expect(keysToCamelCase(input)).toEqual([
        { userId: 1, userName: 'alice' },
        { userId: 2, userName: 'bob' },
      ]);
    });

    it('null và primitive values không bị transform', () => {
      expect(keysToCamelCase(null)).toBe(null);
      expect(keysToCamelCase(42)).toBe(42);
      expect(keysToCamelCase('string')).toBe('string');
      expect(keysToCamelCase(true)).toBe(true);
    });

    it('empty object trả về empty object', () => {
      expect(keysToCamelCase({})).toEqual({});
    });

    it('empty array trả về empty array', () => {
      expect(keysToCamelCase([])).toEqual([]);
    });

    it('SCREAMING_SNAKE keys trong object', () => {
      const input = { USER_NAME: 'alice', USER_ID: 1 };
      expect(keysToCamelCase(input)).toEqual({ userName: 'alice', userId: 1 });
    });
  });

  // ── keysToSnakeCase với nested objects ──────────────────────────────────────

  describe('keysToSnakeCase — deep transformation', () => {
    it('transform nested object keys', () => {
      const input = {
        userName: 'alice',
        addressData: {
          zipCode: '12345',
          streetName: 'Main St',
        },
      };
      expect(keysToSnakeCase(input)).toEqual({
        user_name: 'alice',
        address_data: {
          zip_code: '12345',
          street_name: 'Main St',
        },
      });
    });

    it('mixed depth array of objects', () => {
      const input = {
        userList: [
          { firstName: 'Alice', userId: 1 },
          { firstName: 'Bob', userId: 2 },
        ],
      };
      expect(keysToSnakeCase(input)).toEqual({
        user_list: [
          { first_name: 'Alice', user_id: 1 },
          { first_name: 'Bob', user_id: 2 },
        ],
      });
    });

    it('array of primitives không bị ảnh hưởng', () => {
      expect(keysToSnakeCase([1, 2, 3])).toEqual([1, 2, 3]);
      expect(keysToSnakeCase(['a', 'b'])).toEqual(['a', 'b']);
    });

    it('undefined và null values được giữ nguyên', () => {
      const input = { userName: null, userAge: undefined };
      expect(keysToSnakeCase(input)).toEqual({ user_name: null, user_age: undefined });
    });
  });

  // ── isPlainObject detection ────────────────────────────────────────────────

  describe('isPlainObject detection — non-plain objects không bị transform keys', () => {
    it('Date object được preserve — isPlainObject dùng prototype check', () => {
      const date = new Date('2024-01-01');
      // isPlainObject giờ đây kiểm tra prototype chain:
      // Date.prototype !== Object.prototype → isPlainObject(date) = false
      // → transformKeysDeep trả nguyên giá trị
      const result = keysToCamelCase({ created_at: date });
      // Key được transform đúng
      expect((result as any).createdAt).toBeDefined();
      // Value được preserve nguyên vẹn (Date object gốc)
      expect((result as any).createdAt).toBe(date); // ✅ fix
      expect((result as any).createdAt).toBeInstanceOf(Date);
    });

    it('Array không bị xử lý như plain object keys', () => {
      // Array được iterate với map(), không phải Object.entries()
      const result = keysToSnakeCase([{ userAge: 25 }]);
      expect(result).toEqual([{ user_age: 25 }]);
    });
  });
});
