import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import axios from 'axios';
import type { ApiClientConfig, ApiError, ApiResponse } from '../../types';
import { keysToCamelCase } from '../../utils/transformKeys';
import { logger } from '../../utils/logger';
import type { AbortManager } from '../AbortManager';

export function setupResponseInterceptors(
  axiosInstance: AxiosInstance,
  config: ApiClientConfig,
  abortManager: AbortManager
) {
  // ── Token Refresh State — PER INSTANCE (không phải global) ───────────────
  // Đặt trong closure để mỗi instance có state riêng, tránh bug multi-instance
  let isRefreshing = false;
  let refreshQueue: Array<{
    resolve: (token: string) => void;
    reject: (err: unknown) => void;
  }> = [];

  function processQueue(token: string | null, error: unknown) {
    for (const { resolve, reject } of refreshQueue) {
      if (token) resolve(token);
      else reject(error);
    }
    refreshQueue = [];
  }

  axiosInstance.interceptors.response.use(
    // ── Success handler ─────────────────────────────────────────────────────
    (response: AxiosResponse): AxiosResponse => {
      const reqConfig = response.config as InternalAxiosRequestConfig & {
        _startTime?: number;
        _abortKey?: string;
      };

      // 1. Dọn dẹp AbortController
      if (reqConfig._abortKey) {
        abortManager.clear(reqConfig._abortKey);
      }

      // 2. Logging
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

      // 3. Transform response keys: snake_case → camelCase
      let responseData = response.data;
      if (config.transformKeys && responseData) {
        responseData = keysToCamelCase(responseData);
      }

      // 4. Bóc tách envelope { data, message, status }
      const isEnvelope =
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

      // Trả về AxiosResponse với data đã được normalize thành ApiResponse
      return { ...response, data: normalized };
    },

    // ── Error handler ────────────────────────────────────────────────────────
    async (error: unknown) => {
      if (!axios.isAxiosError(error)) {
        return Promise.reject(buildApiError(error, 0));
      }

      const reqConfig = error.config as
        | (InternalAxiosRequestConfig & {
            _startTime?: number;
            _abortKey?: string;
            _retryCount?: number;
            _retry?: boolean;
          })
        | undefined;

      // 1. Dọn dẹp AbortController
      if (reqConfig?._abortKey) {
        abortManager.clear(reqConfig._abortKey);
      }

      // 2. Logging lỗi
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

      // 3. Lỗi do abort — silent reject
      if (error.code === 'ERR_CANCELED' || error.name === 'AbortError') {
        return Promise.reject(buildApiError(error, 0, 'ABORTED'));
      }

      // 4. Xử lý 401 — Token expired
      if (error.response?.status === 401 && config.tokenRefresh && reqConfig) {
        // Đã retry 401 một lần rồi nhưng vẫn fail → refresh thực sự thất bại
        if (reqConfig._retry) {
          processQueue(null, error);
          config.tokenRefresh.onRefreshFailed?.();
          return Promise.reject(buildApiError(error, 401, 'UNAUTHORIZED'));
        }

        // Đang có instance khác đang refresh → xếp vào queue, chờ token mới
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

        // Bắt đầu refresh
        reqConfig._retry = true;
        isRefreshing = true;

        try {
          const newToken = await config.tokenRefresh.refreshFn();
          processQueue(newToken, null);
          reqConfig.headers['Authorization'] = `Bearer ${newToken}`;
          return axiosInstance(reqConfig);
        } catch (refreshError) {
          processQueue(null, refreshError);
          config.tokenRefresh.onRefreshFailed?.();
          return Promise.reject(buildApiError(refreshError, 401, 'TOKEN_REFRESH_FAILED'));
        } finally {
          isRefreshing = false;
        }
      }

      return Promise.reject(buildApiError(error, error.response?.status ?? 0));
    }
  );
}

// ─── Helper ───────────────────────────────────────────────────────────────────

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
