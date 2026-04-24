/**
 * Issue #4 & #8: retryHandler — exponential backoff awareness + edge cases
 * Issue #8: buildRequestKey — GET request với body bị ignore
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { setupRetryInterceptor } from '../../src/features/retryHandler';
import { buildRequestKey } from '../../src/utils/buildRequestKey';

describe('retryHandler — exponential backoff edge cases', () => {
  // ── Exponential backoff delay verification ────────────────────────────────

  describe('exponential backoff — delay values', () => {
    it('delay = retryDelay * 2^attempt — verify qua timestamp', async () => {
      // Verify backoff bằng cách đo timestamp giữa các lần retry
      const callTimestamps: number[] = [];
      let callCount = 0;

      const instance = axios.create();
      instance.defaults.adapter = async (config: any) => {
        callTimestamps.push(Date.now());
        callCount++;
        throw new axios.AxiosError('Server Error', '500', config, undefined, {
          data: {}, status: 500, statusText: 'Error', headers: {}, config,
        } as any);
      };
      setupRetryInterceptor(instance, { maxRetries: 2, retryDelay: 20 });

      await expect(instance.get('/test')).rejects.toBeDefined();

      expect(callCount).toBe(3); // 1 + 2 retries

      // delay[0] = 20 * 2^0 = 20ms (giữa call 1 và 2)
      // delay[1] = 20 * 2^1 = 40ms (giữa call 2 và 3)
      const gap1 = callTimestamps[1] - callTimestamps[0];
      const gap2 = callTimestamps[2] - callTimestamps[1];

      // Verify gap tăng theo exponential (allow generous tolerance)
      expect(gap1).toBeGreaterThanOrEqual(15); // ~20ms
      expect(gap2).toBeGreaterThanOrEqual(30); // ~40ms
      expect(gap2).toBeGreaterThan(gap1); // gap tăng dần
    }, 10000); // timeout 10s

    it('delay có thể rất lớn với maxRetries cao (no upper bound)', () => {
      // Math-based test: verify công thức, không cần actual delay
      const retryDelay = 300;
      const maxRetries = 10;

      // Simulate delay calculation
      const delays = Array.from({ length: maxRetries }, (_, i) =>
        retryDelay * Math.pow(2, i)
      );

      expect(delays[0]).toBe(300);    // attempt 0: 300ms
      expect(delays[4]).toBe(4800);   // attempt 4: 300 * 16 = 4800ms
      expect(delays[9]).toBe(153600); // attempt 9: 300 * 512 = 153,600ms (~2.5 min)

      // Document: không có upper bound
      expect(delays[9]).toBeGreaterThan(100_000); // > 1 phút!
    });

    it('retryDelay=0 → không delay, chỉ retry count đúng', async () => {
      let callCount = 0;

      const instance = axios.create();
      instance.defaults.adapter = async (config: any) => {
        callCount++;
        throw new axios.AxiosError('Server Error', '500', config, undefined, {
          data: {}, status: 500, statusText: 'Error', headers: {}, config,
        } as any);
      };
      setupRetryInterceptor(instance, { maxRetries: 2, retryDelay: 0 });

      const start = Date.now();
      await expect(instance.get('/test')).rejects.toBeDefined();
      const elapsed = Date.now() - start;

      expect(callCount).toBe(3);
      // retryDelay=0 → không delay → xong rất nhanh
      expect(elapsed).toBeLessThan(200);
    });
  });
});

describe('buildRequestKey — GET body ignored (edge case)', () => {
  // ── GET request với body bị ignore ────────────────────────────────────────

  describe('GET + data body', () => {
    it('[DOCUMENTED BEHAVIOR] GET request với data khác nhau → cùng key', () => {
      // buildRequestKey bỏ qua data khi method === 'get'
      const key1 = buildRequestKey({ method: 'get', url: '/search', data: { q: 'hello' } });
      const key2 = buildRequestKey({ method: 'get', url: '/search', data: { q: 'world' } });

      // 2 GET requests với data khác nhau → cùng key (data bị ignore)
      expect(key1).toBe(key2);
    });

    it('GET request params khác nhau → key khác nhau (params được track)', () => {
      const key1 = buildRequestKey({ method: 'get', url: '/search', params: { q: 'hello' } });
      const key2 = buildRequestKey({ method: 'get', url: '/search', params: { q: 'world' } });

      expect(key1).not.toBe(key2);
    });

    it('POST request data khác nhau → key khác nhau', () => {
      const key1 = buildRequestKey({ method: 'post', url: '/search', data: { q: 'hello' } });
      const key2 = buildRequestKey({ method: 'post', url: '/search', data: { q: 'world' } });

      expect(key1).not.toBe(key2);
    });
  });

  // ── URL normalization ─────────────────────────────────────────────────────

  describe('URL normalization', () => {
    it('URL empty string → key vẫn được tạo', () => {
      const key = buildRequestKey({ method: 'get', url: '' });
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    });

    it('URL undefined → dùng empty string', () => {
      const key1 = buildRequestKey({ method: 'get', url: undefined });
      const key2 = buildRequestKey({ method: 'get', url: '' });
      expect(key1).toBe(key2);
    });
  });

  // ── Method normalization ──────────────────────────────────────────────────

  describe('method normalization', () => {
    it('method undefined → dùng get', () => {
      const key1 = buildRequestKey({ url: '/test' }); // no method
      const key2 = buildRequestKey({ method: 'get', url: '/test' });
      expect(key1).toBe(key2);
    });

    it('method uppercase/lowercase → cùng key', () => {
      const key1 = buildRequestKey({ method: 'GET', url: '/test' });
      const key2 = buildRequestKey({ method: 'get', url: '/test' });
      expect(key1).toBe(key2);
    });

    it('method POST uppercase → khác GET', () => {
      const key1 = buildRequestKey({ method: 'POST', url: '/test' });
      const key2 = buildRequestKey({ method: 'get', url: '/test' });
      expect(key1).not.toBe(key2);
    });
  });

  // ── Params sorting (idempotent) ───────────────────────────────────────────

  describe('params key sorting', () => {
    it('params object key ordering không ảnh hưởng key', () => {
      const key1 = buildRequestKey({ method: 'get', url: '/search', params: { a: 1, b: 2, c: 3 } });
      const key2 = buildRequestKey({ method: 'get', url: '/search', params: { c: 3, a: 1, b: 2 } });
      expect(key1).toBe(key2);
    });

    it('params là null/undefined → empty key part', () => {
      const key1 = buildRequestKey({ method: 'get', url: '/test', params: undefined });
      const key2 = buildRequestKey({ method: 'get', url: '/test', params: null });
      const key3 = buildRequestKey({ method: 'get', url: '/test' });
      expect(key1).toBe(key3);
      expect(key2).toBe(key3);
    });

    it('params với special character values', () => {
      const key1 = buildRequestKey({ method: 'get', url: '/search', params: { q: 'hello world' } });
      const key2 = buildRequestKey({ method: 'get', url: '/search', params: { q: 'hello+world' } });
      expect(key1).not.toBe(key2); // giá trị khác nhau → key khác nhau
    });
  });

  // ── Non-serializable params ───────────────────────────────────────────────

  describe('non-serializable params fallback', () => {
    it('params không serialize được → fallback String()', () => {
      // Circular reference
      const circular: any = { a: 1 };
      circular.self = circular;

      // Không throw
      const key = buildRequestKey({ method: 'get', url: '/test', params: circular });
      expect(typeof key).toBe('string');
    });

    it('data không serialize được → fallback String()', () => {
      const circular: any = { a: 1 };
      circular.self = circular;

      const key = buildRequestKey({ method: 'post', url: '/test', data: circular });
      expect(typeof key).toBe('string');
    });
  });

  // ── Output format ─────────────────────────────────────────────────────────

  describe('output format', () => {
    it('output là JSON array string: [method, url, params, data]', () => {
      const key = buildRequestKey({ method: 'get', url: '/users', params: { page: 1 } });
      // Key format: JSON.stringify([method, url, paramsStr, dataStr])
      // Actual output: '["get","/users","{"page":1}",""]'
      // Outer JSON array có 4 phần tử string
      expect(key).toMatch(/^\[.*\]$/);  // là array JSON
      // Parse để verify structure
      const parsed = JSON.parse(key);
      expect(parsed).toHaveLength(4);
      expect(parsed[0]).toBe('get');   // method
      expect(parsed[1]).toBe('/users'); // url
      expect(parsed[2]).toContain('page'); // params JSON
      expect(parsed[3]).toBe('');      // data (GET → empty)
    });

    it('key luôn là deterministic (cùng input → cùng output)', () => {
      const config = { method: 'get', url: '/users', params: { page: 1, limit: 10 } };
      const key1 = buildRequestKey(config);
      const key2 = buildRequestKey(config);
      expect(key1).toBe(key2);
    });
  });
});

describe('RetryHandler — retry signal cleanup', () => {
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

    // Lần đầu (callCount=1): có signal từ caller
    expect(signals[0]).toBe(controller.signal);
    // Lần retry (callCount=2): signal bị xóa (delete config.signal) trước retry
    // → adapter nhận config.signal = undefined
    expect(signals[1]).toBeUndefined();
  });

  it('429 Too Many Requests retry đúng số lần', async () => {
    let callCount = 0;
    const instance = axios.create();
    instance.defaults.adapter = async (config: any) => {
      callCount++;
      throw new axios.AxiosError('Too Many Requests', '429', config, undefined, {
        data: {}, status: 429, statusText: 'Too Many Requests', headers: {}, config,
      } as any);
    };
    setupRetryInterceptor(instance, { maxRetries: 2, retryDelay: 1 });

    await expect(instance.get('/test')).rejects.toBeDefined();
    expect(callCount).toBe(3); // 1 + 2 retries
  });
});
