import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import type { ApiClientConfig } from '../../types';
import type { AbortManager } from '../AbortManager';
import { buildRequestKey } from '../../utils/buildRequestKey';
import { keysToSnakeCase } from '../../utils/transformKeys';
import { logger } from '../../utils/logger';

// Metadata custom gắn vào request config
declare module 'axios' {
  interface InternalAxiosRequestConfig {
    _abortKey?: string;
    _startTime?: number;
    _retryCount?: number;
  }
}

export function setupRequestInterceptors(
  axiosInstance: AxiosInstance,
  config: ApiClientConfig,
  abortManager: AbortManager
) {
  // Per-instance request counter — tạo unique x-request-id cho mỗi instance
  // (không dùng module-level global để tránh shared state giữa các instances)
  let requestCounter = 0;

  axiosInstance.interceptors.request.use(
    (requestConfig: InternalAxiosRequestConfig) => {
      // ── 1. Timestamp & retry count ───────────────────────────────────────
      requestConfig._startTime = Date.now();
      // _retryCount được set bởi retryHandler khi retry — giữ nguyên nếu đã có
      requestConfig._retryCount = requestConfig._retryCount ?? 0;

      // ── 2. Inject trace headers ───────────────────────────────────────────
      const requestId = `${Date.now()}-${++requestCounter}`;
      requestConfig.headers['x-request-id'] = requestId;
      requestConfig.headers['x-trace-id'] = requestId;

      // ── 3. Authorization ──────────────────────────────────────────────────
      if (config.tokenRefresh) {
        const token = config.tokenRefresh.getAccessToken();
        if (token) {
          requestConfig.headers['Authorization'] = `Bearer ${token}`;
        }
      }

      // ── 4. Transform body keys: camelCase → snake_case ────────────────────
      if (config.transformKeys && requestConfig.data) {
        requestConfig.data = keysToSnakeCase(requestConfig.data);
      }

      // ── 5. AbortController ────────────────────────────────────────────────
      // Nếu caller đã pass signal thì không override
      if (!requestConfig.signal) {
        const abortKey =
          (requestConfig as { abortKey?: string }).abortKey ??
          buildRequestKey(requestConfig);
        requestConfig._abortKey = abortKey;
        requestConfig.signal = abortManager.register(abortKey);
      }

      // ── 6. Logging ────────────────────────────────────────────────────────
      if (config.logging !== false) {
        logger.request({
          method: requestConfig.method ?? 'get',
          url: requestConfig.url ?? '',
          params: requestConfig.params as Record<string, unknown>,
          body: requestConfig.data,
        });
      }

      return requestConfig;
    },
    (error: unknown) => Promise.reject(error)
  );
}
