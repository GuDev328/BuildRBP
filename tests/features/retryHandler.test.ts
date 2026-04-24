import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { setupRetryInterceptor } from '../../src/features/retryHandler';

// Helper tạo axios instance + retry với fake adapter
function makeInstance(opts = {}, adapter?: (config: any) => Promise<any>) {
  const instance = axios.create();
  if (adapter) instance.defaults.adapter = adapter as any;
  setupRetryInterceptor(instance, opts);
  return instance;
}

describe('retryHandler', () => {
  describe('shouldRetry — không retry khi bị abort', () => {
    it('không retry khi ERR_CANCELED', async () => {
      let callCount = 0;
      const instance = makeInstance({ maxRetries: 3 }, async () => {
        callCount++;
        const err = new axios.AxiosError('canceled', 'ERR_CANCELED');
        throw err;
      });

      await expect(instance.get('/test')).rejects.toMatchObject({ code: 'ERR_CANCELED' });
      // Chỉ gọi 1 lần — không retry
      expect(callCount).toBe(1);
    });

    it('không retry khi AbortError', async () => {
      let callCount = 0;
      const instance = makeInstance({ maxRetries: 3 }, async () => {
        callCount++;
        const err = Object.assign(new Error('aborted'), { name: 'AbortError', isAxiosError: true });
        throw err;
      });

      await expect(instance.get('/test')).rejects.toBeDefined();
      expect(callCount).toBe(1);
    });
  });

  describe('retry logic', () => {
    it('retry đúng số lần maxRetries với 500', async () => {
      let callCount = 0;
      const instance = makeInstance({ maxRetries: 2, retryDelay: 1 }, async (config: any) => {
        callCount++;
        throw new axios.AxiosError('Server Error', '500', config, null, {
          status: 500, statusText: 'Server Error', data: {}, headers: {}, config,
        } as any);
      });

      await expect(instance.get('/test')).rejects.toBeDefined();
      // 1 lần đầu + 2 lần retry = 3
      expect(callCount).toBe(3);
    });

    it('không retry 4xx (ngoại trừ 429)', async () => {
      let callCount = 0;
      const instance = makeInstance({ maxRetries: 3, retryDelay: 1 }, async (config: any) => {
        callCount++;
        throw new axios.AxiosError('Not Found', '404', config, null, {
          status: 404, statusText: 'Not Found', data: {}, headers: {}, config,
        } as any);
      });

      await expect(instance.get('/test')).rejects.toBeDefined();
      expect(callCount).toBe(1); // không retry 404
    });

    it('retry 429 Too Many Requests', async () => {
      let callCount = 0;
      const instance = makeInstance({ maxRetries: 1, retryDelay: 1 }, async (config: any) => {
        callCount++;
        throw new axios.AxiosError('Too Many Requests', '429', config, null, {
          status: 429, statusText: 'Too Many Requests', data: {}, headers: {}, config,
        } as any);
      });

      await expect(instance.get('/test')).rejects.toBeDefined();
      expect(callCount).toBe(2); // 1 + 1 retry
    });

    it('thành công sau khi retry', async () => {
      let callCount = 0;
      const instance = makeInstance({ maxRetries: 2, retryDelay: 1 }, async (config: any) => {
        callCount++;
        if (callCount < 2) {
          throw new axios.AxiosError('Server Error', '500', config, null, {
            status: 500, statusText: 'Server Error', data: {}, headers: {}, config,
          } as any);
        }
        return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
      });

      const res = await instance.get('/test');
      expect(res.data).toEqual({ ok: true });
      expect(callCount).toBe(2);
    });
  });

  describe('exponential backoff', () => {
    it('tính delay đúng công thức: retryDelay * 2^attempt', async () => {
      const delays: number[] = [];
      const originalSetTimeout = globalThis.setTimeout;
      vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: any, ms?: number) => {
        delays.push(ms ?? 0);
        return originalSetTimeout(fn, 0); // chạy ngay không delay thật
      });

      let callCount = 0;
      const instance = makeInstance({ maxRetries: 3, retryDelay: 100 }, async (config: any) => {
        callCount++;
        throw new axios.AxiosError('err', '500', config, null, {
          status: 500, statusText: '', data: {}, headers: {}, config,
        } as any);
      });

      await expect(instance.get('/test')).rejects.toBeDefined();

      vi.restoreAllMocks();

      // delays = [100*2^0, 100*2^1, 100*2^2] = [100, 200, 400]
      expect(delays[0]).toBe(100);
      expect(delays[1]).toBe(200);
      expect(delays[2]).toBe(400);
    });
  });
});
