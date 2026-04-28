import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import type { ApiClientConfig } from '../../types';
import type { AbortManager } from '../AbortManager';
import { buildRequestKey } from '../../utils/buildRequestKey';
import { keysToSnakeCase } from '../../utils/transformKeys';
import { logger } from '../../utils/logger';

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
  let requestCounter = 0;

  axiosInstance.interceptors.request.use(
    async (requestConfig: InternalAxiosRequestConfig) => {
      requestConfig._startTime = Date.now();
      requestConfig._retryCount = requestConfig._retryCount ?? 0;

      const requestId = `${Date.now()}-${++requestCounter}`;
      requestConfig.headers['x-request-id'] = requestId;
      requestConfig.headers['x-trace-id'] = requestId;

      if (config.tokenRefresh) {
        const token = config.tokenRefresh.getAccessToken();
        if (token) {
          requestConfig.headers['Authorization'] = `Bearer ${token}`;
        }
      }

      if (config.transformKeys && requestConfig.data) {
        requestConfig.data = keysToSnakeCase(requestConfig.data);
      }

      if (!requestConfig.signal) {
        const abortKey =
          (requestConfig as { abortKey?: string }).abortKey ??
          buildRequestKey(requestConfig);
        requestConfig._abortKey = abortKey;
        requestConfig.signal = abortManager.register(abortKey);
      }

      const beforeHooks = config.hooks?.beforeRequest;
      if (beforeHooks?.length) {
        const ctx = {
          method: requestConfig.method ?? 'get',
          url: requestConfig.url ?? '',
          params: requestConfig.params as Record<string, unknown> | undefined,
          body: requestConfig.data,
          headers: requestConfig.headers as Record<string, string>,
        };
        for (const hook of beforeHooks) {
          await hook(ctx);
        }
        Object.assign(requestConfig.headers, ctx.headers);
      }

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
