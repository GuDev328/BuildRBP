import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import axios from 'axios';
import type { ApiClientConfig, ApiError, ApiResponse, ResponseContext } from '../../types';
import { keysToCamelCase } from '../../utils/transformKeys';
import { logger } from '../../utils/logger';
import type { AbortManager } from '../AbortManager';

export function setupResponseInterceptors(
  axiosInstance: AxiosInstance,
  config: ApiClientConfig,
  abortManager: AbortManager
) {
  let isRefreshing = false;
  let refreshQueue: Array<{
    resolve: (token: string) => void;
    reject: (err: unknown) => void;
  }> = [];
  // Ensures onRefreshFailed fires exactly once per refresh cycle,
  // even when multiple queued requests all fail after a bad refresh.
  let refreshFailedNotified = false;

  function processQueue(token: string | null, error: unknown) {
    for (const { resolve, reject } of refreshQueue) {
      if (token) resolve(token);
      else reject(error);
    }
    refreshQueue = [];
  }

  axiosInstance.interceptors.response.use(
    async (response: AxiosResponse): Promise<AxiosResponse> => {
      const reqConfig = response.config as InternalAxiosRequestConfig & {
        _startTime?: number;
        _abortKey?: string;
      };

      if (reqConfig._abortKey) {
        abortManager.clear(reqConfig._abortKey);
      }

      if (config.logging !== false) {
        logger.response(
          {
            method: reqConfig.method ?? 'get',
            url: reqConfig.url ?? '',
            status: response.status,
            body: response.data,
          },
          reqConfig._startTime ?? Date.now()
        );
      }

      // Skip key transform and envelope unwrap for non-JSON response types (blob, arraybuffer).
      const skipTransform =
        response.config.responseType !== undefined &&
        response.config.responseType !== 'json';

      let responseData = response.data;
      if (config.transformKeys && !skipTransform && responseData) {
        responseData = keysToCamelCase(responseData);
      }

      const skipEnvelope = skipTransform;

      const isEnvelope =
        !skipEnvelope &&
        responseData !== null &&
        typeof responseData === 'object' &&
        'data' in responseData &&
        'message' in responseData;

      const normalized: ApiResponse = isEnvelope
        ? {
            data: (responseData as Record<string, unknown>).data,
            message: (responseData as Record<string, unknown>).message as string,
            status: ((responseData as Record<string, unknown>).status as number) ?? response.status,
          }
        : { data: responseData, message: 'OK', status: response.status };

      const afterHooks = config.hooks?.afterResponse;
      if (afterHooks?.length && !skipEnvelope) {
        const ctx: ResponseContext = {
          data: normalized.data,
          message: normalized.message,
          status: normalized.status,
          method: reqConfig.method ?? 'get',
          url: reqConfig.url ?? '',
        };
        for (const hook of afterHooks) {
          await hook(ctx);
        }
      }

      return { ...response, data: normalized };
    },

    async (error: unknown) => {
      if (!axios.isAxiosError(error)) {
        const apiError = buildApiError(error, 0);
        await runErrorHooks(config, apiError);
        return Promise.reject(apiError);
      }

      const reqConfig = error.config as
        | (InternalAxiosRequestConfig & {
            _startTime?: number;
            _abortKey?: string;
            _retryCount?: number;
            _retry?: boolean;
          })
        | undefined;

      if (reqConfig?._abortKey) {
        abortManager.clear(reqConfig._abortKey);
      }

      if (config.logging !== false && reqConfig) {
        logger.error(
          {
            method: reqConfig.method ?? 'get',
            url: reqConfig.url ?? '',
            status: error.response?.status,
            error: error.response?.data ?? error.message,
          },
          reqConfig._startTime ?? Date.now()
        );
      }

      // Axios >= 1.x sets code='ERR_CANCELED' when AbortController fires.
      // Also check error.cause for DOMException propagation edge cases.
      const isAbortError =
        error.code === 'ERR_CANCELED' ||
        (error.cause instanceof DOMException && error.cause.name === 'AbortError');
      if (isAbortError) {
        return Promise.reject(buildApiError(error, 0, 'ABORTED'));
      }

      // 401 — token expired
      if (error.response?.status === 401 && config.tokenRefresh && reqConfig) {
        // Already retried once — the refresh itself failed.
        // Guard with refreshFailedNotified so onRefreshFailed fires only once
        // even when multiple queued requests all receive the same 401.
        if (reqConfig._retry) {
          processQueue(null, error);
          if (!refreshFailedNotified) {
            refreshFailedNotified = true;
            config.tokenRefresh.onRefreshFailed?.();
          }
          const apiError = buildApiError(error, 401, 'UNAUTHORIZED');
          await runErrorHooks(config, apiError);
          return Promise.reject(apiError);
        }

        // Another refresh is already in flight — queue this request.
        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            refreshQueue.push({
              resolve: (token: string) => {
                if (reqConfig) {
                  reqConfig.headers['Authorization'] = `Bearer ${token}`;
                  reqConfig._retry = true;
                  resolve(axiosInstance(reqConfig));
                }
              },
              reject,
            });
          });
        }

        reqConfig._retry = true;
        isRefreshing = true;
        refreshFailedNotified = false;

        try {
          const newToken = await config.tokenRefresh.refreshFn();
          processQueue(newToken, null);
          reqConfig.headers['Authorization'] = `Bearer ${newToken}`;
          return axiosInstance(reqConfig);
        } catch (refreshError) {
          processQueue(null, refreshError);
          if (!refreshFailedNotified) {
            refreshFailedNotified = true;
            config.tokenRefresh.onRefreshFailed?.();
          }
          const apiError = buildApiError(refreshError, 401, 'TOKEN_REFRESH_FAILED');
          await runErrorHooks(config, apiError);
          return Promise.reject(apiError);
        } finally {
          isRefreshing = false;
        }
      }

      const apiError = buildApiError(error, error.response?.status ?? 0);
      await runErrorHooks(config, apiError);
      return Promise.reject(apiError);
    }
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApiError(error: unknown, status: number, code?: string): ApiError {
  if (axios.isAxiosError(error)) {
    const serverData = error.response?.data as Record<string, unknown> | undefined;
    return {
      message: (serverData?.message as string) ?? error.message ?? 'Unknown error',
      status: error.response?.status ?? status,
      code: code ?? (serverData?.code as string),
      details: serverData,
      originalError: error,
    };
  }
  if (error instanceof Error) {
    return { message: error.message, status, code, originalError: error };
  }
  return { message: String(error), status, code, originalError: error };
}

/** Runs onError hooks sequentially. A hook may throw to replace the original error. */
async function runErrorHooks(config: ApiClientConfig, error: ApiError): Promise<void> {
  const hooks = config.hooks?.onError;
  if (!hooks?.length) return;

  for (const hook of hooks) {
    await hook(error);
  }
}
