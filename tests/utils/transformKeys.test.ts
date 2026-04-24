import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toCamelCase, toSnakeCase, keysToCamelCase, keysToSnakeCase } from '../../src/utils/transformKeys';

describe('toCamelCase', () => {
  it('chuyển snake_case cơ bản', () => {
    expect(toCamelCase('user_name')).toBe('userName');
    expect(toCamelCase('first_name')).toBe('firstName');
    expect(toCamelCase('created_at')).toBe('createdAt');
  });

  it('giữ nguyên camelCase đã có', () => {
    expect(toCamelCase('userName')).toBe('userName');
    expect(toCamelCase('firstName')).toBe('firstName');
  });

  it('xử lý đúng SCREAMING_SNAKE_CASE', () => {
    expect(toCamelCase('USER_NAME')).toBe('userName');
    expect(toCamelCase('USER_ID')).toBe('userId');
    expect(toCamelCase('CREATED_AT')).toBe('createdAt');
    expect(toCamelCase('MAX_RETRY_COUNT')).toBe('maxRetryCount');
  });

  it('giữ nguyên single word', () => {
    expect(toCamelCase('name')).toBe('name');
    expect(toCamelCase('id')).toBe('id');
  });
});

describe('toSnakeCase', () => {
  it('chuyển camelCase cơ bản', () => {
    expect(toSnakeCase('userName')).toBe('user_name');
    expect(toSnakeCase('firstName')).toBe('first_name');
    expect(toSnakeCase('createdAt')).toBe('created_at');
  });

  it('xử lý đúng acronyms liên tiếp', () => {
    expect(toSnakeCase('XMLParser')).toBe('xml_parser');
    expect(toSnakeCase('parseXMLDocument')).toBe('parse_xml_document');
  });

  it('xử lý đúng trailing acronym', () => {
    expect(toSnakeCase('userID')).toBe('user_id');
    expect(toSnakeCase('getUserID')).toBe('get_user_id');
  });

  it('giữ nguyên single word lowercase', () => {
    expect(toSnakeCase('name')).toBe('name');
  });
});

describe('keysToCamelCase', () => {
  it('transform flat object', () => {
    const result = keysToCamelCase({ first_name: 'John', last_name: 'Doe' });
    expect(result).toEqual({ firstName: 'John', lastName: 'Doe' });
  });

  it('transform nested object đệ quy', () => {
    const result = keysToCamelCase({
      user_info: {
        first_name: 'John',
        address_data: { zip_code: '12345' },
      },
    });
    expect(result).toEqual({
      userInfo: {
        firstName: 'John',
        addressData: { zipCode: '12345' },
      },
    });
  });

  it('transform array của objects', () => {
    const result = keysToCamelCase([
      { first_name: 'Alice' },
      { first_name: 'Bob' },
    ]);
    expect(result).toEqual([{ firstName: 'Alice' }, { firstName: 'Bob' }]);
  });

  it('giữ nguyên primitive values', () => {
    expect(keysToCamelCase('hello')).toBe('hello');
    expect(keysToCamelCase(42)).toBe(42);
    expect(keysToCamelCase(null)).toBeNull();
  });

  it('xử lý SCREAMING_SNAKE_CASE keys', () => {
    const result = keysToCamelCase({ USER_ID: 1, USER_NAME: 'Alice' });
    expect(result).toEqual({ userId: 1, userName: 'Alice' });
  });
});

describe('keysToSnakeCase', () => {
  it('transform flat object', () => {
    const result = keysToSnakeCase({ firstName: 'John', lastName: 'Doe' });
    expect(result).toEqual({ first_name: 'John', last_name: 'Doe' });
  });

  it('transform nested object đệ quy', () => {
    const result = keysToSnakeCase({
      userInfo: { firstName: 'John', addressData: { zipCode: '12345' } },
    });
    expect(result).toEqual({
      user_info: { first_name: 'John', address_data: { zip_code: '12345' } },
    });
  });
});
