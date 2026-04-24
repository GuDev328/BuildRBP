/**
 * Issue #1: mockAdapter URL matching quá rộng (startsWith)
 *
 * Vấn đề: Handler { url: '/user' } match cả '/users', '/user-profile'
 * vì dùng url.startsWith(handler.url).
 * Test file này document behavior hiện tại và các edge cases.
 */

import { describe, it, expect } from 'vitest';
import axios from 'axios';
import { setupMockAdapter } from '../../src/features/mockAdapter';
import type { MockHandler } from '../../src/types';

describe('mockAdapter — URL matching edge cases', () => {
  // ── Exact match ─────────────────────────────────────────────────────────────

  describe('exact URL match', () => {
    it('handler /user match chính xác /user', async () => {
      const instance = axios.create();
      setupMockAdapter(instance, [
        { method: 'get', url: '/user', response: { id: 1 }, status: 200 },
      ]);

      const res = await instance.get('/user');
      expect(res.data).toEqual({ id: 1 });
    });

    it('handler /users match /users', async () => {
      const instance = axios.create();
      setupMockAdapter(instance, [
        { method: 'get', url: '/users', response: [{ id: 1 }], status: 200 },
      ]);

      const res = await instance.get('/users');
      expect(res.data).toEqual([{ id: 1 }]);
    });
  });

  // ── startsWith behavior (current implementation) ──────────────────────────

  describe('startsWith behavior — documented behavior', () => {
    /**
     * DOCUMENTED BUG: handler { url: '/user' } cũng match '/users'
     * vì implementation dùng: url === handler.url || url.startsWith(handler.url)
     *
     * Test này document behavior HIỆN TẠI (không phải expected behavior tốt nhất).
     * Nếu fix bug → test này sẽ fail và cần cập nhật.
     */
    it('[CURRENT BEHAVIOR] /user handler match cả /users do startsWith', async () => {
      const instance = axios.create();
      setupMockAdapter(instance, [
        { method: 'get', url: '/user', response: { matched: 'user-handler' }, status: 200 },
      ]);

      // Với current implementation, /users sẽ match /user handler (startsWith)
      const res = await instance.get('/users');
      // Behavior hiện tại: match do startsWith → trả dữ liệu của handler /user
      expect(res.data).toEqual({ matched: 'user-handler' });
    });

    it('[CURRENT BEHAVIOR] /api handler match cả /api/users', async () => {
      const instance = axios.create();
      setupMockAdapter(instance, [
        { method: 'get', url: '/api', response: { scope: 'api' }, status: 200 },
      ]);

      const res = await instance.get('/api/users');
      expect(res.data).toEqual({ scope: 'api' });
    });
  });

  // ── Handler priority (first match wins) ───────────────────────────────────

  describe('handler priority — first match wins', () => {
    it('đặt handler cụ thể hơn trước → được ưu tiên', async () => {
      const instance = axios.create();
      setupMockAdapter(instance, [
        // Handler cụ thể hơn đặt TRƯỚC
        { method: 'get', url: '/users/1', response: { id: 1, specific: true }, status: 200 },
        { method: 'get', url: '/users', response: [{ id: 1 }], status: 200 },
      ]);

      const res1 = await instance.get('/users/1');
      expect(res1.data).toEqual({ id: 1, specific: true });

      const res2 = await instance.get('/users');
      expect(res2.data).toEqual([{ id: 1 }]);
    });
  });

  // ── Method mismatch ────────────────────────────────────────────────────────

  describe('method matching', () => {
    it('GET handler không match POST request', async () => {
      const instance = axios.create();
      // Handler chỉ GET
      setupMockAdapter(instance, [
        { method: 'get', url: '/users', response: [], status: 200 },
      ]);

      // POST sẽ fallthrough sang original adapter → có thể throw network error
      // trong test environment (không có server thật)
      await expect(instance.post('/users', {})).rejects.toBeDefined();
    });

    it('POST handler match đúng POST request', async () => {
      const instance = axios.create();
      setupMockAdapter(instance, [
        { method: 'post', url: '/users', response: { created: true }, status: 201 },
      ]);

      const res = await instance.post('/users', { name: 'Alice' });
      expect(res.data).toEqual({ created: true });
      expect(res.status).toBe(201);
    });
  });

  // ── RegExp URL matching ────────────────────────────────────────────────────

  describe('RegExp URL matching', () => {
    it('RegExp handler match đúng URL pattern', async () => {
      const instance = axios.create();
      setupMockAdapter(instance, [
        {
          method: 'get',
          url: /^\/users\/\d+$/,  // chỉ match /users/{number}
          response: { id: 42 },
          status: 200,
        },
      ]);

      const res = await instance.get('/users/42');
      expect(res.data).toEqual({ id: 42 });
    });

    it('RegExp handler không match URL ngoài pattern', async () => {
      const instance = axios.create();
      setupMockAdapter(instance, [
        {
          method: 'get',
          url: /^\/users\/\d+$/, // chỉ /users/{number}, không phải /users
          response: { id: 1 },
          status: 200,
        },
      ]);

      // /users không match /users/{number}
      await expect(instance.get('/users')).rejects.toBeDefined();
    });
  });

  // ── No matching handler ────────────────────────────────────────────────────

  describe('no matching handler', () => {
    it('throw khi không có handler và không có original adapter', async () => {
      const instance = axios.create();
      // Xóa bỏ original adapter bằng cách set adapter không có trong handlers
      setupMockAdapter(instance, [
        { method: 'get', url: '/specific', response: {}, status: 200 },
      ]);

      // /other không có handler → fallthrough sang original adapter (network error)
      await expect(instance.get('/other')).rejects.toBeDefined();
    });
  });

  // ── Response function ─────────────────────────────────────────────────────

  describe('dynamic response function', () => {
    it('response function nhận config và trả về dynamic data', async () => {
      const instance = axios.create();
      setupMockAdapter(instance, [
        {
          method: 'get',
          url: '/dynamic',
          response: (config: any) => ({ url: config.url, dynamic: true }),
          status: 200,
        },
      ]);

      const res = await instance.get('/dynamic');
      expect(res.data).toMatchObject({ dynamic: true });
    });
  });

  // ── delay option ──────────────────────────────────────────────────────────

  describe('handler delay', () => {
    it('delay làm chậm response đúng khoảng thời gian', async () => {
      const instance = axios.create();
      setupMockAdapter(instance, [
        { method: 'get', url: '/slow', response: { ok: true }, status: 200, delay: 50 },
      ]);

      const start = Date.now();
      await instance.get('/slow');
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(45); // allow small jitter
    });

    it('không delay khi không set delay option', async () => {
      const instance = axios.create();
      setupMockAdapter(instance, [
        { method: 'get', url: '/fast', response: { ok: true }, status: 200 },
      ]);

      const start = Date.now();
      await instance.get('/fast');
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50);
    });
  });
});
