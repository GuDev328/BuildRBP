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

  // ── Segment-based matching (fixed behavior) ──────────────────────────────────

  describe('segment-based matching (proper path prefix)', () => {
    /**
     * FIXED: handler { url: '/user' } KHÔNG còn match '/users'
     * vì implementation mới chỉ dùng exact match hoặc sub-path với trailing slash.
     *
     * Test này document behavior MỚI (correct behavior).
     */
    it('[FIXED] /user handler KHÔNG match /users (no sub-path)', async () => {
      const instance = axios.create();
      setupMockAdapter(instance, [
        { method: 'get', url: '/user', response: { matched: 'user-handler' }, status: 200 },
      ]);

      // Với new implementation, /users sẽ KHÔNG match /user handler (exact match only)
      await expect(instance.get('/users')).rejects.toBeDefined();
    });

    it('[FIXED] /api handler KHÔNG match /api/users (no sub-path)', async () => {
      const instance = axios.create();
      setupMockAdapter(instance, [
        { method: 'get', url: '/api', response: { scope: 'api' }, status: 200 },
      ]);

      await expect(instance.get('/api/users')).rejects.toBeDefined();
    });

    it('/users/ sub-path match với trailing slash', async () => {
      const instance = axios.create();
      setupMockAdapter(instance, [
        { method: 'get', url: '/users/', response: { all: true }, status: 200 },
      ]);

      // Handler với trailing slash match sub-paths
      const res = await instance.get('/users/123');
      expect(res.data).toEqual({ all: true });
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
      setupMockAdapter(instance, [
        { method: 'get', url: '/users', response: [], status: 200 },
      ]);

      // POST sẽ fallthrough sang original adapter → có thể throw network error
      // trong test environment (không có server thật)
      await expect(instance.post('/users', {})).rejects.toBeDefined();
    });

    it('GET handler không match PUT request', async () => {
      const instance = axios.create();
      setupMockAdapter(instance, [
        { method: 'get', url: '/users', response: [], status: 200 },
      ]);

      // PUT sẽ fallthrough → network error
      await expect(instance.put('/users', {})).rejects.toBeDefined();
    });

    it('GET handler không match DELETE request', async () => {
      const instance = axios.create();
      setupMockAdapter(instance, [
        { method: 'get', url: '/users', response: [], status: 200 },
      ]);

      // DELETE sẽ fallthrough → network error
      await expect(instance.delete('/users')).rejects.toBeDefined();
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
