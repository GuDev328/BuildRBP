/**
 * Issue #5: ResponseCache._wrapped — không track axiosInstance cụ thể
 *
 * Nếu cùng 1 ResponseCache được dùng để wrap 2 axios instances khác nhau,
 * lần wrap thứ 2 sẽ bị bỏ qua (idempotent guard _wrapped=true từ lần đầu)
 * → instance thứ 2 không được cache
 */

import { describe, it, expect } from 'vitest';
import axios from 'axios';
import { ResponseCache } from '../../src/features/cache';
import { logger } from '../../src/utils/logger';

describe('ResponseCache — multi-instance wrapping issue', () => {
  beforeEach(() => {
    logger.enabled = false;
  });

  afterEach(() => {
    vi.restoreAllMocks?.();
  });

  /**
   * Sau fix: Dùng WeakSet thay vì boolean _wrapped → cùng 1 ResponseCache
   * có thể wrap nhiều axios instances khác nhau mà không bị chặn.
   * NOTE: Cache store vẫn là shared → các instances dùng chung cache entries.
   */
  it('cùng 1 ResponseCache có thể wrap 2 axios instances khác nhau (sau fix WeakSet)', async () => {
    let instance1Calls = 0;
    let instance2Calls = 0;

    const sharedCache = new ResponseCache({ enabled: true, ttl: 60_000 });

    // Wrap instance1
    const axios1 = axios.create();
    axios1.defaults.adapter = async (config: any) => {
      instance1Calls++;
      return { data: { src: 'instance1', n: instance1Calls }, status: 200, statusText: 'OK', headers: {}, config };
    };
    sharedCache.wrap(axios1); // _wrappedInstances.add(axios1)

    // Wrap instance2 — WeakSet cho phép wrap instance khác
    const axios2 = axios.create();
    axios2.defaults.adapter = async (config: any) => {
      instance2Calls++;
      return { data: { src: 'instance2', n: instance2Calls }, status: 200, statusText: 'OK', headers: {}, config };
    };
    sharedCache.wrap(axios2); // OK — axios2 chưa có trong WeakSet

    // instance1 có cache
    await axios1.request({ method: 'get', url: '/data' });
    await axios1.request({ method: 'get', url: '/data' }); // cache hit
    expect(instance1Calls).toBe(1); // cache hoạt động ✅

    // instance2 cũng có cache sau fix
    await axios2.request({ method: 'get', url: '/data' });
    await axios2.request({ method: 'get', url: '/data' }); // cache hit
    // NOTE: cache là shared → instance2 dùng cùng cache store với instance1
    // /data đã có trong cache từ instance1 → instance2 HIT ngay lần đầu!
    expect(instance2Calls).toBe(0); // instance2 không cần call vì cache đã có từ instance1
  });

  /**
   * Cách đúng: mỗi axios instance cần 1 ResponseCache riêng
   */
  it('[CORRECT USAGE] mỗi axios instance dùng ResponseCache riêng biệt', async () => {
    let instance1Calls = 0;
    let instance2Calls = 0;

    // Cache riêng cho mỗi instance
    const cache1 = new ResponseCache({ enabled: true, ttl: 60_000 });
    const cache2 = new ResponseCache({ enabled: true, ttl: 60_000 });

    const axios1 = axios.create();
    axios1.defaults.adapter = async (config: any) => {
      instance1Calls++;
      return { data: { n: instance1Calls }, status: 200, statusText: 'OK', headers: {}, config };
    };
    cache1.wrap(axios1);

    const axios2 = axios.create();
    axios2.defaults.adapter = async (config: any) => {
      instance2Calls++;
      return { data: { n: instance2Calls }, status: 200, statusText: 'OK', headers: {}, config };
    };
    cache2.wrap(axios2);

    // Cả 2 instance đều có cache hoạt động
    await axios1.request({ method: 'get', url: '/data' });
    await axios1.request({ method: 'get', url: '/data' });
    expect(instance1Calls).toBe(1); // cache OK

    await axios2.request({ method: 'get', url: '/data' });
    await axios2.request({ method: 'get', url: '/data' });
    expect(instance2Calls).toBe(1); // cache OK
  });

  /**
   * Idempotent wrap với CÙNG instance — behavior đúng
   */
  it('wrap cùng instance nhiều lần → idempotent (đúng behavior)', async () => {
    let callCount = 0;
    const cache = new ResponseCache({ enabled: true, ttl: 60_000 });
    const instance = axios.create();
    instance.defaults.adapter = async (config: any) => {
      callCount++;
      return { data: { n: callCount }, status: 200, statusText: 'OK', headers: {}, config };
    };

    // Wrap nhiều lần cùng instance → không có vấn đề
    cache.wrap(instance);
    cache.wrap(instance); // idempotent
    cache.wrap(instance); // idempotent

    await instance.request({ method: 'get', url: '/data' });
    await instance.request({ method: 'get', url: '/data' }); // cache hit
    expect(callCount).toBe(1);
  });

  /**
   * Verify createApiClient tạo ResponseCache riêng cho mỗi instance
   * (không có bug này khi dùng qua createApiClient)
   */
  it('createApiClient fork() tạo cache riêng — không share ResponseCache', async () => {
    // createApiClient tạo ResponseCache mới cho mỗi instance
    // nên fork() không gặp vấn đề multi-instance wrapping
    const { createApiClient } = await import('../../src/core/createInstance');

    let calls = 0;
    const parent = createApiClient({
      baseURL: 'http://localhost',
      logging: false,
      cache: { enabled: true, ttl: 60_000 },
      deduplication: false,
    });
    parent.instance.defaults.adapter = async (config: any) => {
      calls++;
      return {
        data: { data: { n: calls }, message: 'OK', status: 200 },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    };

    const child = parent.fork({ cache: { enabled: true, ttl: 60_000 } });
    child.instance.defaults.adapter = parent.instance.defaults.adapter;

    // Parent có cache riêng
    await parent.get('/data');
    await parent.get('/data'); // cache hit
    const parentCalls = calls;
    expect(parentCalls).toBe(1);

    // Child có cache riêng (không share với parent)
    calls = 0;
    await child.get('/data');
    await child.get('/data'); // cache hit
    expect(calls).toBe(1);
  });
});
