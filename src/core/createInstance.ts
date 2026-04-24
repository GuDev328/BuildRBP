/**
 * createInstance — Factory tạo API client hoàn chỉnh
 *
 * Thứ tự setup quan trọng — Axios xử lý response interceptors NGƯỢC thứ tự đăng ký:
 *
 *  Request flow (top-down):
 *    Cache wrap → Dedup wrap → [request interceptors] → HTTP
 *
 *  Response flow (bottom-up):
 *    HTTP → [retry interceptor] → [response interceptor: normalize/401] → caller
 *
 *  Vì vậy retry phải được đăng ký SAU response interceptor
 *  để retry interceptor chạy TRƯỚC (innermost error handler).
 */

import axios from 'axios';
import type { AxiosInstance, AxiosResponse } from 'axios';
import type { ApiClient, ApiClientConfig, ApiResponse, RequestOptions } from '../types';
import { AbortManager } from './AbortManager';
import { setupRequestInterceptors } from './interceptors/requestInterceptors';
import { setupResponseInterceptors } from './interceptors/responseInterceptors';
import { setupRetryInterceptor } from '../features/retryHandler';
import { Deduplicator } from '../features/deduplicator';
import { ResponseCache } from '../features/cache';
import { setupMockAdapter } from '../features/mockAdapter';
import { uploadFile, downloadFile } from '../features/uploadDownload';

export function createApiClient(clientConfig: ApiClientConfig): ApiClient {
  // ── 1. Tạo axios instance ────────────────────────────────────────────────
  const instance: AxiosInstance = axios.create({
    baseURL: clientConfig.baseURL,
    timeout: clientConfig.timeout ?? 10_000,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...clientConfig.defaultHeaders,
    },
  });

  // ── 2. AbortManager ───────────────────────────────────────────────────────
  const abortManager = new AbortManager();

  // ── 3. Cache & Dedup wraps ────────────────────────────────────────────────
  // Wrap TRƯỚC interceptors để là outermost layer của request flow.
  // Cache → Dedup → HTTP (thứ tự check: cache trước, nếu miss thì dedup)
  const cache = new ResponseCache(clientConfig.cache);
  if (clientConfig.cache?.enabled) {
    cache.wrap(instance);
  }

  const deduplicator = new Deduplicator();
  if (clientConfig.deduplication !== false) {
    deduplicator.wrap(instance);
  }

  // ── 4. Request interceptors ───────────────────────────────────────────────
  setupRequestInterceptors(instance, clientConfig, abortManager);

  // ── 5. Response interceptors (normalize + 401 handling) ──────────────────
  setupResponseInterceptors(instance, clientConfig, abortManager);

  // ── 6. Retry interceptor ──────────────────────────────────────────────────
  // PHẢI đăng ký SAU response interceptors.
  // Axios chạy response error handlers NGƯỢC thứ tự → retry sẽ chạy TRƯỚC
  // response interceptor, catch được lỗi gốc trước khi bị transform.
  setupRetryInterceptor(instance, clientConfig.retry ?? {});

  // ── 7. Mock Adapter ──────────────────────────────────────────────────────
  // Dùng custom axios adapter — mock responses đi qua tất cả interceptors
  // như response thật → behavior nhất quán giữa mock và production.
  // Có thể setup ở bất kỳ vị trí (không phụ thuộc thứ tự).
  if (clientConfig.mocks?.length) {
    setupMockAdapter(instance, clientConfig.mocks);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Internal request helper — unwrap AxiosResponse để trả về ApiResponse<T>.
   *
   * Truyền toàn bộ config (bao gồm custom props như abortKey, skipCache...)
   * vì các interceptors và wrappers cần đọc chúng từ config object.
   * Response interceptor đảm bảo res.data đã là ApiResponse shape.
   */
  function request<T>(config: RequestOptions): Promise<ApiResponse<T>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return instance.request(config as any).then((res) => res.data as ApiResponse<T>);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  const client: ApiClient = {
    instance,

    get<T>(url: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
      return request<T>({ ...options, method: 'get', url });
    },

    post<T>(url: string, data?: unknown, options: RequestOptions = {}): Promise<ApiResponse<T>> {
      return request<T>({ ...options, method: 'post', url, data });
    },

    put<T>(url: string, data?: unknown, options: RequestOptions = {}): Promise<ApiResponse<T>> {
      return request<T>({ ...options, method: 'put', url, data });
    },

    patch<T>(url: string, data?: unknown, options: RequestOptions = {}): Promise<ApiResponse<T>> {
      return request<T>({ ...options, method: 'patch', url, data });
    },

    delete<T>(url: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
      return request<T>({ ...options, method: 'delete', url });
    },

    upload<T>(url: string, formData: FormData, options: RequestOptions = {}): Promise<ApiResponse<T>> {
      return uploadFile<T>(instance, url, formData, options);
    },

    download(url: string, options: RequestOptions = {}): Promise<Blob> {
      return downloadFile(instance, url, options);
    },

    abort(key: string): void {
      abortManager.abort(key);
    },

    abortAll(): void {
      abortManager.abortAll();
    },

    clearCache(keyOrPattern?: string | RegExp): void {
      if (!keyOrPattern) {
        cache.clear();
      } else if (keyOrPattern instanceof RegExp) {
        // RegExp: truyền thẳng vào invalidateByPattern
        cache.invalidateByPattern(keyOrPattern);
      } else {
        // string URL (vd: '/users') → match URL field trong JSON cache key format:
        //   '["get","/users","",""]'  ← URL nằm ở field thứ 2 trong JSON array
        // Escape special regex chars trước khi build pattern
        const escaped = keyOrPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        cache.invalidateByPattern(new RegExp(`,"${escaped}`));
      }
    },

    fork(overrides: Partial<ApiClientConfig> = {}): ApiClient {
      return createApiClient({ ...clientConfig, ...overrides });
    },
  };

  return client;
}
