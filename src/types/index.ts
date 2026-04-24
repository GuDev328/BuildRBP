import axios from 'axios';
import type { AxiosInstance, AxiosRequestConfig, AxiosProgressEvent } from 'axios';

// ─── Generic API Response ────────────────────────────────────────────────────

/** Envelope response trả về từ server */
export interface ApiEnvelope<T = unknown> {
  data: T;
  message: string;
  status: number;
  success: boolean;
}

/** Kết quả sau khi đã bóc tách */
export interface ApiResponse<T = unknown> {
  data: T;
  message: string;
  status: number;
}

// ─── Error ───────────────────────────────────────────────────────────────────

export interface ApiError {
  message: string;
  status: number;
  code?: string;
  details?: unknown;
  originalError?: unknown;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Số lần retry tối đa (default: 3) */
  maxRetries?: number;
  /** Delay ban đầu tính bằng ms (default: 300) */
  retryDelay?: number;
  /** HTTP status codes sẽ được retry (default: [429, 500, 502, 503, 504]) */
  retryOn?: number[];
}

export interface CacheOptions {
  /** Bật/tắt cache cho instance (default: false) */
  enabled?: boolean;
  /** TTL mặc định tính bằng ms (default: 60_000) */
  ttl?: number;
  /** Bật stale-while-revalidate (default: false) */
  staleWhileRevalidate?: boolean;
  /** Số entries tối đa trước khi LRU evict (default: 100) */
  maxSize?: number;
}

export interface TokenRefreshConfig {
  /** Hàm thực hiện refresh token, trả về access token mới */
  refreshFn: () => Promise<string>;
  /** Hàm lấy token hiện tại để gắn vào header */
  getAccessToken: () => string | null;
  /** Callback khi refresh thất bại (thường là logout) */
  onRefreshFailed?: () => void;
}

export interface MockHandler {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  url: string | RegExp;
  response: unknown | ((config: AxiosRequestConfig) => unknown);
  status?: number;
  delay?: number;
}

export interface ApiClientConfig {
  /** Base URL của API */
  baseURL: string;
  /** Timeout tính bằng ms (default: 10_000) */
  timeout?: number;
  /** Headers mặc định */
  defaultHeaders?: Record<string, string>;
  /** Cấu hình retry */
  retry?: RetryOptions;
  /** Cấu hình cache */
  cache?: CacheOptions;
  /** Cấu hình token refresh */
  tokenRefresh?: TokenRefreshConfig;
  /** Bật auto deduplication cho GET (default: true) */
  deduplication?: boolean;
  /** Bật transform key camelCase <-> snake_case (default: false) */
  transformKeys?: boolean;
  /** Bật logging trong dev (default: true) */
  logging?: boolean;
  /** Danh sách mock handlers */
  mocks?: MockHandler[];
}

// ─── Request Options ──────────────────────────────────────────────────────────

export interface RequestOptions extends Omit<AxiosRequestConfig, 'onUploadProgress' | 'onDownloadProgress'> {
  /** Key để quản lý abort, tự động tạo nếu không truyền */
  abortKey?: string;
  /** Override TTL cache cho request này */
  cacheTtl?: number;
  /** Bỏ qua cache cho request này */
  skipCache?: boolean;
  /** Bỏ qua deduplication cho request này */
  skipDedup?: boolean;
  /** Callback upload progress — nhận phần trăm (0-100) */
  onUploadProgress?: (percent: number, event: AxiosProgressEvent) => void;
  /** Callback download progress — nhận phần trăm (0-100) */
  onDownloadProgress?: (percent: number, event: AxiosProgressEvent) => void;
  /** Nếu true, tự động trigger download file */
  autoDownload?: boolean;
  /** Tên file khi autoDownload=true */
  downloadFileName?: string;
}

// ─── Typed API Client ──────────────────────────────────────────────────────────

export interface ApiClient {
  /** Axios instance gốc */
  instance: AxiosInstance;
  get<T>(url: string, options?: RequestOptions): Promise<ApiResponse<T>>;
  post<T>(url: string, data?: unknown, options?: RequestOptions): Promise<ApiResponse<T>>;
  put<T>(url: string, data?: unknown, options?: RequestOptions): Promise<ApiResponse<T>>;
  patch<T>(url: string, data?: unknown, options?: RequestOptions): Promise<ApiResponse<T>>;
  delete<T>(url: string, options?: RequestOptions): Promise<ApiResponse<T>>;
  /** Upload file với progress tracking */
  upload<T>(url: string, formData: FormData, options?: RequestOptions): Promise<ApiResponse<T>>;
  /** Download file */
  download(url: string, options?: RequestOptions): Promise<Blob>;
  /** Hủy request theo key */
  abort(key: string): void;
  /** Hủy tất cả pending requests */
  abortAll(): void;
  /** Xóa cache theo key hoặc pattern */
  clearCache(keyOrPattern?: string | RegExp): void;
  /** Tạo instance mới kế thừa config */
  fork(overrides?: Partial<ApiClientConfig>): ApiClient;
}

// Re-export axios types thông dụng
export type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
export { axios };
