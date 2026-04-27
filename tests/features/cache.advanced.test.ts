/**
 * Advanced tests cho ResponseCache:
 *  - wrap() — cache tích hợp với axios instance
 *  - Stale-while-revalidate background revalidation
 *  - Per-request TTL override (cacheTtl)
 *  - skipCache bypass
 *  - Non-GET methods bỏ qua cache
 *  - Idempotent wrap guard
 *  - default values, size getter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { ResponseCache } from '../../src/features/cache';
import { logger } from '../../src/utils/logger';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockResponse(data: unknown, status = 200) {
  return { data, status, statusText: 'OK', headers: {}, config: {} } as any;
}

function makeWrappedInstance(cacheOpts: ConstructorParameters<typeof ResponseCache>[0] = {}) {
  const instance = axios.create();
  const cache = new ResponseCache({ enabled: true, ttl: 60_000, ...cacheOpts });
  cache.wrap(instance);
  return { instance, cache };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ResponseCache — advanced', () => {
  beforeEach(() => {
    logger.enabled = false;
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Constructor defaults ───────────────────────────────────────────────────

  describe('constructor defaults', () => {
    it('enabled=false khi không truyền options', () => {
      const cache = new ResponseCache();
      // wrap() sẽ return sớm khi enabled=false
      const instance = axios.create();
      cache.wrap(instance); // không throw
      expect(cache.size).toBe(0);
    });

    it('size=0 ban đầu', () => {
      const cache = new ResponseCache({ enabled: true });
      expect(cache.size).toBe(0);
    });

    it('dùng TTL mặc định 60s khi không truyền ttl', () => {
      const cache = new ResponseCache({ enabled: true });
      const resp = mockResponse('data');
      cache.set('key', resp);
      expect(cache.get('key')).toBe(resp); // còn fresh
    });
  });

  // ── wrap() idempotent guard ────────────────────────────────────────────────

  describe('wrap() idempotent guard', () => {
    it('gọi wrap() nhiều lần không tạo multi-layer wrap', async () => {
      let callCount = 0;
      const instance = axios.create();
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        return { data: { n: callCount }, status: 200, statusText: 'OK', headers: {}, config };
      };

      const cache = new ResponseCache({ enabled: true, ttl: 60_000 });
      cache.wrap(instance);
      cache.wrap(instance); // lần 2 — không tạo thêm layer
      cache.wrap(instance); // lần 3

      const r1 = await instance.request({ method: 'get', url: '/test' });
      const r2 = await instance.request({ method: 'get', url: '/test' }); // cache hit

      expect(callCount).toBe(1); // chỉ 1 HTTP call
      expect(r1.data).toEqual(r2.data);
    });

    it('wrap() không hoạt động khi enabled=false', async () => {
      let callCount = 0;
      const instance = axios.create();
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        return { data: { n: callCount }, status: 200, statusText: 'OK', headers: {}, config };
      };

      const cache = new ResponseCache({ enabled: false, ttl: 60_000 });
      cache.wrap(instance); // guard return sớm

      await instance.request({ method: 'get', url: '/test' });
      await instance.request({ method: 'get', url: '/test' }); // không cache

      expect(callCount).toBe(2);
    });
  });

  // ── Cache hit / miss qua axios wrap ───────────────────────────────────────

  describe('wrap() — cache hit/miss via axios', () => {
    it('GET request được cache sau lần đầu', async () => {
      let callCount = 0;
      const { instance } = makeWrappedInstance({ ttl: 60_000 });
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        return { data: { call: callCount }, status: 200, statusText: 'OK', headers: {}, config };
      };

      const r1 = await instance.request({ method: 'get', url: '/data' });
      const r2 = await instance.request({ method: 'get', url: '/data' });

      expect(callCount).toBe(1);
      expect(r1.data).toEqual(r2.data);
    });

    it('GET expired → cache miss → new HTTP call', async () => {
      let callCount = 0;
      const { instance } = makeWrappedInstance({ ttl: 30 });
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        return { data: { call: callCount }, status: 200, statusText: 'OK', headers: {}, config };
      };

      await instance.request({ method: 'get', url: '/data' });
      await new Promise((r) => setTimeout(r, 50)); // TTL expired

      await instance.request({ method: 'get', url: '/data' });

      expect(callCount).toBe(2);
    });

    it('GET cùng URL nhưng params khác → different cache entries', async () => {
      let callCount = 0;
      const { instance } = makeWrappedInstance({ ttl: 60_000 });
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        return { data: { call: callCount }, status: 200, statusText: 'OK', headers: {}, config };
      };

      await instance.request({ method: 'get', url: '/users', params: { page: 1 } });
      await instance.request({ method: 'get', url: '/users', params: { page: 2 } });

      expect(callCount).toBe(2); // 2 entries khác nhau
    });

    it('GET cùng URL, cùng params → cache hit', async () => {
      let callCount = 0;
      const { instance } = makeWrappedInstance({ ttl: 60_000 });
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        return { data: { call: callCount }, status: 200, statusText: 'OK', headers: {}, config };
      };

      await instance.request({ method: 'get', url: '/users', params: { page: 1 } });
      await instance.request({ method: 'get', url: '/users', params: { page: 1 } });

      expect(callCount).toBe(1);
    });
  });

  // ── skipCache flag ─────────────────────────────────────────────────────────

  describe('skipCache flag', () => {
    it('skipCache=true bỏ qua cache — gửi HTTP call mới', async () => {
      let callCount = 0;
      const { instance } = makeWrappedInstance({ ttl: 60_000 });
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        return { data: { call: callCount }, status: 200, statusText: 'OK', headers: {}, config };
      };

      await instance.request({ method: 'get', url: '/data' });
      await instance.request({ method: 'get', url: '/data', skipCache: true } as any);

      expect(callCount).toBe(2);
    });

    it('skipCache=false (mặc định) → sử dụng cache', async () => {
      let callCount = 0;
      const { instance } = makeWrappedInstance({ ttl: 60_000 });
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        return { data: { call: callCount }, status: 200, statusText: 'OK', headers: {}, config };
      };

      await instance.request({ method: 'get', url: '/data' });
      await instance.request({ method: 'get', url: '/data', skipCache: false } as any);

      expect(callCount).toBe(1);
    });
  });

  // ── Per-request cacheTtl override ─────────────────────────────────────────

  describe('cacheTtl per-request override', () => {
    it('cacheTtl ngắn → entry expires nhanh hơn global ttl', async () => {
      let callCount = 0;
      const { instance } = makeWrappedInstance({ ttl: 60_000 }); // global: 60s
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        return { data: { call: callCount }, status: 200, statusText: 'OK', headers: {}, config };
      };

      // Request với cacheTtl=30ms
      await instance.request({ method: 'get', url: '/short', cacheTtl: 30 } as any);
      await new Promise((r) => setTimeout(r, 50)); // wait > 30ms

      // Cache đã expired → new call
      await instance.request({ method: 'get', url: '/short' } as any);

      expect(callCount).toBe(2);
    });

    it('cacheTtl dài → entry vẫn valid sau global ttl', async () => {
      let callCount = 0;
      const { instance } = makeWrappedInstance({ ttl: 10 }); // global: 10ms (ngắn)
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        return { data: { call: callCount }, status: 200, statusText: 'OK', headers: {}, config };
      };

      // Request với cacheTtl dài
      await instance.request({ method: 'get', url: '/long', cacheTtl: 60_000 } as any);
      await new Promise((r) => setTimeout(r, 20)); // global ttl expired nhưng per-request vẫn fresh

      await instance.request({ method: 'get', url: '/long' } as any);

      expect(callCount).toBe(1); // vẫn cache hit
    });
  });

  // ── Non-GET methods bypass cache ──────────────────────────────────────────

  describe('Non-GET methods không được cache', () => {
    it('POST request không cache', async () => {
      let callCount = 0;
      const { instance } = makeWrappedInstance({ ttl: 60_000 });
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        return { data: { call: callCount }, status: 200, statusText: 'OK', headers: {}, config };
      };

      await instance.request({ method: 'post', url: '/users', data: { name: 'x' } });
      await instance.request({ method: 'post', url: '/users', data: { name: 'x' } });

      expect(callCount).toBe(2);
    });

    it('PUT request không cache', async () => {
      let callCount = 0;
      const { instance } = makeWrappedInstance({ ttl: 60_000 });
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        return { data: { call: callCount }, status: 200, statusText: 'OK', headers: {}, config };
      };

      await instance.request({ method: 'put', url: '/users/1', data: {} });
      await instance.request({ method: 'put', url: '/users/1', data: {} });

      expect(callCount).toBe(2);
    });

    it('DELETE request không cache', async () => {
      let callCount = 0;
      const { instance } = makeWrappedInstance({ ttl: 60_000 });
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        return { data: { call: callCount }, status: 200, statusText: 'OK', headers: {}, config };
      };

      await instance.request({ method: 'delete', url: '/users/1' });
      await instance.request({ method: 'delete', url: '/users/1' });

      expect(callCount).toBe(2);
    });
  });

  // ── Stale-while-revalidate background revalidation ────────────────────────

  describe('staleWhileRevalidate background revalidation', () => {
    it('trả về stale data ngay lập tức + revalidate background', async () => {
      let callCount = 0;
      const { instance } = makeWrappedInstance({ ttl: 30, staleWhileRevalidate: true });
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        await new Promise((r) => setTimeout(r, 5));
        return { data: { call: callCount }, status: 200, statusText: 'OK', headers: {}, config };
      };

      // Lần 1: warm cache
      const r1 = await instance.request({ method: 'get', url: '/swr' });
      expect(callCount).toBe(1);

      // Chờ TTL expire
      await new Promise((r) => setTimeout(r, 40));

      // Lần 2: trả stale ngay + trigger background revalidation
      const start = Date.now();
      const r2 = await instance.request({ method: 'get', url: '/swr' });
      const elapsed = Date.now() - start;

      // Phải trả về stale ngay (< 20ms) thay vì chờ request mới (5ms+)
      expect(elapsed).toBeLessThan(20);
      expect(r2.data).toEqual(r1.data); // vẫn là stale data

      // Background revalidation sẽ chạy
      await new Promise((r) => setTimeout(r, 20)); // chờ background
      expect(callCount).toBe(2); // đã gửi thêm 1 request background
    });

    it('background revalidation fail — không affect caller (có log debug)', async () => {
      let callCount = 0;
      const { instance } = makeWrappedInstance({ ttl: 20, staleWhileRevalidate: true });
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        if (callCount === 2) {
          // Background revalidation fail
          throw new Error('Network error');
        }
        return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
      };

      await instance.request({ method: 'get', url: '/swr' });
      await new Promise((r) => setTimeout(r, 30)); // expire

      // Lần 2: nhận stale — background fail được log debug nhưng không throw lên caller
      const res = await instance.request({ method: 'get', url: '/swr' });
      expect(res).toBeDefined(); // không throw
      expect(res.data).toEqual({ ok: true });

      await new Promise((r) => setTimeout(r, 20)); // chờ background settle
    });

    it('không trigger background khi staleWhileRevalidate=false', async () => {
      let callCount = 0;
      const { instance } = makeWrappedInstance({ ttl: 20, staleWhileRevalidate: false });
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        return { data: { call: callCount }, status: 200, statusText: 'OK', headers: {}, config };
      };

      await instance.request({ method: 'get', url: '/data' });
      await new Promise((r) => setTimeout(r, 30)); // expire

      // Cache miss → sync request
      const r2 = await instance.request({ method: 'get', url: '/data' });
      expect(callCount).toBe(2);
      expect(r2.data).toEqual({ call: 2 }); // fresh data
    });
  });

  // ── LRU + size getter ──────────────────────────────────────────────────────

  describe('LRU eviction via set()', () => {
    it('size tăng khi set entry mới', () => {
      const cache = new ResponseCache({ enabled: true, ttl: 60_000 });
      expect(cache.size).toBe(0);
      cache.set('a', mockResponse('a'));
      expect(cache.size).toBe(1);
      cache.set('b', mockResponse('b'));
      expect(cache.size).toBe(2);
    });

    it('size không tăng khi update existing key', () => {
      const cache = new ResponseCache({ enabled: true, ttl: 60_000 });
      cache.set('a', mockResponse('v1'));
      cache.set('a', mockResponse('v2')); // update, không phải entry mới
      expect(cache.size).toBe(1);
    });

    it('set() dùng per-call ttl override', () => {
      const cache = new ResponseCache({ enabled: true, ttl: 60_000 });
      const resp = mockResponse('data');
      cache.set('key', resp, 1); // TTL = 1ms
      // Sync: vẫn fresh (chưa expire)
      expect(cache.get('key')).toBe(resp);
    });
  });

  // ── isStale() edge cases ───────────────────────────────────────────────────

  describe('isStale() edge cases', () => {
    it('isStale=true sau khi TTL expire', async () => {
      const cache = new ResponseCache({ enabled: true, ttl: 20 });
      cache.set('key', mockResponse({}));
      await new Promise((r) => setTimeout(r, 30));
      expect(cache.isStale('key')).toBe(true);
    });

    it('isStale=false ngay sau khi set', () => {
      const cache = new ResponseCache({ enabled: true, ttl: 60_000 });
      cache.set('key', mockResponse({}));
      expect(cache.isStale('key')).toBe(false);
    });

    it('isStale=true cho key không tồn tại', () => {
      const cache = new ResponseCache({ enabled: true });
      expect(cache.isStale('ghost')).toBe(true);
    });
  });

  // ── get() updates LRU lastAccessedAt ──────────────────────────────────────

  describe('get() updates lastAccessedAt (LRU)', () => {
    it('accessing entry cập nhật LRU order', async () => {
      const cache = new ResponseCache({ enabled: true, maxSize: 2, ttl: 60_000 });

      cache.set('old', mockResponse('old'));
      await new Promise((r) => setTimeout(r, 5));
      cache.set('new', mockResponse('new'));

      // Access 'old' → update lastAccessedAt → 'new' sẽ bị evict khi thêm 'third'
      await new Promise((r) => setTimeout(r, 5));
      cache.get('old');

      // Thêm 'third' → evict entry ít access nhất (giờ là 'new')
      cache.set('third', mockResponse('third'));

      expect(cache.get('old')).not.toBeNull();   // vừa được access
      expect(cache.get('third')).not.toBeNull();  // mới nhất
      expect(cache.get('new')).toBeNull();        // bị evict
    });
  });

  // ── Cache HIT trả shallow copy — không phải same reference ────────────────

  describe('cache HIT — shallow copy isolation', () => {
    it('cache HIT trả object khác với stored entry (shallow copy)', async () => {
      let callCount = 0;
      const { instance } = makeWrappedInstance({ ttl: 60_000 });
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        return { data: { items: [1, 2, 3] }, status: 200, statusText: 'OK', headers: {}, config };
      };

      const r1 = await instance.request({ method: 'get', url: '/data' });
      const r2 = await instance.request({ method: 'get', url: '/data' }); // cache hit

      expect(callCount).toBe(1);
      // r2 là shallow copy — không phải cùng object reference với r1
      expect(r2).not.toBe(r1);
      // Nhưng nội dung data vẫn giống nhau
      expect(r2.data).toEqual(r1.data);
    });

    it('caller mutate response wrapper không làm hỏng cache entry tiếp theo', async () => {
      let callCount = 0;
      const { instance } = makeWrappedInstance({ ttl: 60_000 });
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        return { data: { items: [1, 2, 3] }, status: 200, statusText: 'OK', headers: {}, config };
      };

      const r1 = await instance.request({ method: 'get', url: '/data' });

      // Mutate wrapper object của r1 (shallow copy — thay đổi property trên wrapper)
      (r1 as any).status = 999;
      (r1 as any).statusText = 'Mutated';

      // Lần 2: cache hit → shallow copy mới, wrapper của cache không bị ảnh hưởng
      const r2 = await instance.request({ method: 'get', url: '/data' });

      expect(callCount).toBe(1); // vẫn 1 HTTP call
      expect(r2.status).toBe(200);       // cache entry không bị mutate
      expect(r2.statusText).toBe('OK');
    });

    it('cache STALE (SWR) cũng trả shallow copy', async () => {
      let callCount = 0;
      const { instance } = makeWrappedInstance({ ttl: 20, staleWhileRevalidate: true });
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        return { data: { v: callCount }, status: 200, statusText: 'OK', headers: {}, config };
      };

      const r1 = await instance.request({ method: 'get', url: '/swr-copy' });
      await new Promise((r) => setTimeout(r, 30)); // TTL expired

      // Lần 2: trả stale → shallow copy
      const r2 = await instance.request({ method: 'get', url: '/swr-copy' });

      // r2 là shallow copy của cache entry, không phải r1
      expect(r2).not.toBe(r1);
      expect(r2.data).toEqual(r1.data); // cùng stale data

      await new Promise((r) => setTimeout(r, 30)); // chờ background
    });
  });

  // ── SWR revalidation logging khi fail ─────────────────────────────────────

  describe('staleWhileRevalidate — background revalidation logging', () => {
    it('background revalidation fail được log ở debug level', async () => {
      const debugSpy = vi.spyOn(logger, 'debug');
      logger.enabled = true; // bật logger để capture

      let callCount = 0;
      const { instance } = makeWrappedInstance({ ttl: 20, staleWhileRevalidate: true });
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Network timeout');
        }
        return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
      };

      // Warm cache
      await instance.request({ method: 'get', url: '/fail-revalidate' });
      await new Promise((r) => setTimeout(r, 30)); // expire

      // Lần 2: stale + trigger background revalidation (sẽ fail)
      const res = await instance.request({ method: 'get', url: '/fail-revalidate' });
      expect(res).toBeDefined(); // không throw

      // Chờ background settle và log ghi ra
      await new Promise((r) => setTimeout(r, 30));

      // Phải có log về revalidation failure (không bị silent nữa)
      const failLogs = debugSpy.mock.calls.filter((args) =>
        typeof args[0] === 'string' && args[0].includes('Background revalidation failed')
      );
      expect(failLogs.length).toBeGreaterThan(0);
      // Log message phải chứa error info
      expect(failLogs[0][1]).toContain('Network timeout');
    });
  });
});
