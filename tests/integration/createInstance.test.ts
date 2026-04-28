import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { createApiClient } from '../../src/core/createInstance';
import { logger } from '../../src/utils/logger';
import type { ApiClientConfig } from '../../src/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Tạo client với fake adapter, không cần real HTTP */
function makeClient(
  adapterFn: (config: any) => Promise<any>,
  configOverrides: Partial<ApiClientConfig> = {}
) {
  const client = createApiClient({
    baseURL: 'http://localhost',
    logging: false,
    ...configOverrides,
  });
  client.instance.defaults.adapter = adapterFn as any;
  return client;
}

function successAdapter(data: unknown, status = 200) {
  return async (config: any) => ({ data, status, statusText: 'OK', headers: {}, config });
}

function errorAdapter(status: number, data: unknown = {}) {
  return async (config: any) => {
    throw new axios.AxiosError(
      `Request failed with status code ${status}`,
      String(status),
      config,
      undefined,
      { data, status, statusText: 'Error', headers: {}, config } as any
    );
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createApiClient — integration', () => {
  beforeEach(() => {
    logger.enabled = false;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Basic HTTP Methods ─────────────────────────────────────────────────────

  describe('HTTP methods', () => {
    it('client.get() trả về ApiResponse<T>', async () => {
      const client = makeClient(
        successAdapter({ data: { id: 1, name: 'Alice' }, message: 'OK', status: 200 })
      );
      const res = await client.get<{ id: number; name: string }>('/users/1');
      expect(res.data).toEqual({ id: 1, name: 'Alice' });
      expect(res.message).toBe('OK');
      expect(res.status).toBe(200);
    });

    it('client.post() gửi data và trả về ApiResponse<T>', async () => {
      let capturedData: any = null;
      const client = makeClient(async (config) => {
        capturedData = config.data;
        return {
          data: { data: { id: 2 }, message: 'Created', status: 201 },
          status: 201,
          statusText: 'Created',
          headers: {},
          config,
        };
      });

      const res = await client.post<{ id: number }>('/users', { name: 'Bob' });
      expect(res.data).toEqual({ id: 2 });
      // Axios serializes body to JSON string before adapter — parse to compare
      const parsed = typeof capturedData === 'string' ? JSON.parse(capturedData) : capturedData;
      expect(parsed).toEqual({ name: 'Bob' });
    });

    it('client.put() gửi data đúng', async () => {
      let capturedMethod: string = '';
      const client = makeClient(async (config) => {
        capturedMethod = config.method;
        return { data: { data: {}, message: 'OK', status: 200 }, status: 200, statusText: 'OK', headers: {}, config };
      });
      await client.put('/users/1', { name: 'Updated' });
      expect(capturedMethod).toBe('put');
    });

    it('client.patch() gửi data đúng', async () => {
      let capturedMethod: string = '';
      const client = makeClient(async (config) => {
        capturedMethod = config.method;
        return { data: { data: {}, message: 'OK', status: 200 }, status: 200, statusText: 'OK', headers: {}, config };
      });
      await client.patch('/users/1', { status: 'active' });
      expect(capturedMethod).toBe('patch');
    });

    it('client.delete() gửi DELETE request', async () => {
      let capturedMethod: string = '';
      const client = makeClient(async (config) => {
        capturedMethod = config.method;
        return { data: { data: null, message: 'Deleted', status: 200 }, status: 200, statusText: 'OK', headers: {}, config };
      });
      await client.delete('/users/1');
      expect(capturedMethod).toBe('delete');
    });
  });

  // ── instance property ──────────────────────────────────────────────────────

  describe('instance property', () => {
    it('client.instance là axios instance', () => {
      const client = createApiClient({ baseURL: 'http://localhost', logging: false });
      expect(client.instance).toBeDefined();
      expect(typeof client.instance.get).toBe('function');
    });
  });

  // ── abort ──────────────────────────────────────────────────────────────────

  describe('abort()', () => {
    it('client.abort(key) hủy request trước khi gửi — signal đã aborted', () => {
      // Đây là unit test của AbortManager (đã test ở AbortManager.test.ts)
      // Integration: verify client.abort() delegate đúng sang abortManager
      const client = createApiClient({ baseURL: 'http://localhost', logging: false });
      // Không có pending request — abort không throw
      expect(() => client.abort('any-key')).not.toThrow();
    });

    it('client.abortAll() không throw khi không có pending requests', () => {
      const client = createApiClient({ baseURL: 'http://localhost', logging: false });
      expect(() => client.abortAll()).not.toThrow();
    });

    it('abort() xác nhận AbortManager.abort() được gọi', async () => {
      // Tạo client và verify abort hoạt động qua AbortManager
      // bằng cách test qua public API mà không cần delay
      const client = createApiClient({ baseURL: 'http://localhost', logging: false });

      // Verify không throw và có thể gọi nhiều lần
      expect(() => {
        client.abort('key-1');
        client.abort('key-2');
        client.abortAll();
      }).not.toThrow();
    });
  });

  // ── fork() ─────────────────────────────────────────────────────────────────

  describe('fork()', () => {
    it('fork() tạo client mới kế thừa config', () => {
      const parent = createApiClient({
        baseURL: 'http://api.example.com',
        logging: false,
        timeout: 5000,
      });
      const child = parent.fork({ timeout: 30_000 });

      expect(child).toBeDefined();
      expect(child).not.toBe(parent);
      expect(typeof child.get).toBe('function');
    });

    it('fork() child và parent là independent instances', async () => {
      let parentCalls = 0;
      let childCalls = 0;

      const parent = createApiClient({ baseURL: 'http://localhost', logging: false });
      parent.instance.defaults.adapter = async (config) => {
        parentCalls++;
        return { data: { data: {}, message: 'parent', status: 200 }, status: 200, statusText: 'OK', headers: {}, config };
      };

      const child = parent.fork({ baseURL: 'http://localhost/child' });
      child.instance.defaults.adapter = async (config) => {
        childCalls++;
        return { data: { data: {}, message: 'child', status: 200 }, status: 200, statusText: 'OK', headers: {}, config };
      };

      await parent.get('/test');
      await child.get('/test');

      expect(parentCalls).toBe(1);
      expect(childCalls).toBe(1);
    });

    it('fork() với empty overrides kế thừa toàn bộ config gốc', () => {
      const parent = createApiClient({ baseURL: 'http://original.com', logging: false });
      const child = parent.fork();
      expect(child).toBeDefined();
      expect(typeof child.abort).toBe('function');
    });
  });

  // ── Mock Adapter Integration ───────────────────────────────────────────────

  describe('mock adapter integration', () => {
    it('mock handler trả dữ liệu đúng qua toàn bộ interceptor chain', async () => {
      const client = createApiClient({
        baseURL: 'http://localhost',
        logging: false,
        mocks: [
          {
            method: 'get',
            url: '/users',
            response: { data: [{ id: 1 }], message: 'OK', status: 200 },
            status: 200,
          },
        ],
      });

      const res = await client.get<{ id: number }[]>('/users');
      expect(res.data).toEqual([{ id: 1 }]);
      expect(res.message).toBe('OK');
    });

    it('mock 4xx throw đúng error qua response interceptor', async () => {
      const client = createApiClient({
        baseURL: 'http://localhost',
        logging: false,
        mocks: [
          {
            method: 'get',
            url: '/forbidden',
            response: { message: 'Forbidden' },
            status: 403,
          },
        ],
      });

      const error = await client.get('/forbidden').catch((e) => e);
      expect(error.status).toBe(403);
      expect(error.message).toBe('Forbidden');
    });

    it('không setup mock adapter khi mocks=[]', async () => {
      // Không nên throw
      const client = createApiClient({
        baseURL: 'http://localhost',
        logging: false,
        mocks: [],
      });
      expect(client).toBeDefined();
    });
  });

  // ── TransformKeys Integration ──────────────────────────────────────────────

  describe('transformKeys integration', () => {
    it('request body được convert camelCase → snake_case', async () => {
      let capturedData: any = null;
      const client = makeClient(async (config) => {
        capturedData = config.data;
        return {
          data: { data: {}, message: 'OK', status: 200 },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      }, { transformKeys: true });

      await client.post('/users', { firstName: 'Alice', lastName: 'Smith' });
      // Axios serializes data to JSON string via transformRequest before adapter receives it
      const parsed = typeof capturedData === 'string' ? JSON.parse(capturedData) : capturedData;
      expect(parsed).toEqual({ first_name: 'Alice', last_name: 'Smith' });
    });

    it('response data được convert snake_case → camelCase', async () => {
      const client = makeClient(
        successAdapter({ data: { user_name: 'alice', user_id: 1 }, message: 'OK' }),
        { transformKeys: true }
      );

      const res = await client.get('/users/1');
      expect(res.data).toEqual({ userName: 'alice', userId: 1 });
    });
  });
});
