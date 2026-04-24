/**
 * Additional edge case tests:
 * - AbortManager — abortAll() sau khi đã abort một số keys
 * - ResponseCache — LRU eviction với tie-breaking
 * - Deduplicator — wrap() bị gọi sau khi có pending requests
 * - RetryHandler — abort trong khi đang retry (signal cleanup)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { AbortManager } from '../../src/core/AbortManager';
import { ResponseCache } from '../../src/features/cache';
import { Deduplicator } from '../../src/features/deduplicator';
import { setupRetryInterceptor } from '../../src/features/retryHandler';
import { logger } from '../../src/utils/logger';

describe('AbortManager — additional edge cases', () => {
  describe('abortAll() after partial abort', () => {
    it('abortAll() sau khi đã abort một số keys — không throw', () => {
      const manager = new AbortManager();
      manager.register('key1');
      manager.register('key2');
      manager.register('key3');

      // Abort 1 key trước
      manager.abort('key1');
      expect(manager.pendingCount).toBe(2); // key2, key3 còn

      // abortAll phải xử lý được các key còn lại
      expect(() => manager.abortAll()).not.toThrow();
      expect(manager.pendingCount).toBe(0);
    });

    it('abortAll() trả về sau khi xóa map (không infinite loop)', () => {
      const manager = new AbortManager();
      for (let i = 0; i < 100; i++) {
        manager.register(`key-${i}`);
      }
      expect(manager.pendingCount).toBe(100);
      manager.abortAll();
      expect(manager.pendingCount).toBe(0);
    });
  });

  describe('clear() behavior', () => {
    it('clear() key không tồn tại không throw', () => {
      const manager = new AbortManager();
      expect(() => manager.clear('ghost-key')).not.toThrow();
    });

    it('clear() giảm pendingCount', () => {
      const manager = new AbortManager();
      manager.register('key1');
      manager.register('key2');
      expect(manager.pendingCount).toBe(2);

      manager.clear('key1');
      expect(manager.pendingCount).toBe(1);
    });

    it('abort() sau clear() không tìm thấy controller — không throw', () => {
      const manager = new AbortManager();
      manager.register('key1');
      manager.clear('key1'); // xóa trước
      expect(() => manager.abort('key1')).not.toThrow(); // key không còn
    });
  });

  describe('pendingKeys getter', () => {
    it('pendingKeys trả về danh sách đúng', () => {
      const manager = new AbortManager();
      manager.register('alpha');
      manager.register('beta');
      manager.register('gamma');

      const keys = manager.pendingKeys;
      expect(keys).toHaveLength(3);
      expect(keys).toContain('alpha');
      expect(keys).toContain('beta');
      expect(keys).toContain('gamma');
    });

    it('pendingKeys là snapshot — không reference internal map', () => {
      const manager = new AbortManager();
      manager.register('key1');

      const keys = manager.pendingKeys;
      manager.register('key2');

      // keys là snapshot từ trước → chưa có key2
      expect(keys).toHaveLength(1);
      expect(keys).not.toContain('key2');
    });

    it('pendingKeys empty khi không có pending requests', () => {
      const manager = new AbortManager();
      expect(manager.pendingKeys).toEqual([]);
    });
  });

  describe('duplicate register — abort reason', () => {
    it('duplicate register abort với DOMException AbortError name', () => {
      const manager = new AbortManager();
      const signal1 = manager.register('key1');

      let abortReason: unknown;
      signal1.addEventListener('abort', () => {
        abortReason = signal1.reason;
      });

      // Register lần 2 → abort signal1
      manager.register('key1');

      expect(signal1.aborted).toBe(true);
      expect(abortReason).toBeInstanceOf(DOMException);
      expect((abortReason as DOMException).name).toBe('AbortError');
    });

    it('abort() với custom reason', () => {
      const manager = new AbortManager();
      const signal = manager.register('key1');

      let abortReason: unknown;
      signal.addEventListener('abort', () => {
        abortReason = signal.reason;
      });

      manager.abort('key1', 'User navigated away');

      expect(signal.aborted).toBe(true);
      expect(abortReason).toBeInstanceOf(DOMException);
      expect((abortReason as DOMException).message).toBe('User navigated away');
    });
  });
});

describe('ResponseCache — LRU tie-breaking edge case', () => {
  beforeEach(() => {
    logger.enabled = false;
  });

  it('khi các entries có cùng lastAccessedAt — xóa entry iterate đầu tiên', () => {
    // Khi Date.now() không đổi trong test nhanh, các entries có thể có cùng timestamp
    // LRU chọn entry đầu tiên có lruTime < Infinity
    const cache = new ResponseCache({ enabled: true, maxSize: 2, ttl: 60_000 });

    // Set 2 entries liên tiếp (có thể cùng timestamp)
    const resp1 = { data: 'a', status: 200, statusText: 'OK', headers: {}, config: {} } as any;
    const resp2 = { data: 'b', status: 200, statusText: 'OK', headers: {}, config: {} } as any;
    cache.set('a', resp1);
    cache.set('b', resp2);

    expect(cache.size).toBe(2);

    // Thêm entry thứ 3 → evict LRU
    const resp3 = { data: 'c', status: 200, statusText: 'OK', headers: {}, config: {} } as any;
    cache.set('c', resp3);

    // Size vẫn là 2 (đã evict 1)
    expect(cache.size).toBe(2);
  });

  it('get() trên expired entry khi staleWhileRevalidate=false → xóa và trả null', () => {
    const cache = new ResponseCache({ enabled: true, ttl: 1, staleWhileRevalidate: false });
    const resp = { data: 'test', status: 200, statusText: 'OK', headers: {}, config: {} } as any;
    cache.set('key', resp);

    // Expired (ttl=1ms)
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const result = cache.get('key');
        expect(result).toBeNull();
        expect(cache.size).toBe(0); // entry đã bị xóa
        resolve();
      }, 10);
    });
  });

  it('set() update existing entry không tăng size', () => {
    const cache = new ResponseCache({ enabled: true, ttl: 60_000 });
    const resp1 = { data: 'v1', status: 200, statusText: 'OK', headers: {}, config: {} } as any;
    const resp2 = { data: 'v2', status: 200, statusText: 'OK', headers: {}, config: {} } as any;

    cache.set('key', resp1);
    expect(cache.size).toBe(1);

    cache.set('key', resp2); // update
    expect(cache.size).toBe(1);

    expect(cache.get('key')).toBe(resp2); // phải là giá trị mới
  });

  it('clear() reset toàn bộ cache về 0', () => {
    const cache = new ResponseCache({ enabled: true, ttl: 60_000 });
    for (let i = 0; i < 10; i++) {
      cache.set(`key${i}`, { data: i, status: 200, statusText: 'OK', headers: {}, config: {} } as any);
    }
    expect(cache.size).toBe(10);

    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('invalidate() key không tồn tại không throw', () => {
    const cache = new ResponseCache({ enabled: true });
    expect(() => cache.invalidate('ghost')).not.toThrow();
    expect(cache.size).toBe(0);
  });
});

describe('Deduplicator — additional edge cases', () => {
  it('POST request không bị dedup (chỉ GET)', async () => {
    let callCount = 0;
    const instance = axios.create();
    instance.defaults.adapter = async (config: any) => {
      callCount++;
      await new Promise((r) => setTimeout(r, 20));
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    };

    const dedup = new Deduplicator();
    dedup.wrap(instance);

    // 2 concurrent POST requests → không dedup
    await Promise.all([
      instance.request({ method: 'post', url: '/data', data: { x: 1 } }),
      instance.request({ method: 'post', url: '/data', data: { x: 1 } }),
    ]);

    expect(callCount).toBe(2);
  });

  it('PUT request không bị dedup', async () => {
    let callCount = 0;
    const instance = axios.create();
    instance.defaults.adapter = async (config: any) => {
      callCount++;
      await new Promise((r) => setTimeout(r, 15));
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    };

    const dedup = new Deduplicator();
    dedup.wrap(instance);

    await Promise.all([
      instance.request({ method: 'put', url: '/data/1', data: {} }),
      instance.request({ method: 'put', url: '/data/1', data: {} }),
    ]);

    expect(callCount).toBe(2);
  });

  it('dedup key bao gồm baseURL khi Axios concatenate URL', async () => {
    // buildRequestKey dùng config.url (đã merge với baseURL bởi axios)
    let callCount = 0;
    const instance = axios.create({ baseURL: 'http://api.example.com' });
    instance.defaults.adapter = async (config: any) => {
      callCount++;
      await new Promise((r) => setTimeout(r, 20));
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    };

    const dedup = new Deduplicator();
    dedup.wrap(instance);

    // Cùng path → dedup
    await Promise.all([
      instance.request({ method: 'get', url: '/users' }),
      instance.request({ method: 'get', url: '/users' }),
    ]);

    expect(callCount).toBe(1);
  });
});

describe('RetryHandler — retry signal cleanup', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retry request không dùng lại signal cũ (signal bị xóa trước retry)', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    let callCount = 0;

    const instance = axios.create();
    const controller = new AbortController();

    instance.defaults.adapter = async (config: any) => {
      callCount++;
      signals.push(config.signal);
      if (callCount === 1) {
        throw new axios.AxiosError('Server Error', '500', config, undefined, {
          data: {}, status: 500, statusText: 'Error', headers: {}, config,
        } as any);
      }
      return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
    };

    setupRetryInterceptor(instance, { maxRetries: 1, retryDelay: 1 });

    // Gửi request với signal từ bên ngoài
    const res = await instance.get('/test', { signal: controller.signal });
    expect(res.data).toEqual({ ok: true });
    expect(callCount).toBe(2);

    // Lần retry (callCount=2) KHÔNG có signal (bị delete trước retry)
    // Lần đầu (callCount=1) có signal từ caller
    expect(signals[0]).toBe(controller.signal); // lần 1: signal gốc
    // Lần retry: signal undefined (đã bị delete bởi retryHandler)
    expect(signals[1]).toBeUndefined();
  });

  it('ERR_CANCELED không retry — verify không bị stuck', async () => {
    let callCount = 0;
    const instance = axios.create();
    instance.defaults.adapter = async (config: any) => {
      callCount++;
      throw new axios.AxiosError('canceled', 'ERR_CANCELED', config);
    };
    setupRetryInterceptor(instance, { maxRetries: 99, retryDelay: 1000 });

    const start = Date.now();
    await expect(instance.get('/test')).rejects.toBeDefined();
    const elapsed = Date.now() - start;

    expect(callCount).toBe(1); // không retry
    expect(elapsed).toBeLessThan(500); // không bị delay
  });
});
