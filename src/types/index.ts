import axios from 'axios';
import type { AxiosInstance, AxiosRequestConfig, AxiosProgressEvent } from 'axios';

export interface ApiEnvelope<T = unknown> {
  data: T;
  message: string;
  status: number;
  success: boolean;
}

export interface ApiResponse<T = unknown> {
  data: T;
  message: string;
  status: number;
}

export interface ApiError {
  message: string;
  status: number;
  code?: string;
  details?: unknown;
  originalError?: unknown;
}

export interface RequestContext {
  method: string;
  url: string;
  params?: Record<string, unknown>;
  body?: unknown;
  headers: Record<string, string>;
}

export interface ResponseContext<T = unknown> {
  data: T;
  message: string;
  status: number;
  method: string;
  url: string;
}

/**
 * Lifecycle hooks run sequentially. Throwing from a hook cancels the current
 * lifecycle step and propagates the thrown error to the caller.
 */
export interface HooksConfig {
  /** Runs after auth and default headers are injected, before the request is sent. */
  beforeRequest?: Array<(ctx: RequestContext) => void | Promise<void>>;

  /** Runs after JSON responses are normalized and envelope-unwrapped. */
  afterResponse?: Array<(ctx: ResponseContext) => void | Promise<void>>;

  /** Runs for request failures that are surfaced as ApiError. */
  onError?: Array<(error: ApiError) => void | Promise<void>>;
}

export interface TokenRefreshConfig {
  refreshFn: () => Promise<string>;
  getAccessToken: () => string | null;
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
  baseURL: string;
  timeout?: number;
  defaultHeaders?: Record<string, string>;
  tokenRefresh?: TokenRefreshConfig;
  transformKeys?: boolean;
  logging?: boolean;
  mocks?: MockHandler[];
  hooks?: HooksConfig;
}

export interface RequestOptions extends Omit<AxiosRequestConfig, 'onUploadProgress' | 'onDownloadProgress'> {
  abortKey?: string;
  onUploadProgress?: (percent: number, event: AxiosProgressEvent) => void;
  onDownloadProgress?: (percent: number, event: AxiosProgressEvent) => void;
  autoDownload?: boolean;
  downloadFileName?: string;
}

export interface ApiClient {
  instance: AxiosInstance;
  get<T>(url: string, options?: RequestOptions): Promise<ApiResponse<T>>;
  post<T>(url: string, data?: unknown, options?: RequestOptions): Promise<ApiResponse<T>>;
  put<T>(url: string, data?: unknown, options?: RequestOptions): Promise<ApiResponse<T>>;
  patch<T>(url: string, data?: unknown, options?: RequestOptions): Promise<ApiResponse<T>>;
  delete<T>(url: string, options?: RequestOptions): Promise<ApiResponse<T>>;
  upload<T>(url: string, formData: FormData, options?: RequestOptions): Promise<ApiResponse<T>>;
  download(url: string, options?: RequestOptions): Promise<Blob>;
  abort(key: string): void;
  abortAll(): void;
  fork(overrides?: Partial<ApiClientConfig>): ApiClient;
}

export type { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosProgressEvent } from 'axios';
export { axios };
