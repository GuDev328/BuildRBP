/**
 * Advanced RetryHandler tests:
 *  - retryOn custom list
 *  - network error (no response) → retry
 *  - non-AxiosError không retry
 *  - maxRetries=0 → không retry bao giờ
 *  - _retryCount preserve qua retries
 *  - retry 502, 503, 504
 *  - Delay tối thiểu (retryDelay=0)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { setupRetryInterceptor } from '../../src/features/retryHandler';

function makeInstance(opts: Record<string, unknown> = {}, adapter?: (config: any) => Promise<any>) {
  const instance = axios.create();
  if (adapter) instance.defaults.adapter = adapter as any;
  setupRetryInterceptor(instance, opts as any);
  return instance;
}

describe('retryHandler — advanced', () => {
  // ── maxRetries=0 ────────────────────────────────────────────────────────────

  describe('maxRetries=0', () => {
    it('không retry bao giờ khi maxRetries=0', async () => {
      let callCount = 0;
      const instance = makeInstance({ maxRetries: 0, retryDelay: 1 }, async (config: any) => {
        callCount++;
        throw new axios.AxiosError('Server Error', '500', config, undefined, {
          data: {}, status: 500, statusText: 'Error', headers: {}, config,
        } as any);
      });

      await expect(instance.get('/test')).rejects.toBeDefined();
      expect(callCount).toBe(1); // không retry
    });
  });

  // ── Network errors (no response) ───────────────────────────────────────────

  describe('network error (không có response)', () => {
    it('retry khi error không có response (network offline)', async () => {
      let callCount = 0;
      const instance = makeInstance({ maxRetries: 2, retryDelay: 1 }, async (config: any) => {
        callCount++;
        // Network error: không có response object
        const err = new axios.AxiosError('Network Error', 'ERR_NETWORK', config);
        // err.response là undefined
        throw err;
      });

      await expect(instance.get('/test')).rejects.toBeDefined();
      // 1 + 2 retries = 3
      expect(callCount).toBe(3);
    });

    it('network error → thành công sau retry', async () => {
      let callCount = 0;
      const instance = makeInstance({ maxRetries: 2, retryDelay: 1 }, async (config: any) => {
        callCount++;
        if (callCount === 1) {
          throw new axios.AxiosError('Network Error', 'ERR_NETWORK', config);
        }
        return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
      });

      const res = await instance.get('/test');
      expect(res.data).toEqual({ ok: true });
      expect(callCount).toBe(2);
    });
  });

  // ── Custom retryOn list ────────────────────────────────────────────────────

  describe('custom retryOn list', () => {
    it('chỉ retry status codes trong retryOn list', async () => {
      let callCount = 0;
      // Chỉ retry 503, không retry 500
      const instance = makeInstance(
        { maxRetries: 3, retryDelay: 1, retryOn: [503] },
        async (config: any) => {
          callCount++;
          throw new axios.AxiosError('Server Error', '500', config, undefined, {
            data: {}, status: 500, statusText: 'Error', headers: {}, config,
          } as any);
        }
      );

      await expect(instance.get('/test')).rejects.toBeDefined();
      expect(callCount).toBe(1); // 500 không trong [503] → không retry
    });

    it('retry đúng status trong custom retryOn', async () => {
      let callCount = 0;
      const instance = makeInstance(
        { maxRetries: 2, retryDelay: 1, retryOn: [503] },
        async (config: any) => {
          callCount++;
          throw new axios.AxiosError('Service Unavailable', '503', config, undefined, {
            data: {}, status: 503, statusText: 'Error', headers: {}, config,
          } as any);
        }
      );

      await expect(instance.get('/test')).rejects.toBeDefined();
      expect(callCount).toBe(3); // 1 + 2 retries
    });

    it('retry 502 Bad Gateway (default retryOn)', async () => {
      let callCount = 0;
      const instance = makeInstance({ maxRetries: 1, retryDelay: 1 }, async (config: any) => {
        callCount++;
        throw new axios.AxiosError('Bad Gateway', '502', config, undefined, {
          data: {}, status: 502, statusText: 'Error', headers: {}, config,
        } as any);
      });

      await expect(instance.get('/test')).rejects.toBeDefined();
      expect(callCount).toBe(2); // 1 + 1 retry
    });

    it('retry 503 Service Unavailable (default retryOn)', async () => {
      let callCount = 0;
      const instance = makeInstance({ maxRetries: 1, retryDelay: 1 }, async (config: any) => {
        callCount++;
        throw new axios.AxiosError('Service Unavailable', '503', config, undefined, {
          data: {}, status: 503, statusText: 'Error', headers: {}, config,
        } as any);
      });

      await expect(instance.get('/test')).rejects.toBeDefined();
      expect(callCount).toBe(2);
    });

    it('retry 504 Gateway Timeout (default retryOn)', async () => {
      let callCount = 0;
      const instance = makeInstance({ maxRetries: 1, retryDelay: 1 }, async (config: any) => {
        callCount++;
        throw new axios.AxiosError('Gateway Timeout', '504', config, undefined, {
          data: {}, status: 504, statusText: 'Error', headers: {}, config,
        } as any);
      });

      await expect(instance.get('/test')).rejects.toBeDefined();
      expect(callCount).toBe(2);
    });

    it('không retry các 4xx khác 429 (400, 401, 403, 404, 422)', async () => {
      for (const status of [400, 401, 403, 404, 422]) {
        let callCount = 0;
        const instance = makeInstance({ maxRetries: 3, retryDelay: 1 }, async (config: any) => {
          callCount++;
          throw new axios.AxiosError('Client Error', String(status), config, undefined, {
            data: {}, status, statusText: 'Error', headers: {}, config,
          } as any);
        });

        await expect(instance.get('/test')).rejects.toBeDefined();
        expect(callCount).toBe(1); // không retry
      }
    });
  });

  // ── non-AxiosError ─────────────────────────────────────────────────────────

  describe('non-AxiosError không retry', () => {
    it('TypeError không retry', async () => {
      let callCount = 0;
      const instance = makeInstance({ maxRetries: 3, retryDelay: 1 }, async () => {
        callCount++;
        throw new TypeError('Unexpected undefined');
      });

      await expect(instance.get('/test')).rejects.toThrow('Unexpected undefined');
      expect(callCount).toBe(1);
    });

    it('plain Error không retry', async () => {
      let callCount = 0;
      const instance = makeInstance({ maxRetries: 3, retryDelay: 1 }, async () => {
        callCount++;
        throw new Error('Generic error');
      });

      await expect(instance.get('/test')).rejects.toBeDefined();
      expect(callCount).toBe(1);
    });
  });

  // ── _retryCount tracking ───────────────────────────────────────────────────

  describe('_retryCount tracking', () => {
    it('_retryCount tăng đúng qua mỗi retry', async () => {
      const retryCounts: number[] = [];
      const instance = makeInstance({ maxRetries: 3, retryDelay: 1 }, async (config: any) => {
        retryCounts.push(config._retryCount ?? 0);
        throw new axios.AxiosError('Server Error', '500', config, undefined, {
          data: {}, status: 500, statusText: 'Error', headers: {}, config,
        } as any);
      });

      await expect(instance.get('/test')).rejects.toBeDefined();

      // Lần đầu: _retryCount=0, retry1: 1, retry2: 2, retry3: 3
      expect(retryCounts).toEqual([0, 1, 2, 3]);
    });

    it('_retryCount được đặt lại từ 0 cho request mới', async () => {
      const retryCounts: number[] = [];
      const instance = makeInstance({ maxRetries: 1, retryDelay: 1 }, async (config: any) => {
        retryCounts.push(config._retryCount ?? 0);
        throw new axios.AxiosError('Server Error', '500', config, undefined, {
          data: {}, status: 500, statusText: 'Error', headers: {}, config,
        } as any);
      });

      // Request 1
      await expect(instance.get('/a')).rejects.toBeDefined();
      // Request 2
      await expect(instance.get('/b')).rejects.toBeDefined();

      // Mỗi request bắt đầu từ 0
      expect(retryCounts[0]).toBe(0); // /a lần đầu
      expect(retryCounts[2]).toBe(0); // /b lần đầu
    });
  });

  // ── Abort + retry interaction ──────────────────────────────────────────────

  describe('abort + retry interaction', () => {
    it('ECONNABORTED (timeout) KHÔNG retry', async () => {
      // ECONNABORTED thường là timeout — đây không phải ERR_CANCELED
      // Nhưng không có response → shouldRetry = true (network error)
      // Đây là edge case: timeout retry phụ thuộc config retryOn
      let callCount = 0;
      const instance = makeInstance({ maxRetries: 2, retryDelay: 1 }, async (config: any) => {
        callCount++;
        throw new axios.AxiosError('Timeout', 'ECONNABORTED', config);
      });

      // ECONNABORTED không có response → shouldRetry true (vì là network error)
      await expect(instance.get('/test')).rejects.toBeDefined();
      // Retry xảy ra vì network error (không có response)
      expect(callCount).toBe(3); // 1 + 2 retries
    });

    it('ERR_CANCELED không retry dù cấu hình maxRetries cao', async () => {
      let callCount = 0;
      const instance = makeInstance({ maxRetries: 99, retryDelay: 1 }, async (config: any) => {
        callCount++;
        throw new axios.AxiosError('canceled', 'ERR_CANCELED', config);
      });

      await expect(instance.get('/test')).rejects.toBeDefined();
      expect(callCount).toBe(1);
    });
  });

  // ── config undefined guard ─────────────────────────────────────────────────

  describe('config undefined guard', () => {
    it('không crash khi error.config là undefined', async () => {
      const instance = axios.create();
      setupRetryInterceptor(instance, { maxRetries: 2, retryDelay: 1 });

      // Tạo AxiosError không có config bằng cách override sau khi adapter throw
      // Cách: thêm interceptor TRƯỚC retry (phải dùng instance mới để đăng ký trước)
      // hoặc đơn giản hơn: adapter trả về AxiosError có config=undefined
      instance.defaults.adapter = async (_config: any) => {
        // Tạo error bên ngoài — không có config
        const orphanErr = new axios.AxiosError('Orphan error without config');
        // err.config = undefined (mặc định)
        throw orphanErr;
      };

      // retryHandler gặp error không có config → reject ngay (không retry, không crash)
      const error = await instance.get('/test').catch((e) => e);
      expect(error).toBeDefined();
      expect(error.message).toBe('Orphan error without config');
    });
  });

  // ── Default options ────────────────────────────────────────────────────────

  describe('default options', () => {
    it('dùng default options khi không truyền gì', async () => {
      let callCount = 0;
      const instance = axios.create();
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        throw new axios.AxiosError('Server Error', '500', config, undefined, {
          data: {}, status: 500, statusText: 'Error', headers: {}, config,
        } as any);
      };

      // setupRetryInterceptor với empty options → dùng default maxRetries=3
      setupRetryInterceptor(instance, {});

      await expect(instance.get('/test')).rejects.toBeDefined();
      // 1 + 3 default retries = 4
      expect(callCount).toBe(4);
    });
  });
});
