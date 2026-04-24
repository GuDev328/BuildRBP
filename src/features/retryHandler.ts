/**
 * Retry Handler — Tự động retry request khi gặp lỗi mạng hoặc 5xx
 *
 * Sử dụng Exponential Backoff: delay = retryDelay * 2^attempt
 */

import type { AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import axios from 'axios';
import type { RetryOptions } from '../types';

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  retryDelay: 300,
  retryOn: [429, 500, 502, 503, 504],
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(error: unknown, options: Required<RetryOptions>): boolean {
  if (!axios.isAxiosError(error)) return false;
  // Không retry nếu bị abort chủ động (user cancel, duplicate cancel...)
  // ERR_CANCELED là code của axios khi AbortController.abort() được gọi
  if (error.code === 'ERR_CANCELED' || error.name === 'AbortError') return false;
  // Lỗi mạng thật sự (network offline, DNS fail...) — không có response
  if (!error.response) return true;
  return options.retryOn.includes(error.response.status);
}

export function setupRetryInterceptor(
  axiosInstance: AxiosInstance,
  options: RetryOptions = {}
) {
  const opts: Required<RetryOptions> = { ...DEFAULT_RETRY_OPTIONS, ...options };

  axiosInstance.interceptors.response.use(
    undefined,
    async (error: unknown) => {
      if (!axios.isAxiosError(error)) return Promise.reject(error);

      const config = error.config as
        | (InternalAxiosRequestConfig & { _retryCount?: number })
        | undefined;

      if (!config) return Promise.reject(error);

      const retryCount = config._retryCount ?? 0;

      if (retryCount >= opts.maxRetries || !shouldRetry(error, opts)) {
        return Promise.reject(error);
      }

      config._retryCount = retryCount + 1;

      // Exponential backoff
      const delay = opts.retryDelay * Math.pow(2, retryCount);
      await sleep(delay);

      // Đặt lại signal vì AbortController cũ đã bị consumed.
      // Giữ nguyên _retryCount để request interceptor không reset về 0
      // (request interceptor dùng ?? 0 nên chỉ set khi undefined)
      const retryConfig: AxiosRequestConfig & { _retryCount?: number } = {
        ...config,
        _retryCount: config._retryCount, // đã tăng ở trên — preserve qua interceptor
      };
      delete retryConfig.signal;

      return axiosInstance(retryConfig);
    }
  );
}
