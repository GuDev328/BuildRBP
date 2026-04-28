import axios from 'axios';
import type { AxiosInstance } from 'axios';
import type { ApiClient, ApiClientConfig, ApiResponse, RequestOptions } from '../types';
import { AbortManager } from './AbortManager';
import { setupRequestInterceptors } from './interceptors/requestInterceptors';
import { setupResponseInterceptors } from './interceptors/responseInterceptors';
import { setupMockAdapter } from '../features/mockAdapter';
import { uploadFile, downloadFile } from '../features/uploadDownload';

export function createApiClient(clientConfig: ApiClientConfig): ApiClient {
  const instance: AxiosInstance = axios.create({
    baseURL: clientConfig.baseURL,
    timeout: clientConfig.timeout ?? 10_000,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...clientConfig.defaultHeaders,
    },
  });

  const abortManager = new AbortManager();

  setupRequestInterceptors(instance, clientConfig, abortManager);

  setupResponseInterceptors(instance, clientConfig, abortManager);

  if (clientConfig.mocks?.length) {
    setupMockAdapter(instance, clientConfig.mocks);
  }

  function request<T>(config: RequestOptions): Promise<ApiResponse<T>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return instance.request(config as any).then((res) => res.data as ApiResponse<T>);
  }

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

    fork(overrides: Partial<ApiClientConfig> = {}): ApiClient {
      const forkedConfig: ApiClientConfig = {
        ...clientConfig,
        ...overrides,
        defaultHeaders: { ...clientConfig.defaultHeaders, ...overrides.defaultHeaders },
        // `in` cho phép fork({ tokenRefresh: undefined }) chủ động tạo public client.
        tokenRefresh: 'tokenRefresh' in overrides
          ? (overrides.tokenRefresh ? { ...overrides.tokenRefresh } : undefined)
          : (clientConfig.tokenRefresh ? { ...clientConfig.tokenRefresh } : undefined),
        mocks: overrides.mocks ?? clientConfig.mocks,
        hooks: overrides.hooks !== undefined ? overrides.hooks : (
          clientConfig.hooks ? {
            beforeRequest: clientConfig.hooks.beforeRequest ? [...clientConfig.hooks.beforeRequest] : undefined,
            afterResponse: clientConfig.hooks.afterResponse ? [...clientConfig.hooks.afterResponse] : undefined,
            onError: clientConfig.hooks.onError ? [...clientConfig.hooks.onError] : undefined,
          } : undefined
        ),
      };
      return createApiClient(forkedConfig);
    },
  };

  return client;
}
