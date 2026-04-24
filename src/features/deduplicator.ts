/**
 * Deduplicator — Chống gửi trùng lặp GET requests
 *
 * Nếu cùng 1 request đang pending → trả về promise cũ thay vì gửi request mới
 */

import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { buildRequestKey } from '../utils/buildRequestKey';
import { logger } from '../utils/logger';

export class Deduplicator {
  // Map từ request key → Promise<AxiosResponse> đang pending
  private pending = new Map<string, Promise<AxiosResponse>>();
  private _wrapped = false;

  /**
   * Wrap axios instance để auto-deduplicate GET requests.
   * Idempotent — an toàn khi gọi nhiều lần (hot reload, test setup).
   */
  wrap(axiosInstance: AxiosInstance): void {
    if (this._wrapped) return;
    this._wrapped = true;
    const originalRequest = axiosInstance.request.bind(axiosInstance);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (axiosInstance as any).request = <T = any>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> => {
      const method = (config.method ?? 'get').toLowerCase();

      // Chỉ deduplicate GET requests
      if (method !== 'get' || (config as { skipDedup?: boolean }).skipDedup) {
        return originalRequest<T>(config);
      }

      const key = buildRequestKey(config);

      if (this.pending.has(key)) {
        logger.debug(`[Dedup] Reusing pending request: ${key}`);
        return this.pending.get(key)! as Promise<AxiosResponse<T>>;
      }

      const promise: Promise<AxiosResponse<T>> = originalRequest<T>(config).finally(() => {
        this.pending.delete(key);
      });

      this.pending.set(key, promise as Promise<AxiosResponse>);
      return promise;
    };
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  clear(): void {
    this.pending.clear();
  }
}
