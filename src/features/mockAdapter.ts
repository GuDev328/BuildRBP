/**
 * Mock Adapter — Intercept requests và trả về mock data
 *
 * Mock response đi qua response interceptors bình thường (normalize, envelope unwrap...)
 * để đảm bảo behavior nhất quán giữa mock và production.
 */

import axios from 'axios';
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import type { MockHandler } from '../types';
import { logger } from '../utils/logger';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchHandler(config: AxiosRequestConfig, handler: MockHandler): boolean {
  const methodMatch = (config.method ?? 'get').toLowerCase() === handler.method.toLowerCase();
  if (!methodMatch) return false;

  const url = config.url ?? '';
  if (typeof handler.url === 'string') {
    // Exact match
    if (url === handler.url) return true;
    
    // Only allow sub-path matching if handler ends with /
    // This prevents '/user' from matching '/users' (different resources)
    // while '/users/' will match '/users/123' (parent-child relationship)
    if (handler.url.endsWith('/')) {
      return url.startsWith(handler.url);
    }
    return false;
  }
  return handler.url.test(url);
}

/**
 * Tạo một axios adapter function trả về mock response.
 * Dùng custom adapter thay vì monkey-patch request() để mock đi qua
 * response interceptors bình thường → behavior nhất quán với production.
 */
export function setupMockAdapter(axiosInstance: AxiosInstance, handlers: MockHandler[]): void {
  if (!handlers.length) return;

  // Lưu adapter gốc để fallthrough khi không match handler
  const originalAdapter = axiosInstance.defaults.adapter;

  axiosInstance.defaults.adapter = async (config: AxiosRequestConfig): Promise<AxiosResponse> => {
    const handler = handlers.find((h) => matchHandler(config, h));

    // Không match → dùng adapter gốc (real HTTP)
    if (!handler) {
      if (typeof originalAdapter === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return originalAdapter(config as any);
      }
      throw new Error(
        `[Mock] No matching handler for ${(config.method ?? 'GET').toUpperCase()} ${config.url} and no original adapter available.`
      );
    }

    if (handler.delay) {
      await sleep(handler.delay);
    }

    const responseData =
      typeof handler.response === 'function' ? handler.response(config) : handler.response;

    const status = handler.status ?? 200;

    logger.warn(`[Mock] ${(config.method ?? 'GET').toUpperCase()} ${config.url} → ${status}`);

    // Build AxiosResponse đúng shape để đi qua response interceptors
    const mockResponse: AxiosResponse = {
      data: responseData,
      status,
      statusText: status < 400 ? 'OK' : 'Error',
      headers: {},
      // config cần cast vì AxiosResponse yêu cầu InternalAxiosRequestConfig
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: config as any,
    };

    // Simulate error nếu status >= 400 — dùng AxiosError constructor thật
    // để axios.isAxiosError() trả true và retry/response interceptors hoạt động đúng
    if (status >= 400) {
      throw new axios.AxiosError(
        `Request failed with status code ${status}`,
        String(status),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        config as any,
        undefined,
        mockResponse
      );
    }

    return mockResponse;
  };
}
