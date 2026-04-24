import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResponseCache } from '../../src/features/cache';

describe('ResponseCache', () => {
  const mockResponse = (data: unknown) =>
    ({ data, status: 200, statusText: 'OK', headers: {}, config: {} }) as any;

  describe('get() / set()', () => {
    it('trả về null khi cache empty', () => {
      const cache = new ResponseCache({ enabled: true });
      expect(cache.get('key')).toBeNull();
    });

    it('trả về data sau khi set', () => {
      const cache = new ResponseCache({ enabled: true, ttl: 5000 });
      const resp = mockResponse({ id: 1 });
      cache.set('key', resp);
      expect(cache.get('key')).toBe(resp);
    });

    it('trả về null sau khi TTL hết hạn', async () => {
      const cache = new ResponseCache({ enabled: true, ttl: 50 });
      cache.set('key', mockResponse({ id: 1 }));
      await new Promise((r) => setTimeout(r, 60));
      expect(cache.get('key')).toBeNull();
    });

    it('trả về stale data khi TTL hết + staleWhileRevalidate=true', async () => {
      const cache = new ResponseCache({ enabled: true, ttl: 50, staleWhileRevalidate: true });
      const resp = mockResponse({ id: 1 });
      cache.set('key', resp);
      await new Promise((r) => setTimeout(r, 60));
      // Vẫn trả về (stale) thay vì null
      expect(cache.get('key')).toBe(resp);
    });
  });

  describe('isStale()', () => {
    it('trả về false khi còn fresh', () => {
      const cache = new ResponseCache({ enabled: true, ttl: 5000 });
      cache.set('key', mockResponse({}));
      expect(cache.isStale('key')).toBe(false);
    });

    it('trả về true khi không tồn tại', () => {
      const cache = new ResponseCache({ enabled: true });
      expect(cache.isStale('nonexistent')).toBe(true);
    });
  });

  describe('LRU eviction', () => {
    it('evict entry ít dùng nhất khi đạt maxSize', async () => {
      const cache = new ResponseCache({ enabled: true, maxSize: 2, ttl: 60_000 });

      cache.set('a', mockResponse('a'));
      // Delay nhỏ để b.lastAccessedAt > a.lastAccessedAt ban đầu
      await new Promise((r) => setTimeout(r, 5));
      cache.set('b', mockResponse('b'));

      // Truy cập 'a' để cập nhật lastAccessedAt của 'a' mới hơn 'b'
      await new Promise((r) => setTimeout(r, 5));
      cache.get('a');

      // Thêm 'c' → evict 'b' (b.lastAccessedAt cũ nhất)
      cache.set('c', mockResponse('c'));

      expect(cache.size).toBe(2);
      expect(cache.get('a')).not.toBeNull(); // còn
      expect(cache.get('b')).toBeNull();     // đã evict
      expect(cache.get('c')).not.toBeNull(); // mới thêm
    });

    it('không evict khi update existing key', () => {
      const cache = new ResponseCache({ enabled: true, maxSize: 2, ttl: 60_000 });
      cache.set('a', mockResponse('a'));
      cache.set('b', mockResponse('b'));
      // Update 'a' — không phải entry mới, không evict
      cache.set('a', mockResponse('a-updated'));
      expect(cache.size).toBe(2);
    });
  });

  describe('invalidate()', () => {
    it('xóa đúng key', () => {
      const cache = new ResponseCache({ enabled: true });
      cache.set('a', mockResponse('a'));
      cache.set('b', mockResponse('b'));
      cache.invalidate('a');
      expect(cache.get('a')).toBeNull();
      expect(cache.get('b')).not.toBeNull();
    });
  });

  describe('invalidateByPattern()', () => {
    it('xóa theo string prefix', () => {
      const cache = new ResponseCache({ enabled: true, ttl: 60_000 });
      // Key thực tế từ buildRequestKey có dạng JSON array string
      // Dùng key đơn giản cho test này để kiểm tra pattern matching
      cache.set('users-list', mockResponse('users'));
      cache.set('users-detail-1', mockResponse('user1'));
      cache.set('posts-list', mockResponse('posts'));

      cache.invalidateByPattern('users-');
      expect(cache.get('users-list')).toBeNull();
      expect(cache.get('users-detail-1')).toBeNull();
      expect(cache.get('posts-list')).not.toBeNull();
    });

    it('xóa theo RegExp', () => {
      const cache = new ResponseCache({ enabled: true, ttl: 60_000 });
      cache.set('key-user-1', mockResponse('u1'));
      cache.set('key-user-2', mockResponse('u2'));
      cache.set('key-post-1', mockResponse('p1'));

      cache.invalidateByPattern(/key-user-/);
      expect(cache.get('key-user-1')).toBeNull();
      expect(cache.get('key-user-2')).toBeNull();
      expect(cache.get('key-post-1')).not.toBeNull();
    });

    it('không throw khi không match gì', () => {
      const cache = new ResponseCache({ enabled: true });
      cache.set('key', mockResponse({}));
      expect(() => cache.invalidateByPattern('nonexistent')).not.toThrow();
    });
  });

  describe('clear()', () => {
    it('xóa tất cả entries', () => {
      const cache = new ResponseCache({ enabled: true });
      cache.set('a', mockResponse('a'));
      cache.set('b', mockResponse('b'));
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });
});
