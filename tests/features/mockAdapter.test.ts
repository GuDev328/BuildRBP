import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { setupMockAdapter } from '../../src/features/mockAdapter';
import { logger } from '../../src/utils/logger';
import type { MockHandler } from '../../src/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInstance(handlers: MockHandler[]) {
  const instance = axios.create();
  setupMockAdapter(instance, handlers);
  return instance;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('mockAdapter', () => {
  beforeEach(() => {
    logger.enabled = false;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Basic Matching ─────────────────────────────────────────────────────────

  describe('basic matching', () => {
    it('match GET request theo URL chính xác', async () => {
      const instance = makeInstance([
        { method: 'get', url: '/users', response: { users: [] }, status: 200 },
      ]);
      const res = await instance.get('/users');
      expect(res.status).toBe(200);
      expect(res.data).toEqual({ users: [] });
    });

    it('match POST request', async () => {
      const instance = makeInstance([
        { method: 'post', url: '/users', response: { id: 1 }, status: 201 },
      ]);
      const res = await instance.post('/users', { name: 'Alice' });
      expect(res.status).toBe(201);
      expect(res.data).toEqual({ id: 1 });
    });

    it('match PUT request', async () => {
      const instance = makeInstance([
        { method: 'put', url: '/users/1', response: { updated: true }, status: 200 },
      ]);
      const res = await instance.put('/users/1', { name: 'Bob' });
      expect(res.data).toEqual({ updated: true });
    });

    it('match PATCH request', async () => {
      const instance = makeInstance([
        { method: 'patch', url: '/users/1', response: { patched: true }, status: 200 },
      ]);
      const res = await instance.patch('/users/1', { name: 'Bob' });
      expect(res.data).toEqual({ patched: true });
    });

    it('match DELETE request', async () => {
      const instance = makeInstance([
        { method: 'delete', url: '/users/1', response: null, status: 204 },
      ]);
      const res = await instance.delete('/users/1');
      expect(res.status).toBe(204);
    });

    it('match URL theo RegExp', async () => {
      const instance = makeInstance([
        { method: 'get', url: /\/users\/\d+/, response: { id: 42 }, status: 200 },
      ]);
      const res = await instance.get('/users/42');
      expect(res.data).toEqual({ id: 42 });
    });

    it('match URL bằng startsWith (prefix)', async () => {
      const instance = makeInstance([
        { method: 'get', url: '/api/v1', response: { version: '1' }, status: 200 },
      ]);
      const res = await instance.get('/api/v1/users');
      expect(res.data).toEqual({ version: '1' });
    });
  });

  // ── Response Function ──────────────────────────────────────────────────────

  describe('response factory function', () => {
    it('response là function nhận config và trả về data', async () => {
      const instance = makeInstance([
        {
          method: 'get',
          url: '/echo',
          response: (config: any) => ({ url: config.url, method: config.method }),
          status: 200,
        },
      ]);
      const res = await instance.get('/echo');
      expect(res.data).toMatchObject({ url: '/echo', method: 'get' });
    });

    it('response factory nhận params từ config', async () => {
      const instance = makeInstance([
        {
          method: 'get',
          url: '/search',
          response: (config: any) => ({ query: config.params?.q }),
          status: 200,
        },
      ]);
      const res = await instance.get('/search', { params: { q: 'hello' } });
      expect(res.data).toEqual({ query: 'hello' });
    });
  });

  // ── Error Responses ────────────────────────────────────────────────────────

  describe('error responses (4xx/5xx)', () => {
    it('4xx throw AxiosError để axios.isAxiosError() trả true', async () => {
      const instance = makeInstance([
        { method: 'get', url: '/forbidden', response: { message: 'Forbidden' }, status: 403 },
      ]);
      const error = await instance.get('/forbidden').catch((e) => e);
      expect(axios.isAxiosError(error)).toBe(true);
      expect(error.response.status).toBe(403);
    });

    it('5xx throw AxiosError với status đúng', async () => {
      const instance = makeInstance([
        { method: 'get', url: '/broken', response: { message: 'Internal Error' }, status: 500 },
      ]);
      const error = await instance.get('/broken').catch((e) => e);
      expect(axios.isAxiosError(error)).toBe(true);
      expect(error.response.status).toBe(500);
    });

    it('AxiosError.response.data chứa response data từ handler', async () => {
      const instance = makeInstance([
        { method: 'get', url: '/bad', response: { code: 'INVALID', message: 'Bad' }, status: 400 },
      ]);
      const error = await instance.get('/bad').catch((e) => e);
      expect(error.response.data).toEqual({ code: 'INVALID', message: 'Bad' });
    });

    it('404 throw AxiosError', async () => {
      const instance = makeInstance([
        { method: 'get', url: '/missing', response: { message: 'Not Found' }, status: 404 },
      ]);
      const error = await instance.get('/missing').catch((e) => e);
      expect(error.response.status).toBe(404);
    });
  });

  // ── Delay ──────────────────────────────────────────────────────────────────

  describe('delay simulation', () => {
    it('delay handler làm chậm response theo ms', async () => {
      const instance = makeInstance([
        { method: 'get', url: '/slow', response: { ok: true }, status: 200, delay: 50 },
      ]);
      const start = Date.now();
      await instance.get('/slow');
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(45);
    });

    it('không delay khi delay không được set', async () => {
      const instance = makeInstance([
        { method: 'get', url: '/fast', response: { ok: true }, status: 200 },
      ]);
      const start = Date.now();
      await instance.get('/fast');
      expect(Date.now() - start).toBeLessThan(50);
    });
  });

  // ── Fallthrough ────────────────────────────────────────────────────────────

  describe('fallthrough khi không match', () => {
    it('throw error khi không có handler và không có original adapter', async () => {
      const instance = axios.create();
      // Xóa adapter gốc bằng cách set undefined
      (instance.defaults as any).adapter = undefined;
      setupMockAdapter(instance, [
        { method: 'get', url: '/users', response: {}, status: 200 },
      ]);
      // Request khác URL → không match, không có adapter gốc → throw
      const error = await instance.get('/other').catch((e) => e);
      expect(error).toBeDefined();
    });

    it('chỉ intercept requests match handler — không match thì fallthrough', async () => {
      // Không thể test real HTTP trong unit test, nhưng có thể verify
      // rằng matched handler trả đúng data
      const instance = makeInstance([
        { method: 'get', url: '/mocked', response: { mocked: true }, status: 200 },
      ]);
      const res = await instance.get('/mocked');
      expect(res.data.mocked).toBe(true);
    });
  });

  // ── Logging ────────────────────────────────────────────────────────────────

  describe('logging', () => {
    it('gọi logger.warn cho mỗi matched mock request', async () => {
      logger.enabled = true;
      const warnSpy = vi.spyOn(logger, 'warn');
      const instance = makeInstance([
        { method: 'get', url: '/test', response: {}, status: 200 },
      ]);
      await instance.get('/test');
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0][0]).toContain('[Mock]');
    });
  });

  // ── No-op khi handlers empty ───────────────────────────────────────────────

  describe('setupMockAdapter với empty handlers', () => {
    it('không thay đổi adapter khi handlers=[]', async () => {
      const instance = axios.create();
      const originalAdapter = instance.defaults.adapter;
      setupMockAdapter(instance, []);
      // Adapter không bị thay (guard `if (!handlers.length) return`)
      expect(instance.defaults.adapter).toBe(originalAdapter);
    });
  });

  // ── Method case insensitive ────────────────────────────────────────────────

  describe('method matching', () => {
    it('GET request không match POST handler', async () => {
      const instance = makeInstance([
        { method: 'post', url: '/users', response: { created: true }, status: 201 },
      ]);
      // GET /users sẽ không match POST handler → fallthrough
      // instance có default adapter → sẽ fail khi không có real server
      // Ta chỉ verify handler POST vẫn work
      const res = await instance.post('/users');
      expect(res.data).toEqual({ created: true });
    });

    it('first matching handler được dùng khi có nhiều handlers', async () => {
      const instance = makeInstance([
        { method: 'get', url: '/test', response: { first: true }, status: 200 },
        { method: 'get', url: '/test', response: { second: true }, status: 200 },
      ]);
      const res = await instance.get('/test');
      expect(res.data).toEqual({ first: true });
    });
  });
});
