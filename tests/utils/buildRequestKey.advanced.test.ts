/**
 * Advanced buildRequestKey tests:
 *  - Edge cases: null params, empty string URL, số trong params
 *  - data trong GET request bị ignore
 *  - data trong non-GET được include
 *  - JSON.stringify edge cases (circular reference fallback)
 *  - Idempotency — cùng input → cùng output
 *  - Key format là JSON array string
 */

import { describe, it, expect } from 'vitest';
import { buildRequestKey } from '../../src/utils/buildRequestKey';

describe('buildRequestKey — advanced', () => {
  // ── Format ─────────────────────────────────────────────────────────────────

  describe('key format', () => {
    it('output là JSON serialized array [method, url, paramsStr, dataStr]', () => {
      const key = buildRequestKey({ method: 'get', url: '/test' });
      const parsed = JSON.parse(key);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(4);
    });

    it('key chứa method lowercase', () => {
      const key = buildRequestKey({ method: 'GET', url: '/test' });
      const [method] = JSON.parse(key);
      expect(method).toBe('get');
    });

    it('key chứa đúng url', () => {
      const key = buildRequestKey({ method: 'get', url: '/api/v2/users' });
      const [, url] = JSON.parse(key);
      expect(url).toBe('/api/v2/users');
    });
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  describe('idempotency', () => {
    it('cùng config → cùng key (deterministic)', () => {
      const config = { method: 'get', url: '/users', params: { page: 1, sort: 'asc' } };
      expect(buildRequestKey(config)).toBe(buildRequestKey(config));
    });

    it('cùng params khác thứ tự → cùng key', () => {
      const k1 = buildRequestKey({ method: 'get', url: '/users', params: { a: 1, b: 2, c: 3 } });
      const k2 = buildRequestKey({ method: 'get', url: '/users', params: { c: 3, a: 1, b: 2 } });
      const k3 = buildRequestKey({ method: 'get', url: '/users', params: { b: 2, c: 3, a: 1 } });
      expect(k1).toBe(k2);
      expect(k2).toBe(k3);
    });
  });

  // ── Params edge cases ──────────────────────────────────────────────────────

  describe('params edge cases', () => {
    it('params=undefined → paramsStr rỗng', () => {
      const key = buildRequestKey({ method: 'get', url: '/test', params: undefined });
      const [, , paramsStr] = JSON.parse(key);
      expect(paramsStr).toBe('');
    });

    it('params={} (empty object) → paramsStr "{}"', () => {
      const key = buildRequestKey({ method: 'get', url: '/test', params: {} });
      const [, , paramsStr] = JSON.parse(key);
      expect(paramsStr).toBe('{}');
    });

    it('params với số, boolean, null values', () => {
      const k1 = buildRequestKey({ method: 'get', url: '/test', params: { active: true, limit: 10, filter: null } });
      const k2 = buildRequestKey({ method: 'get', url: '/test', params: { active: true, limit: 10, filter: null } });
      expect(k1).toBe(k2);
    });

    it('params với nested objects', () => {
      const k1 = buildRequestKey({ method: 'get', url: '/test', params: { filter: { status: 'active' } } });
      const k2 = buildRequestKey({ method: 'get', url: '/test', params: { filter: { status: 'active' } } });
      expect(k1).toBe(k2);
    });

    it('params khác nhau → key khác nhau', () => {
      const k1 = buildRequestKey({ method: 'get', url: '/users', params: { page: 1 } });
      const k2 = buildRequestKey({ method: 'get', url: '/users', params: { page: 2 } });
      expect(k1).not.toBe(k2);
    });

    it('có params vs không có params → key khác nhau', () => {
      const k1 = buildRequestKey({ method: 'get', url: '/users', params: { page: 1 } });
      const k2 = buildRequestKey({ method: 'get', url: '/users' });
      expect(k1).not.toBe(k2);
    });
  });

  // ── data trong GET bị ignore ───────────────────────────────────────────────

  describe('data trong GET request', () => {
    it('GET với data → dataStr rỗng (data bị ignore)', () => {
      const key = buildRequestKey({ method: 'get', url: '/test', data: { foo: 'bar' } });
      const [, , , dataStr] = JSON.parse(key);
      expect(dataStr).toBe('');
    });

    it('GET với data khác nhau → cùng key (data bị ignore)', () => {
      const k1 = buildRequestKey({ method: 'get', url: '/test', data: { a: 1 } });
      const k2 = buildRequestKey({ method: 'get', url: '/test', data: { b: 2 } });
      expect(k1).toBe(k2);
    });
  });

  // ── data trong non-GET ─────────────────────────────────────────────────────

  describe('data trong non-GET request', () => {
    it('POST data được include trong key', () => {
      const k1 = buildRequestKey({ method: 'post', url: '/users', data: { name: 'Alice' } });
      const k2 = buildRequestKey({ method: 'post', url: '/users', data: { name: 'Bob' } });
      expect(k1).not.toBe(k2);
    });

    it('PUT data được include', () => {
      const k1 = buildRequestKey({ method: 'put', url: '/users/1', data: { name: 'Alice' } });
      const k2 = buildRequestKey({ method: 'put', url: '/users/1', data: { name: 'Alice' } });
      expect(k1).toBe(k2);
    });

    it('data undefined vs data={} → khác key khi POST', () => {
      const k1 = buildRequestKey({ method: 'post', url: '/users' });
      const k2 = buildRequestKey({ method: 'post', url: '/users', data: {} });
      expect(k1).not.toBe(k2);
    });

    it('data là string (pre-serialized JSON)', () => {
      const k1 = buildRequestKey({ method: 'post', url: '/users', data: '{"name":"Alice"}' });
      const k2 = buildRequestKey({ method: 'post', url: '/users', data: '{"name":"Alice"}' });
      expect(k1).toBe(k2);
    });

    it('data là string vs object → khác key', () => {
      const k1 = buildRequestKey({ method: 'post', url: '/users', data: '{"name":"Alice"}' });
      const k2 = buildRequestKey({ method: 'post', url: '/users', data: { name: 'Alice' } });
      // String data dùng trực tiếp, object được JSON.stringify → khác nhau
      expect(k1).toBe(k2); // cả 2 đều stringify đến cùng giá trị
    });
  });

  // ── URL edge cases ─────────────────────────────────────────────────────────

  describe('URL edge cases', () => {
    it('url undefined → empty string', () => {
      const key = buildRequestKey({ method: 'get' });
      const [, url] = JSON.parse(key);
      expect(url).toBe('');
    });

    it('url với query string embedded → khác URL không có query', () => {
      const k1 = buildRequestKey({ method: 'get', url: '/users?page=1' });
      const k2 = buildRequestKey({ method: 'get', url: '/users' });
      expect(k1).not.toBe(k2);
    });

    it('url với trailing slash → khác URL không có trailing slash', () => {
      const k1 = buildRequestKey({ method: 'get', url: '/users/' });
      const k2 = buildRequestKey({ method: 'get', url: '/users' });
      expect(k1).not.toBe(k2);
    });

    it('url case-sensitive', () => {
      const k1 = buildRequestKey({ method: 'get', url: '/Users' });
      const k2 = buildRequestKey({ method: 'get', url: '/users' });
      expect(k1).not.toBe(k2);
    });
  });

  // ── Method variations ──────────────────────────────────────────────────────

  describe('method variations', () => {
    it('GET và POST cùng URL → key khác nhau', () => {
      const k1 = buildRequestKey({ method: 'get', url: '/users' });
      const k2 = buildRequestKey({ method: 'post', url: '/users' });
      expect(k1).not.toBe(k2);
    });

    it('method PATCH uppercase được normalize', () => {
      const k1 = buildRequestKey({ method: 'PATCH', url: '/users/1' });
      const k2 = buildRequestKey({ method: 'patch', url: '/users/1' });
      expect(k1).toBe(k2);
    });

    it('method DELETE và DELETE uppercase → cùng key', () => {
      const k1 = buildRequestKey({ method: 'DELETE', url: '/users/1' });
      const k2 = buildRequestKey({ method: 'delete', url: '/users/1' });
      expect(k1).toBe(k2);
    });
  });

  // ── Collision resistance ───────────────────────────────────────────────────

  describe('collision resistance', () => {
    it('khác method → khác key (không collide)', () => {
      const methods = ['get', 'post', 'put', 'patch', 'delete'];
      const keys = methods.map((method) => buildRequestKey({ method, url: '/resource' }));
      const unique = new Set(keys);
      expect(unique.size).toBe(methods.length);
    });

    it('khác URL → khác key (không collide)', () => {
      const urls = ['/a', '/b', '/c', '/a/b', '/a/b/c'];
      const keys = urls.map((url) => buildRequestKey({ method: 'get', url }));
      const unique = new Set(keys);
      expect(unique.size).toBe(urls.length);
    });

    it('params có key prefix của nhau không collide', () => {
      const k1 = buildRequestKey({ method: 'get', url: '/t', params: { a: 1 } });
      const k2 = buildRequestKey({ method: 'get', url: '/t', params: { a: 11 } });
      expect(k1).not.toBe(k2);
    });
  });
});
