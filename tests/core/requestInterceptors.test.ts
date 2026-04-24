import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { setupRequestInterceptors } from '../../src/core/interceptors/requestInterceptors';
import { AbortManager } from '../../src/core/AbortManager';
import { logger } from '../../src/utils/logger';
import type { ApiClientConfig } from '../../src/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSetup(configOverrides: Partial<ApiClientConfig> = {}) {
  const instance: AxiosInstance = axios.create();
  const abortManager = new AbortManager();
  const config: ApiClientConfig = {
    baseURL: 'http://localhost',
    ...configOverrides,
  };
  setupRequestInterceptors(instance, config, abortManager);
  return { instance, abortManager, config };
}

/**
 * Capture config sau khi đi qua request interceptors bằng cách
 * dùng fake adapter — trả về response ngay mà không gửi HTTP thật.
 */
async function captureRequestConfig(
  instance: AxiosInstance,
  requestFn: () => Promise<unknown>
): Promise<InternalAxiosRequestConfig> {
  let captured: InternalAxiosRequestConfig | null = null;
  instance.defaults.adapter = async (config) => {
    captured = config as InternalAxiosRequestConfig;
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  };
  await requestFn();
  return captured!;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('requestInterceptors', () => {
  beforeEach(() => {
    // Enable logger để test logging paths
    logger.enabled = true;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Trace Headers ──────────────────────────────────────────────────────────

  describe('trace headers', () => {
    it('inject x-request-id vào mỗi request', async () => {
      const { instance } = makeSetup();
      const cfg = await captureRequestConfig(instance, () => instance.get('/test'));
      expect(cfg.headers['x-request-id']).toBeDefined();
      expect(typeof cfg.headers['x-request-id']).toBe('string');
    });

    it('inject x-trace-id vào mỗi request', async () => {
      const { instance } = makeSetup();
      const cfg = await captureRequestConfig(instance, () => instance.get('/test'));
      expect(cfg.headers['x-trace-id']).toBeDefined();
    });

    it('x-request-id có giá trị khác nhau giữa 2 requests', async () => {
      const { instance } = makeSetup();
      const ids: string[] = [];
      instance.defaults.adapter = async (config) => {
        ids.push((config as InternalAxiosRequestConfig).headers['x-request-id'] as string);
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
      };
      await instance.get('/a');
      await instance.get('/b');
      expect(ids[0]).not.toBe(ids[1]);
    });

    it('x-request-id format là "timestamp-counter"', async () => {
      const { instance } = makeSetup();
      const cfg = await captureRequestConfig(instance, () => instance.get('/test'));
      const id = cfg.headers['x-request-id'] as string;
      expect(id).toMatch(/^\d+-\d+$/);
    });
  });

  // ── _startTime & _retryCount ───────────────────────────────────────────────

  describe('metadata injection', () => {
    it('set _startTime trên mỗi request', async () => {
      const { instance } = makeSetup();
      const before = Date.now();
      const cfg = await captureRequestConfig(instance, () => instance.get('/test'));
      const after = Date.now();
      expect(cfg._startTime).toBeGreaterThanOrEqual(before);
      expect(cfg._startTime).toBeLessThanOrEqual(after);
    });

    it('set _retryCount = 0 khi chưa có', async () => {
      const { instance } = makeSetup();
      const cfg = await captureRequestConfig(instance, () => instance.get('/test'));
      expect(cfg._retryCount).toBe(0);
    });

    it('giữ nguyên _retryCount nếu đã được set bởi retryHandler', async () => {
      const { instance } = makeSetup();
      let captured: InternalAxiosRequestConfig | null = null;
      instance.defaults.adapter = async (config) => {
        captured = config as InternalAxiosRequestConfig;
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
      };
      // Giả lập retryHandler đã set _retryCount = 2
      await instance.request({ method: 'get', url: '/test', _retryCount: 2 } as any);
      expect(captured!._retryCount).toBe(2);
    });
  });

  // ── Authorization ──────────────────────────────────────────────────────────

  describe('Authorization header', () => {
    it('inject Bearer token khi tokenRefresh được cấu hình và getAccessToken trả về token', async () => {
      const { instance } = makeSetup({
        tokenRefresh: {
          refreshFn: async () => 'new-token',
          getAccessToken: () => 'my-access-token',
        },
      });
      const cfg = await captureRequestConfig(instance, () => instance.get('/test'));
      expect(cfg.headers['Authorization']).toBe('Bearer my-access-token');
    });

    it('không inject Authorization khi getAccessToken trả về null', async () => {
      const { instance } = makeSetup({
        tokenRefresh: {
          refreshFn: async () => 'new-token',
          getAccessToken: () => null,
        },
      });
      const cfg = await captureRequestConfig(instance, () => instance.get('/test'));
      // Header có thể undefined hoặc không tồn tại
      expect(cfg.headers['Authorization']).toBeUndefined();
    });

    it('không inject Authorization khi không có tokenRefresh config', async () => {
      const { instance } = makeSetup();
      const cfg = await captureRequestConfig(instance, () => instance.get('/test'));
      expect(cfg.headers['Authorization']).toBeUndefined();
    });
  });

  // ── Transform Keys ─────────────────────────────────────────────────────────

  describe('transformKeys — camelCase → snake_case', () => {
    /**
     * Axios's default transformRequest serializes request.data to a JSON string
     * before passing it to the adapter. We need to JSON.parse it to compare objects.
     */
    function parseData(data: unknown): unknown {
      if (typeof data === 'string') {
        try { return JSON.parse(data); } catch { return data; }
      }
      return data;
    }

    it('transform request body khi transformKeys=true', async () => {
      const { instance } = makeSetup({ transformKeys: true });
      const cfg = await captureRequestConfig(instance, () =>
        instance.post('/test', { firstName: 'John', lastName: 'Doe' })
      );
      expect(parseData(cfg.data)).toEqual({ first_name: 'John', last_name: 'Doe' });
    });

    it('không transform body khi transformKeys=false (default)', async () => {
      const { instance } = makeSetup({ transformKeys: false });
      const cfg = await captureRequestConfig(instance, () =>
        instance.post('/test', { firstName: 'John' })
      );
      expect(parseData(cfg.data)).toEqual({ firstName: 'John' });
    });

    it('không transform khi data là null/undefined', async () => {
      const { instance } = makeSetup({ transformKeys: true });
      const cfg = await captureRequestConfig(instance, () => instance.get('/test'));
      // GET không có body → data undefined/null → không crash
      expect(cfg.data).toBeUndefined();
    });

    it('transform nested objects đệ quy', async () => {
      const { instance } = makeSetup({ transformKeys: true });
      const cfg = await captureRequestConfig(instance, () =>
        instance.post('/test', {
          userInfo: { firstName: 'John', addressData: { zipCode: '12345' } },
        })
      );
      expect(parseData(cfg.data)).toEqual({
        user_info: { first_name: 'John', address_data: { zip_code: '12345' } },
      });
    });
  });

  // ── AbortController ────────────────────────────────────────────────────────

  describe('AbortController injection', () => {
    it('inject AbortSignal khi không có signal trong config', async () => {
      const { instance } = makeSetup();
      const cfg = await captureRequestConfig(instance, () => instance.get('/test'));
      expect(cfg.signal).toBeDefined();
      expect(cfg.signal).toBeInstanceOf(AbortSignal);
    });

    it('set _abortKey trên config', async () => {
      const { instance } = makeSetup();
      const cfg = await captureRequestConfig(instance, () => instance.get('/test'));
      expect(cfg._abortKey).toBeDefined();
      expect(typeof cfg._abortKey).toBe('string');
    });

    it('không override signal nếu caller đã pass', async () => {
      const { instance } = makeSetup();
      const controller = new AbortController();
      const originalSignal = controller.signal;
      let captured: InternalAxiosRequestConfig | null = null;
      instance.defaults.adapter = async (config) => {
        captured = config as InternalAxiosRequestConfig;
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
      };
      await instance.get('/test', { signal: originalSignal });
      expect(captured!.signal).toBe(originalSignal);
    });

    it('tăng pendingCount sau khi register', async () => {
      const { instance, abortManager } = makeSetup();
      let pendingDuringRequest = 0;
      instance.defaults.adapter = async (config) => {
        pendingDuringRequest = abortManager.pendingCount;
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
      };
      await instance.get('/test');
      expect(pendingDuringRequest).toBeGreaterThan(0);
    });
  });

  // ── Logging ────────────────────────────────────────────────────────────────

  describe('logging', () => {
    it('gọi logger.request khi logging=true (default)', async () => {
      const logSpy = vi.spyOn(logger, 'request');
      const { instance } = makeSetup({ logging: true });
      await captureRequestConfig(instance, () => instance.get('/test'));
      expect(logSpy).toHaveBeenCalledOnce();
    });

    it('không gọi logger.request khi logging=false', async () => {
      const logSpy = vi.spyOn(logger, 'request');
      const { instance } = makeSetup({ logging: false });
      await captureRequestConfig(instance, () => instance.get('/test'));
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('logger.request nhận đúng method và url', async () => {
      const logSpy = vi.spyOn(logger, 'request');
      const { instance } = makeSetup({ logging: true });
      await captureRequestConfig(instance, () => instance.post('/users'));
      const callArg = logSpy.mock.calls[0][0];
      expect(callArg.method).toBe('post');
      expect(callArg.url).toBe('/users');
    });
  });
});
