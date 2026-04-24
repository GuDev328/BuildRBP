/**
 * Issue #2: clearCache(string) dùng invalidateByPattern thay vì exact key match
 *
 * createInstance.ts clearCache():
 *   if (!keyOrPattern) cache.clear()
 *   else cache.invalidateByPattern(keyOrPattern) ← luôn dùng pattern!
 *
 * Khi truyền string 'key', nó được chuyển thành regex /^key/
 * → match cả 'key-v2', 'key-backup' (false positives)
 */

import { describe, it, expect } from 'vitest';
import { createApiClient } from '../../src/core/createInstance';
import { ResponseCache } from '../../src/features/cache';

// Helper tạo mock response
function mockResponse(data: unknown) {
  return { data, status: 200, statusText: 'OK', headers: {}, config: {} } as any;
}

describe('clearCache — string key vs pattern behavior', () => {
  // ── ResponseCache.invalidateByPattern — direct test ────────────────────────

  describe('ResponseCache.invalidateByPattern — string pattern behavior', () => {
    it('string pattern xóa entry có key bắt đầu với pattern', () => {
      const cache = new ResponseCache({ enabled: true, ttl: 60_000 });
      cache.set('users', mockResponse('all'));
      cache.set('users-page2', mockResponse('page2'));
      cache.set('posts', mockResponse('posts'));

      // invalidateByPattern('users') → regex /^users/ → match 'users' VÀ 'users-page2'
      cache.invalidateByPattern('users');

      expect(cache.get('users')).toBeNull();       // bị xóa
      expect(cache.get('users-page2')).toBeNull(); // bị xóa luôn! (false positive)
      expect(cache.get('posts')).not.toBeNull();   // vẫn còn
    });

    it('RegExp pattern exact match', () => {
      const cache = new ResponseCache({ enabled: true, ttl: 60_000 });
      cache.set('users', mockResponse('all'));
      cache.set('users-page2', mockResponse('page2'));

      // Dùng RegExp exact match để tránh false positive
      cache.invalidateByPattern(/^users$/);

      expect(cache.get('users')).toBeNull();           // bị xóa
      expect(cache.get('users-page2')).not.toBeNull(); // vẫn còn (exact match)
    });

    it('invalidate bằng exact key thì dùng invalidate() thay vì invalidateByPattern()', () => {
      const cache = new ResponseCache({ enabled: true, ttl: 60_000 });
      cache.set('users', mockResponse('all'));
      cache.set('users-page2', mockResponse('page2'));

      // Cách đúng để xóa 1 key chính xác
      cache.invalidate('users');

      expect(cache.get('users')).toBeNull();
      expect(cache.get('users-page2')).not.toBeNull(); // không bị ảnh hưởng
    });
  });

  // ── createApiClient.clearCache — integration ──────────────────────────────

  describe('createApiClient.clearCache — documented behavior', () => {
    it('clearCache(string URL) xóa đúng cache entries có URL đó', async () => {
      let callCount = 0;
      const client = createApiClient({
        baseURL: 'http://localhost',
        logging: false,
        cache: { enabled: true, ttl: 60_000 },
        deduplication: false,
      });

      client.instance.defaults.adapter = async (config: any) => {
        callCount++;
        return {
          data: { data: { call: callCount }, message: 'OK', status: 200 },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      };

      // Tạo 2 cache entries: /users và /posts
      await client.get('/users');
      await client.get('/posts');
      expect(callCount).toBe(2);

      // clearCache('/users') → build regex /,"\/users/ → match JSON key chứa '/users'
      // Key của /users: '["get","/users","",""]' → match ✅
      // Key của /posts: '["get","/posts","",""]' → không match ✅
      client.clearCache('/users');

      // /users bị xóa → cache miss → HTTP call mới
      await client.get('/users');
      // /posts vẫn còn → cache hit → không có call mới
      await client.get('/posts');

      expect(callCount).toBe(3); // 2 + 1 call mới cho /users
    });

    it('clearCache() không có arg → xóa toàn bộ cache', async () => {
      let callCount = 0;
      const client = createApiClient({
        baseURL: 'http://localhost',
        logging: false,
        cache: { enabled: true, ttl: 60_000 },
        deduplication: false,
      });

      client.instance.defaults.adapter = async (config: any) => {
        callCount++;
        return {
          data: { data: {}, message: 'OK', status: 200 },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      };

      await client.get('/users');
      await client.get('/posts');
      expect(callCount).toBe(2);

      client.clearCache(); // xóa hết
      await client.get('/users');
      await client.get('/posts');
      expect(callCount).toBe(4); // 2 cache misses
    });

    it('clearCache(RegExp) — exact URL match không nhầm sang /users-admin', async () => {
      let callCount = 0;
      const client = createApiClient({
        baseURL: 'http://localhost',
        logging: false,
        cache: { enabled: true, ttl: 60_000 },
        deduplication: false,
      });

      client.instance.defaults.adapter = async (config: any) => {
        callCount++;
        return {
          data: { data: {}, message: 'OK', status: 200 },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      };

      await client.get('/users');
      await client.get('/users-admin');
      expect(callCount).toBe(2);

      // Dùng exact regex để chỉ xóa /users (không phải /users-admin)
      // Key format: '["get","/users","...","..."]'
      // Pattern match: ,"/users", (URL field kết thúc bằng dấu phẩy)
      client.clearCache(new RegExp(',"/users"'));

      await client.get('/users');        // cache miss → call mới
      await client.get('/users-admin'); // cache hit (vẫn còn)

      expect(callCount).toBe(3); // chỉ /users bị xóa
    });

    it('clearCache(string) không throw khi cache disabled', () => {
      const client = createApiClient({
        baseURL: 'http://localhost',
        logging: false,
        // không có cache config
      });
      expect(() => client.clearCache('any-key')).not.toThrow();
    });
  });
});
