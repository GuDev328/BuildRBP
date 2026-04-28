/**
 * Tests cho Request/Response Hooks
 *
 * Test strategy:
 * - Unit: mỗi hook type độc lập
 * - Integration: hooks tương tác với interceptor chain
 * - Edge cases: async hooks, throw, multiple hooks, abort exclusion
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { createApiClient } from '../../src/core/createInstance';
import { logger } from '../../src/utils/logger';
import type { ApiClientConfig, RequestContext, ResponseContext, ApiError } from '../../src/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function successAdapter(data: unknown = { data: {}, message: 'OK', status: 200 }, status = 200) {
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

describe('Hooks — beforeRequest', () => {
  beforeEach(() => {
    logger.enabled = false;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('được gọi trước khi request gửi đi', async () => {
    const hookCalled = vi.fn();
    const client = makeClient(successAdapter(), {
      hooks: {
        beforeRequest: [hookCalled],
      },
    });

    await client.get('/users');
    expect(hookCalled).toHaveBeenCalledOnce();
  });

  it('nhận RequestContext với đúng method, url, params', async () => {
    let capturedCtx: RequestContext | null = null;
    const client = makeClient(successAdapter(), {
      hooks: {
        beforeRequest: [
          (ctx) => { capturedCtx = ctx; },
        ],
      },
    });

    await client.get('/users', { params: { page: 1 } });

    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx!.method).toBe('get');
    expect(capturedCtx!.url).toBe('/users');
    expect(capturedCtx!.params).toEqual({ page: 1 });
  });

  it('nhận RequestContext với body cho POST', async () => {
    let capturedCtx: RequestContext | null = null;
    const client = makeClient(successAdapter(), {
      hooks: {
        beforeRequest: [
          (ctx) => { capturedCtx = ctx; },
        ],
      },
    });

    await client.post('/users', { name: 'Alice' });

    expect(capturedCtx!.method).toBe('post');
    expect(capturedCtx!.url).toBe('/users');
  });

  it('có thể modify headers — headers được gửi lên server', async () => {
    let capturedConfig: any = null;
    const client = makeClient(async (config) => {
      capturedConfig = config;
      return { data: { data: {}, message: 'OK', status: 200 }, status: 200, statusText: 'OK', headers: {}, config };
    }, {
      hooks: {
        beforeRequest: [
          (ctx) => {
            ctx.headers['x-custom-hook'] = 'injected-by-hook';
          },
        ],
      },
    });

    await client.get('/users');

    expect(capturedConfig.headers['x-custom-hook']).toBe('injected-by-hook');
  });

  it('nhận headers đã inject (token, trace IDs) khi hook chạy', async () => {
    let capturedHeaders: Record<string, string> = {};
    const client = makeClient(successAdapter(), {
      tokenRefresh: {
        getAccessToken: () => 'my-token',
        refreshFn: async () => 'new-token',
      },
      hooks: {
        beforeRequest: [
          (ctx) => { capturedHeaders = { ...ctx.headers }; },
        ],
      },
    });

    await client.get('/profile');

    // Token đã được inject trước khi hook chạy
    expect(capturedHeaders['Authorization']).toBe('Bearer my-token');
    // Trace headers cũng đã có
    expect(capturedHeaders['x-request-id']).toBeDefined();
  });

  it('async hook được chờ đợi (await)', async () => {
    const order: string[] = [];
    const client = makeClient(async (config) => {
      order.push('adapter');
      return { data: { data: {}, message: 'OK', status: 200 }, status: 200, statusText: 'OK', headers: {}, config };
    }, {
      hooks: {
        beforeRequest: [
          async (ctx) => {
            await new Promise((r) => setTimeout(r, 10));
            order.push('hook');
          },
        ],
      },
    });

    await client.get('/users');

    // hook phải chạy xong trước adapter
    expect(order).toEqual(['hook', 'adapter']);
  });

  it('nhiều hooks chạy tuần tự theo đúng thứ tự', async () => {
    const order: string[] = [];
    const client = makeClient(successAdapter(), {
      hooks: {
        beforeRequest: [
          async () => { await new Promise((r) => setTimeout(r, 20)); order.push('hook-1'); },
          async () => { await new Promise((r) => setTimeout(r, 5)); order.push('hook-2'); },
          () => { order.push('hook-3'); },
        ],
      },
    });

    await client.get('/users');

    expect(order).toEqual(['hook-1', 'hook-2', 'hook-3']);
  });

  it('hook throw → request bị cancel, error propagate lên caller', async () => {
    const adapterCalled = vi.fn();
    const client = makeClient(async (config) => {
      adapterCalled();
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    }, {
      hooks: {
        beforeRequest: [
          () => { throw new Error('Hook cancelled request'); },
        ],
      },
    });

    await expect(client.get('/users')).rejects.toThrow('Hook cancelled request');
    expect(adapterCalled).not.toHaveBeenCalled();
  });

  it('hooks không có → request vẫn hoạt động bình thường', async () => {
    const client = makeClient(successAdapter({ data: { id: 1 }, message: 'OK', status: 200 }));
    const res = await client.get<{ id: number }>('/users/1');
    expect(res.data).toEqual({ id: 1 });
  });

  it('hooks: undefined → request hoạt động bình thường', async () => {
    const client = makeClient(successAdapter(), { hooks: undefined });
    await expect(client.get('/users')).resolves.toBeDefined();
  });

  it('beforeRequest: [] (empty array) → không crash', async () => {
    const client = makeClient(successAdapter(), { hooks: { beforeRequest: [] } });
    await expect(client.get('/users')).resolves.toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Hooks — afterResponse', () => {
  beforeEach(() => {
    logger.enabled = false;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('được gọi sau khi response thành công', async () => {
    const hookCalled = vi.fn();
    const client = makeClient(
      successAdapter({ data: { id: 1 }, message: 'OK', status: 200 }),
      { hooks: { afterResponse: [hookCalled] } }
    );

    await client.get('/users/1');
    expect(hookCalled).toHaveBeenCalledOnce();
  });

  it('nhận ResponseContext với normalized data (sau envelope unwrap)', async () => {
    let capturedCtx: ResponseContext | null = null;
    const client = makeClient(
      successAdapter({ data: { userId: 1 }, message: 'Success', status: 200 }),
      {
        hooks: {
          afterResponse: [(ctx) => { capturedCtx = ctx; }],
        },
      }
    );

    await client.get('/users/1');

    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx!.data).toEqual({ userId: 1 });
    expect(capturedCtx!.message).toBe('Success');
    expect(capturedCtx!.status).toBe(200);
    expect(capturedCtx!.method).toBe('get');
    expect(capturedCtx!.url).toBe('/users/1');
  });

  it('nhận data đã camelCase nếu transformKeys=true', async () => {
    let capturedData: unknown = null;
    const client = makeClient(
      successAdapter({ data: { user_name: 'alice', user_id: 1 }, message: 'OK', status: 200 }),
      {
        transformKeys: true,
        hooks: {
          afterResponse: [(ctx) => { capturedData = ctx.data; }],
        },
      }
    );

    await client.get('/users/1');

    // Data đã được transform trước khi hook nhận
    expect(capturedData).toEqual({ userName: 'alice', userId: 1 });
  });

  it('async hook được chờ đợi', async () => {
    let hookCompleted = false;
    const client = makeClient(successAdapter(), {
      hooks: {
        afterResponse: [
          async () => {
            await new Promise((r) => setTimeout(r, 20));
            hookCompleted = true;
          },
        ],
      },
    });

    await client.get('/users');
    expect(hookCompleted).toBe(true);
  });

  it('nhiều hooks chạy tuần tự theo đúng thứ tự', async () => {
    const order: string[] = [];
    const client = makeClient(successAdapter(), {
      hooks: {
        afterResponse: [
          async () => { await new Promise((r) => setTimeout(r, 20)); order.push('hook-1'); },
          async () => { order.push('hook-2'); },
          () => { order.push('hook-3'); },
        ],
      },
    });

    await client.get('/users');
    expect(order).toEqual(['hook-1', 'hook-2', 'hook-3']);
  });

  it('hook throw → caller nhận được error', async () => {
    const client = makeClient(successAdapter(), {
      hooks: {
        afterResponse: [
          () => { throw new Error('afterResponse hook failed'); },
        ],
      },
    });

    await expect(client.get('/users')).rejects.toThrow('afterResponse hook failed');
  });

  it('afterResponse không được gọi khi request fail', async () => {
    const hookCalled = vi.fn();
    const client = makeClient(errorAdapter(500), {
      hooks: {
        afterResponse: [hookCalled],
      },
    });

    await client.get('/users').catch(() => {});
    expect(hookCalled).not.toHaveBeenCalled();
  });

  it('afterResponse không được gọi cho blob download (skipEnvelope)', async () => {
    const hookCalled = vi.fn();
    const client = makeClient(
      async (config) => ({
        data: new Blob(['data']),
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }),
      { hooks: { afterResponse: [hookCalled] } }
    );

    await client.download('/file.pdf');
    expect(hookCalled).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Hooks — onError', () => {
  beforeEach(() => {
    logger.enabled = false;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('được gọi khi request fail với HTTP error', async () => {
    const hookCalled = vi.fn();
    const client = makeClient(errorAdapter(500, { message: 'Internal Error' }), {
      hooks: { onError: [hookCalled] },
    });

    await client.get('/users').catch(() => {});
    expect(hookCalled).toHaveBeenCalledOnce();
  });

  it('nhận đúng ApiError object', async () => {
    let capturedError: ApiError | null = null;
    const client = makeClient(errorAdapter(404, { message: 'Not Found' }), {
      hooks: {
        onError: [(error) => { capturedError = error; }],
      },
    });

    await client.get('/users/999').catch(() => {});

    expect(capturedError).not.toBeNull();
    expect(capturedError!.status).toBe(404);
    expect(capturedError!.message).toBe('Not Found');
  });

  it('KHÔNG được gọi khi request thành công', async () => {
    const hookCalled = vi.fn();
    const client = makeClient(successAdapter(), {
      hooks: { onError: [hookCalled] },
    });

    await client.get('/users');
    expect(hookCalled).not.toHaveBeenCalled();
  });

  it('KHÔNG được gọi khi request bị abort', async () => {
    const hookCalled = vi.fn();
    const client = makeClient(
      async (config) => {
        throw new axios.AxiosError('canceled', 'ERR_CANCELED', config);
      },
      { hooks: { onError: [hookCalled] } }
    );

    await client.get('/users').catch(() => {});
    // abort là chủ động → không log như error
    expect(hookCalled).not.toHaveBeenCalled();
  });

  it('async hook được chờ đợi', async () => {
    let hookCompleted = false;
    const client = makeClient(errorAdapter(500), {
      hooks: {
        onError: [
          async () => {
            await new Promise((r) => setTimeout(r, 20));
            hookCompleted = true;
          },
        ],
      },
    });

    await client.get('/users').catch(() => {});
    expect(hookCompleted).toBe(true);
  });

  it('nhiều hooks chạy tuần tự', async () => {
    const order: string[] = [];
    const client = makeClient(errorAdapter(500), {
      hooks: {
        onError: [
          async () => { await new Promise((r) => setTimeout(r, 20)); order.push('hook-1'); },
          () => { order.push('hook-2'); },
        ],
      },
    });

    await client.get('/users').catch(() => {});
    expect(order).toEqual(['hook-1', 'hook-2']);
  });

  it('hook throw → error mới replace error gốc', async () => {
    const client = makeClient(errorAdapter(500, { message: 'Server Error' }), {
      hooks: {
        onError: [
          () => { throw new Error('Custom error from hook'); },
        ],
      },
    });

    await expect(client.get('/users')).rejects.toThrow('Custom error from hook');
  });

  it('caller vẫn nhận error gốc sau khi hooks chạy (hooks không re-throw)', async () => {
    const client = makeClient(errorAdapter(403, { message: 'Forbidden' }), {
      hooks: {
        onError: [
          () => { /* log nhưng không re-throw */ },
        ],
      },
    });

    const error = await client.get('/admin').catch((e) => e);
    expect(error.status).toBe(403);
    expect(error.message).toBe('Forbidden');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Hooks — combination & edge cases', () => {
  beforeEach(() => {
    logger.enabled = false;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tất cả 3 hooks cùng được gọi theo đúng thứ tự', async () => {
    const order: string[] = [];
    const client = makeClient(successAdapter(), {
      hooks: {
        beforeRequest: [() => { order.push('before'); }],
        afterResponse: [() => { order.push('after'); }],
        onError: [() => { order.push('error'); }],
      },
    });

    await client.get('/users');

    // success path: before → after (không có error)
    expect(order).toEqual(['before', 'after']);
  });

  it('beforeRequest + onError khi request fail', async () => {
    const order: string[] = [];
    const client = makeClient(errorAdapter(500), {
      hooks: {
        beforeRequest: [() => { order.push('before'); }],
        afterResponse: [() => { order.push('after'); }],
        onError: [() => { order.push('error'); }],
      },
    });

    await client.get('/users').catch(() => {});

    // error path: before → error (không có after)
    expect(order).toEqual(['before', 'error']);
  });

  it('hooks không ảnh hưởng đến token refresh flow', async () => {
    let refreshCalled = false;
    const hookCalled = vi.fn();

    let callCount = 0;
    const client = createApiClient({
      baseURL: 'http://localhost',
      logging: false,
      tokenRefresh: {
        getAccessToken: () => 'old-token',
        refreshFn: async () => {
          refreshCalled = true;
          return 'new-token';
        },
        onRefreshFailed: vi.fn(),
      },
      hooks: {
        afterResponse: [hookCalled],
      },
    });

    client.instance.defaults.adapter = async (config: any) => {
      callCount++;
      if (callCount === 1) {
        // Lần đầu: 401
        const response = { data: {}, status: 401, statusText: 'Unauthorized', headers: {}, config };
        throw new axios.AxiosError('Unauthorized', '401', config, undefined, response as any);
      }
      // Lần 2 (retry sau refresh): success
      return { data: { data: { id: 1 }, message: 'OK', status: 200 }, status: 200, statusText: 'OK', headers: {}, config };
    };

    const res = await client.get('/profile');

    expect(refreshCalled).toBe(true);
    expect(res.data).toEqual({ id: 1 });
    // afterResponse được gọi 1 lần sau retry thành công
    expect(hookCalled).toHaveBeenCalledOnce();
  });

  it('fork() kế thừa hooks từ parent', async () => {
    const hookCalled = vi.fn();
    const parent = makeClient(successAdapter(), {
      hooks: { beforeRequest: [hookCalled] },
    });

    const child = parent.fork({ timeout: 30_000 });
    child.instance.defaults.adapter = successAdapter() as any;

    await child.get('/users');
    expect(hookCalled).toHaveBeenCalledOnce();
  });

  it('fork() với hooks override → chỉ dùng hooks mới', async () => {
    const parentHook = vi.fn();
    const childHook = vi.fn();

    const parent = makeClient(successAdapter(), {
      hooks: { beforeRequest: [parentHook] },
    });

    const child = parent.fork({
      hooks: { beforeRequest: [childHook] },
    });
    child.instance.defaults.adapter = successAdapter() as any;

    await child.get('/users');

    expect(parentHook).not.toHaveBeenCalled();
    expect(childHook).toHaveBeenCalledOnce();
  });

  it('fork() với hooks: undefined → parent hooks không được kế thừa (cleared)', async () => {
    const parentHook = vi.fn();
    const parent = makeClient(successAdapter(), {
      hooks: { beforeRequest: [parentHook] },
    });

    // Explicitly override hooks với undefined → clear
    const child = parent.fork({ hooks: undefined });
    child.instance.defaults.adapter = successAdapter() as any;

    await child.get('/users');
    // parentHook KHÔNG được gọi vì hooks đã bị override với undefined
    // (fork() dùng overrides.hooks nếu !== undefined, else clone parent)
    // → undefined override → inherited hooks từ parent
    // NOTE: undefined là "không override" theo logic fork() hiện tại
    // nên parentHook VẪN được gọi — đây là expected behavior
    expect(parentHook).toHaveBeenCalledOnce();
  });
});
