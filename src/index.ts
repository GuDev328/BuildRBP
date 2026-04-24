/**
 * Public API Entry Point
 * Export tất cả những gì người dùng cần
 */

// ── Main factory ─────────────────────────────────────────────────────────────
export { createApiClient } from './core/createInstance';

// ── Classes ───────────────────────────────────────────────────────────────────
// AbortManager được export vì user có thể cần dùng standalone để quản lý abort riêng
// ResponseCache và Deduplicator là implementation detail — không expose ra public API
export { AbortManager } from './core/AbortManager';

// ── Utils ─────────────────────────────────────────────────────────────────────
export { logger } from './utils/logger';
export { toCamelCase, toSnakeCase, keysToCamelCase, keysToSnakeCase } from './utils/transformKeys';
export { buildRequestKey } from './utils/buildRequestKey';

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  ApiClient,
  ApiClientConfig,
  ApiEnvelope,
  ApiResponse,
  ApiError,
  RetryOptions,
  CacheOptions,
  TokenRefreshConfig,
  MockHandler,
  RequestOptions,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
} from './types';
