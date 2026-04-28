/**
 * Mock adapter — intercepts matching requests and returns configured mock data.
 * Mock responses pass through all response interceptors identically to real responses.
 */

import axios from 'axios';
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import type { MockHandler } from '../types';
import { logger } from '../utils/logger';

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = setTimeout(resolve, ms);

    // `once: true` auto-removes the listener after it fires.
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

/** HTTP status code → status text (RFC 7231). */
const HTTP_STATUS_TEXT: Record<number, string> = {
  100: 'Continue',
  101: 'Switching Protocols',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  206: 'Partial Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

function getStatusText(status: number): string {
  return HTTP_STATUS_TEXT[status] ?? (status < 400 ? 'Unknown' : 'Error');
}

function matchHandler(config: AxiosRequestConfig, handler: MockHandler): boolean {
  const methodMatch = (config.method ?? 'get').toLowerCase() === handler.method.toLowerCase();
  if (!methodMatch) return false;

  const url = config.url ?? '';
  if (typeof handler.url === 'string') {
    if (url === handler.url) return true;

    // Sub-path matching only when the handler URL ends with `/`.
    // Prevents `/user` from matching `/users`.
    if (handler.url.endsWith('/')) {
      return url.startsWith(handler.url);
    }
    return false;
  }
  return handler.url.test(url);
}

/**
 * Replaces the axios adapter with a mock implementation.
 * Unmatched requests fall through to the original adapter (real HTTP).
 */
export function setupMockAdapter(axiosInstance: AxiosInstance, handlers: MockHandler[]): void {
  if (!handlers.length) return;

  const originalAdapter = axiosInstance.defaults.adapter;

  axiosInstance.defaults.adapter = async (config: AxiosRequestConfig): Promise<AxiosResponse> => {
    const handler = handlers.find((h) => matchHandler(config, h));

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
      await sleep(handler.delay, config.signal as AbortSignal | null | undefined);
    }

    const responseData =
      typeof handler.response === 'function' ? handler.response(config) : handler.response;

    const status = handler.status ?? 200;
    const statusText = getStatusText(status);

    logger.warn(`[Mock] ${(config.method ?? 'GET').toUpperCase()} ${config.url} → ${status}`);

    // Cast required: AxiosResponse expects InternalAxiosRequestConfig.
    const mockResponse: AxiosResponse = {
      data: responseData,
      status,
      statusText,
      headers: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: config as any,
    };

    // Throw AxiosError for 4xx/5xx so response interceptors handle errors consistently.
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
