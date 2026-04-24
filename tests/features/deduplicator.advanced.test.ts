/**
 * Advanced Deduplicator tests:
 *  - Error propagation — cả 2 callers nhận cùng error
 *  - pending map cleanup khi request fail
 *  - params khác nhau → dedup key khác nhau
 *  - pendingCount real-time tracking
 *  - clear() trong khi pending
 *  - skipDedup precise behavior
 */

import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import { Deduplicator } from '../../src/features/deduplicator';
import { logger } from '../../src/utils/logger';

function makeWrappedInstance(adapter?: (config: any) => Promise<any>) {
  const instance = axios.create();
  // QUAN TRỌNG: Set adapter TRƯỜC wrap để deduplicator wrap lên trên
  if (adapter) instance.defaults.adapter = adapter as any;
  const dedup = new Deduplicator();
  dedup.wrap(instance);
  return { instance, dedup };
}

describe('Deduplicator — advanced', () => {
  // ── Error propagation ──────────────────────────────────────────────────────

  describe('error propagation', () => {
    it('khi request fail, tất cả callers nhận cùng error', async () => {
      let callCount = 0;
      const { instance } = makeWrappedInstance(async (config: any) => {
        callCount++;
        await new Promise((r) => setTimeout(r, 20));
        throw new axios.AxiosError('Server Error', '500', config, undefined, {
          data: { message: 'fail' }, status: 500, statusText: 'Error', headers: {}, config,
        } as any);
      });

      const results = await Promise.allSettled([
        instance.request({ method: 'get', url: '/fail' }),
        instance.request({ method: 'get', url: '/fail' }),
        instance.request({ method: 'get', url: '/fail' }),
      ]);

      // Chỉ 1 HTTP call
      expect(callCount).toBe(1);

      // Tất cả reject
      expect(results.every((r) => r.status === 'rejected')).toBe(true);

      // Cùng error (same axios error object)
      const errors = results.map((r) => (r as PromiseRejectedResult).reason);
      expect(errors[0]).toBe(errors[1]);
      expect(errors[1]).toBe(errors[2]);
    });

    it('pending map được dọn sạch sau khi request fail', async () => {
      const { instance, dedup } = makeWrappedInstance(async (config: any) => {
        throw new axios.AxiosError('fail', '500', config);
      });

      await instance.get('/fail').catch(() => {});
      expect(dedup.pendingCount).toBe(0);
    });

    it('pending map được dọn sạch sau khi request thành công', async () => {
      const { instance, dedup } = makeWrappedInstance(async (config: any) => ({
        data: {}, status: 200, statusText: 'OK', headers: {}, config,
      }));

      await instance.get('/ok');
      expect(dedup.pendingCount).toBe(0);
    });
  });

  // ── params-based dedup key ─────────────────────────────────────────────────

  describe('params trong dedup key', () => {
    it('GET cùng URL nhưng params khác → 2 requests riêng biệt', async () => {
      let callCount = 0;
      const { instance } = makeWrappedInstance(async (config: any) => {
        callCount++;
        await new Promise((r) => setTimeout(r, 15));
        return { data: { p: config.params }, status: 200, statusText: 'OK', headers: {}, config };
      });

      await Promise.all([
        instance.request({ method: 'get', url: '/users', params: { page: 1 } }),
        instance.request({ method: 'get', url: '/users', params: { page: 2 } }),
      ]);

      expect(callCount).toBe(2);
    });

    it('GET cùng params nhưng thứ tự key khác → cùng dedup key (sorted)', async () => {
      let callCount = 0;
      const { instance } = makeWrappedInstance(async (config: any) => {
        callCount++;
        await new Promise((r) => setTimeout(r, 20));
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
      });

      // Dùng instance.request() và truyền params trực tiếp qua config
      // để buildRequestKey nhận được params object đầy đủ
      await Promise.all([
        instance.request({ method: 'get', url: '/search', params: { q: 'hello', sort: 'asc' } }),
        instance.request({ method: 'get', url: '/search', params: { sort: 'asc', q: 'hello' } }),
      ]);

      // buildRequestKey sort keys → cùng key → dedup
      expect(callCount).toBe(1);
    });
  });

  // ── pendingCount real-time ─────────────────────────────────────────────────

  describe('pendingCount real-time tracking', () => {
    it('pendingCount tăng trong khi request pending', async () => {
      let resolveAdapter!: () => void;
      const { instance, dedup } = makeWrappedInstance(async (config: any) => {
        await new Promise<void>((r) => { resolveAdapter = r; });
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
      });

      const req = instance.request({ method: 'get', url: '/test' });

      // Chờ adapter bắt đầu và resolveAdapter được assign
      await new Promise((r) => setTimeout(r, 20));

      // Kiểm tra pendingCount từ bên ngoài adapter
      expect(dedup.pendingCount).toBe(1);

      resolveAdapter();
      await req;
      expect(dedup.pendingCount).toBe(0); // cleanup sau khi xong
    });

    it('pendingCount đúng khi có nhiều concurrent requests khác nhau', async () => {
      let maxPending = 0;
      let resolvers: Array<() => void> = [];

      const { instance, dedup } = makeWrappedInstance(async (config: any) => {
        maxPending = Math.max(maxPending, dedup.pendingCount);
        await new Promise<void>((r) => resolvers.push(r));
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
      });

      const p1 = instance.request({ method: 'get', url: '/a' });
      const p2 = instance.request({ method: 'get', url: '/b' });
      const p3 = instance.request({ method: 'get', url: '/c' });

      // Chờ tất cả bắt đầu
      await new Promise((r) => setTimeout(r, 20));

      expect(dedup.pendingCount).toBe(3);

      // Resolve tất cả
      resolvers.forEach((r) => r());
      await Promise.all([p1, p2, p3]);

      expect(dedup.pendingCount).toBe(0);
    });
  });

  // ── skipDedup precise behavior ─────────────────────────────────────────────

  describe('skipDedup precise behavior', () => {
    it('skipDedup=true request không chia sẻ pending với request thường', async () => {
      let callCount = 0;
      const { instance } = makeWrappedInstance(async (config: any) => {
        callCount++;
        await new Promise((r) => setTimeout(r, 20));
        return { data: { call: callCount }, status: 200, statusText: 'OK', headers: {}, config };
      });

      // Gửi normal + skipDedup concurrently
      await Promise.all([
        instance.request({ method: 'get', url: '/data' }),
        instance.request({ method: 'get', url: '/data', skipDedup: true } as any),
      ]);

      expect(callCount).toBe(2); // cả 2 đều gửi
    });

    it('2 skipDedup requests cũng không dedup nhau', async () => {
      let callCount = 0;
      const { instance } = makeWrappedInstance(async (config: any) => {
        callCount++;
        await new Promise((r) => setTimeout(r, 15));
        return { data: { call: callCount }, status: 200, statusText: 'OK', headers: {}, config };
      });

      await Promise.all([
        instance.request({ method: 'get', url: '/data', skipDedup: true } as any),
        instance.request({ method: 'get', url: '/data', skipDedup: true } as any),
      ]);

      // Cả 2 đều bỏ qua dedup → 2 calls
      expect(callCount).toBe(2);
    });
  });

  // ── clear() mid-flight ─────────────────────────────────────────────────────

  describe('clear() behavior', () => {
    it('clear() xóa pending map (kể cả đang in-flight)', async () => {
      let resolveAdapter!: () => void;
      const { instance, dedup } = makeWrappedInstance(async (config: any) => {
        await new Promise<void>((r) => { resolveAdapter = r; });
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
      });

      const pendingRequest = instance.request({ method: 'get', url: '/long' });

      // pending map có 1 entry
      await new Promise((r) => setTimeout(r, 10));
      expect(dedup.pendingCount).toBe(1);

      dedup.clear(); // xóa pending map
      expect(dedup.pendingCount).toBe(0);

      // Request vẫn chạy (adapter không bị cancel)
      resolveAdapter();
      await pendingRequest; // không throw
    });

    it('clear() trên dedup rỗng không throw', () => {
      const dedup = new Deduplicator();
      expect(() => dedup.clear()).not.toThrow();
      expect(dedup.pendingCount).toBe(0);
    });
  });

  // ── Dedup + concurrent nhiều requests ─────────────────────────────────────

  describe('concurrent dedup — nhiều callers nhận cùng response', () => {
    it('5 concurrent requests cùng URL → chỉ 1 HTTP call, tất cả nhận cùng data', async () => {
      let callCount = 0;
      const instance = axios.create();
      // Set adapter TRƯỜC wrap để deduplicator intercept được
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        await new Promise((r) => setTimeout(r, 30));
        return { data: { id: 'shared' }, status: 200, statusText: 'OK', headers: {}, config };
      };
      const dedup = new Deduplicator();
      dedup.wrap(instance);

      const results = await Promise.all(
        Array.from({ length: 5 }, () => instance.request({ method: 'get', url: '/resource' }))
      );

      expect(callCount).toBe(1);
      results.forEach((r) => {
        expect(r.data).toEqual({ id: 'shared' });
      });
    });

    it('requests khác nhau không chia sẻ promise', async () => {
      let callCount = 0;
      const urls = ['/a', '/b', '/c', '/d'];
      const { instance } = makeWrappedInstance(async (config: any) => {
        callCount++;
        await new Promise((r) => setTimeout(r, 10));
        return { data: { url: config.url }, status: 200, statusText: 'OK', headers: {}, config };
      });

      const results = await Promise.all(
        urls.map((url) => instance.request({ method: 'get', url }))
      );

      expect(callCount).toBe(4);
      results.forEach((r, i) => {
        expect(r.data.url).toBe(urls[i]);
      });
    });
  });
});
