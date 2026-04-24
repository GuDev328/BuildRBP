/**
 * Advanced transformKeys tests:
 *  - Edge cases: numbers, booleans, null, undefined values
 *  - Date objects không bị convert
 *  - Array of primitives (không transform)
 *  - Array of objects (deep transform)
 *  - Mixed deeply nested structure
 *  - SCREAMING_SNAKE_CASE → camelCase
 *  - Numbers in keys (user_1_data → user1Data)
 *  - Single word keys (username → username)
 *  - keysToSnakeCase edge cases
 *  - Round-trip: camelCase → snake_case → camelCase
 */

import { describe, it, expect } from 'vitest';
import {
  toCamelCase,
  toSnakeCase,
  keysToCamelCase,
  keysToSnakeCase,
} from '../../src/utils/transformKeys';

describe('transformKeys — advanced', () => {
  // ── toCamelCase edge cases ─────────────────────────────────────────────────

  describe('toCamelCase edge cases', () => {
    it('chuỗi rỗng → rỗng', () => {
      expect(toCamelCase('')).toBe('');
    });

    it('single word lowercase → không đổi', () => {
      expect(toCamelCase('name')).toBe('name');
    });

    it('single word uppercase → giữ nguyên (chỉ lowercase khi có dấu _ theo sau)', () => {
      // toCamelCase chỉ lowercase khi isScreaming: chuỗi hoa + có _
      // 'NAME' không có _ → không phải SCREAMING_SNAKE → giữ nguyên
      expect(toCamelCase('NAME')).toBe('NAME');
    });

    it('nhiều dấu underscore liên tiếp — chỉ collapse theo regex _([a-z])', () => {
      // regex /_([a-z])/g: 'first__name' → 'first_' + match '_n' → 'first_Name'
      // double underscore KHÔNG được collapse thành single
      expect(toCamelCase('first__name')).toBe('first_Name');
      // 'a___b': match '_b' → 'a__B'
      expect(toCamelCase('a___b')).toBe('a__B');
    });

    it('dấu underscore ở đầu → chữ cái đầu bị uppercase', () => {
      // '_private': match '_p' → 'Private' (chữ P hoa)
      expect(toCamelCase('_private')).toBe('Private');
    });

    it('dấu underscore ở cuối → giữ nguyên (không match gì)', () => {
      // 'field_': trailing _ không có chữ cái theo sau → không match regex → giữ nguyên
      expect(toCamelCase('field_')).toBe('field_');
    });

    it('numbers trong key — underscore trước số cũng được xử lý (sau fix regex)', () => {
      // regex /_([a-z0-9])/g: match cả chữ thường và số sau _
      // 'user_1': _ trước số 1 → '1'.toUpperCase() = '1' → 'user1'
      expect(toCamelCase('user_1')).toBe('user1');
      // 'address_line_2': '_l' match → 'addressLine'; '_2' match → '2' → 'addressLine2'
      expect(toCamelCase('address_line_2')).toBe('addressLine2');
    });

    it('mixed case snake → camelCase chính xác', () => {
      expect(toCamelCase('created_at')).toBe('createdAt');
      expect(toCamelCase('updated_at')).toBe('updatedAt');
      expect(toCamelCase('deleted_at')).toBe('deletedAt');
    });

    it('SCREAMING_SNAKE_CASE nhiều words', () => {
      expect(toCamelCase('USER_FIRST_NAME')).toBe('userFirstName');
      expect(toCamelCase('IS_AUTHENTICATED')).toBe('isAuthenticated');
      expect(toCamelCase('MAX_RETRY_COUNT')).toBe('maxRetryCount');
    });
  });

  // ── toSnakeCase edge cases ─────────────────────────────────────────────────

  describe('toSnakeCase edge cases', () => {
    it('chuỗi rỗng → rỗng', () => {
      expect(toSnakeCase('')).toBe('');
    });

    it('single word lowercase → không đổi', () => {
      expect(toSnakeCase('name')).toBe('name');
    });

    it('single word CamelCase', () => {
      expect(toSnakeCase('Name')).toBe('name');
    });

    it('camelCase phức tạp', () => {
      expect(toSnakeCase('createdAt')).toBe('created_at');
      expect(toSnakeCase('updatedAt')).toBe('updated_at');
      expect(toSnakeCase('isAuthenticated')).toBe('is_authenticated');
    });

    it('có số trong key', () => {
      expect(toSnakeCase('user1Name')).toBe('user1_name');
      expect(toSnakeCase('address2Line')).toBe('address2_line');
    });

    it('đã là snake_case → không thay đổi', () => {
      expect(toSnakeCase('snake_case')).toBe('snake_case');
      expect(toSnakeCase('already_snake')).toBe('already_snake');
    });

    it('PascalCase → snake_case', () => {
      expect(toSnakeCase('UserFirstName')).toBe('user_first_name');
      expect(toSnakeCase('ApiResponse')).toBe('api_response');
    });
  });

  // ── keysToCamelCase — value passthrough ────────────────────────────────────

  describe('keysToCamelCase — value types passthrough', () => {
    it('number values không bị thay đổi', () => {
      const result = keysToCamelCase({ user_age: 25, item_count: 0 });
      expect(result).toEqual({ userAge: 25, itemCount: 0 });
    });

    it('boolean values không bị thay đổi', () => {
      const result = keysToCamelCase({ is_active: true, has_error: false });
      expect(result).toEqual({ isActive: true, hasError: false });
    });

    it('null values không bị thay đổi', () => {
      const result = keysToCamelCase({ deleted_at: null, parent_id: null });
      expect(result).toEqual({ deletedAt: null, parentId: null });
    });

    it('undefined values không bị thay đổi', () => {
      const result = keysToCamelCase({ optional_field: undefined });
      expect(result).toEqual({ optionalField: undefined });
    });

    it('Date objects được preserve — isPlainObject dùng prototype check (sau fix)', () => {
      // isPlainObject giờ kiểm tra prototype chain:
      // Date.prototype !== Object.prototype → isPlainObject(date) = false
      // → transformKeysDeep trả nguyên Date object
      const date = new Date('2024-01-01');
      const result = keysToCamelCase({ created_at: date });
      expect((result as any).createdAt).toBe(date); // Date object được preserve ✅
      expect((result as any).createdAt).toBeInstanceOf(Date);
    });

    it('string values không bị transform', () => {
      // Values là string không phải key → không bị toCamelCase
      const result = keysToCamelCase({ user_name: 'john_doe' });
      expect(result).toEqual({ userName: 'john_doe' }); // value không bị đổi
    });
  });

  // ── keysToCamelCase — deeply nested ───────────────────────────────────────

  describe('keysToCamelCase — deep nesting', () => {
    it('3 levels deep', () => {
      const input = {
        level_one: {
          level_two: {
            level_three: {
              deep_value: 'found',
            },
          },
        },
      };
      const result = keysToCamelCase(input);
      expect(result).toEqual({
        levelOne: {
          levelTwo: {
            levelThree: {
              deepValue: 'found',
            },
          },
        },
      });
    });

    it('array of objects — transform mỗi element', () => {
      const input = [
        { user_id: 1, first_name: 'Alice' },
        { user_id: 2, first_name: 'Bob' },
      ];
      const result = keysToCamelCase(input);
      expect(result).toEqual([
        { userId: 1, firstName: 'Alice' },
        { userId: 2, firstName: 'Bob' },
      ]);
    });

    it('array of primitives — không transform', () => {
      const input = { tags: ['snake_case', 'camelCase', 42] };
      const result = keysToCamelCase(input);
      expect((result as any).tags).toEqual(['snake_case', 'camelCase', 42]);
    });

    it('nested array of objects trong object', () => {
      const input = {
        user_list: [
          { user_id: 1, email_address: 'a@b.com' },
          { user_id: 2, email_address: 'c@d.com' },
        ],
      };
      const result = keysToCamelCase(input);
      expect(result).toEqual({
        userList: [
          { userId: 1, emailAddress: 'a@b.com' },
          { userId: 2, emailAddress: 'c@d.com' },
        ],
      });
    });

    it('empty object → empty object', () => {
      expect(keysToCamelCase({})).toEqual({});
    });

    it('empty array → empty array', () => {
      expect(keysToCamelCase([])).toEqual([]);
    });

    it('null → null (passthrough)', () => {
      expect(keysToCamelCase(null as any)).toBeNull();
    });

    it('primitive → primitive (passthrough)', () => {
      expect(keysToCamelCase(42 as any)).toBe(42);
      expect(keysToCamelCase('hello' as any)).toBe('hello');
      expect(keysToCamelCase(true as any)).toBe(true);
    });
  });

  // ── keysToSnakeCase edge cases ─────────────────────────────────────────────

  describe('keysToSnakeCase edge cases', () => {
    it('transform flat object camelCase → snake_case', () => {
      const result = keysToSnakeCase({ firstName: 'John', lastName: 'Doe' });
      expect(result).toEqual({ first_name: 'John', last_name: 'Doe' });
    });

    it('nested object transform', () => {
      const result = keysToSnakeCase({
        userProfile: { displayName: 'Alice', emailAddress: 'a@b.com' },
      });
      expect(result).toEqual({
        user_profile: { display_name: 'Alice', email_address: 'a@b.com' },
      });
    });

    it('array of objects', () => {
      const result = keysToSnakeCase([
        { userId: 1, isActive: true },
        { userId: 2, isActive: false },
      ]);
      expect(result).toEqual([
        { user_id: 1, is_active: true },
        { user_id: 2, is_active: false },
      ]);
    });

    it('null/undefined passthrough', () => {
      expect(keysToSnakeCase(null as any)).toBeNull();
      expect(keysToSnakeCase(undefined as any)).toBeUndefined();
    });

    it('empty object', () => {
      expect(keysToSnakeCase({})).toEqual({});
    });

    it('number value passthrough', () => {
      const result = keysToSnakeCase({ totalCount: 100, pageSize: 10 });
      expect(result).toEqual({ total_count: 100, page_size: 10 });
    });
  });

  // ── Round-trip consistency ─────────────────────────────────────────────────

  describe('round-trip consistency', () => {
    it('camelCase → snakeCase → camelCase = original', () => {
      const original = {
        firstName: 'John',
        lastName: 'Doe',
        emailAddress: 'john@example.com',
        isActive: true,
        totalCount: 42,
        createdAt: '2024-01-01',
      };

      const snaked = keysToSnakeCase(original);
      const restored = keysToCamelCase(snaked);

      expect(restored).toEqual(original);
    });

    it('snakeCase → camelCase → snakeCase = original', () => {
      const original = {
        first_name: 'John',
        last_name: 'Doe',
        email_address: 'john@example.com',
        is_active: true,
      };

      const cameled = keysToCamelCase(original);
      const restored = keysToSnakeCase(cameled);

      expect(restored).toEqual(original);
    });

    it('nested structure round-trip', () => {
      const original = {
        user_info: {
          first_name: 'Alice',
          address_data: {
            zip_code: '12345',
            city_name: 'Hanoi',
          },
        },
        item_list: [
          { item_id: 1, item_name: 'Widget' },
          { item_id: 2, item_name: 'Gadget' },
        ],
      };

      const cameled = keysToCamelCase(original);
      const restored = keysToSnakeCase(cameled);

      expect(restored).toEqual(original);
    });
  });
});
