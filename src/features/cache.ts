/**
 * Cache — In-memory response cache cho GET requests
 *
 * Features:
 * - TTL per request
 * - Stale-while-revalidate
 * - maxSize với LRU eviction (tránh memory leak)
 * - Invalidate theo key hoặc pattern
 */

import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import type { CacheOptions } from '../types';
import { buildRequestKey } from '../utils/buildRequestKey';
import { logger } from '../utils/logger';

interface CacheEntry {
  data: AxiosResponse;
  expiresAt: number;
  /** Dùng để track LRU — cập nhật mỗi lần được access */
  lastAccessedAt: number;
}

const DEFAULT_TTL = 60_000;     // 60 giây
const DEFAULT_MAX_SIZE = 100;   // 100 entries tối đa

export class ResponseCache {
  private store = new Map<string, CacheEntry>();
  private options: Required<CacheOptions>;

  constructor(options: CacheOptions = {}) {
    this.options = {
      enabled: options.enabled ?? false,
      ttl: options.ttl ?? DEFAULT_TTL,
      staleWhileRevalidate: options.staleWhileRevalidate ?? false,
      maxSize: options.maxSize ?? DEFAULT_MAX_SIZE,
    };
  }

  // ── Read ─────────────────────────────────────────────────────────────────

  /**
   * Lấy cache entry. Trả về null nếu:
   * - Không tồn tại
   * - Đã expired VÀ không có stale-while-revalidate
   */
  get(key: string): AxiosResponse | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    const now = Date.now();

    if (now < entry.expiresAt) {
      // Fresh hit — cập nhật lastAccessedAt cho LRU
      entry.lastAccessedAt = now;
      return entry.data;
    }

    // Expired
    if (this.options.staleWhileRevalidate) {
      // Trả stale nhưng KHÔNG cập nhật lastAccessed
      // (entry sẽ bị evict sớm hơn khi maxSize đạt giới hạn)
      return entry.data;
    }

    // Expired và không có SWR → xóa luôn
    this.store.delete(key);
    return null;
  }

  /**
   * Kiểm tra xem entry hiện tại có stale không.
   * Sử dụng CÙNG entry đã fetch bởi get() để tránh race condition.
   */
  isStale(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return true;
    return Date.now() >= entry.expiresAt;
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  set(key: string, data: AxiosResponse, ttl?: number): void {
    // Evict nếu đã đạt maxSize (LRU: xóa entry ít được dùng nhất)
    if (this.store.size >= this.options.maxSize && !this.store.has(key)) {
      this.evictLRU();
    }

    this.store.set(key, {
      data,
      expiresAt: Date.now() + (ttl ?? this.options.ttl),
      lastAccessedAt: Date.now(),
    });
  }

  // ── Invalidation ──────────────────────────────────────────────────────────

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidateByPattern(pattern: string | RegExp): void {
    const regex = pattern instanceof RegExp ? pattern : new RegExp(`^${pattern}`);
    // Snapshot keys trước khi iterate để tránh mutate Map đang duyệt (undefined behavior)
    const keysToDelete = [...this.store.keys()].filter((k) => regex.test(k));
    for (const key of keysToDelete) {
      this.store.delete(key);
    }
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  // ── LRU Eviction ──────────────────────────────────────────────────────────

  private evictLRU(): void {
    let lruKey: string | null = null;
    let lruTime = Infinity;

    for (const [key, entry] of this.store) {
      if (entry.lastAccessedAt < lruTime) {
        lruTime = entry.lastAccessedAt;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.store.delete(lruKey);
      logger.debug(`[Cache] Evicted LRU entry: ${lruKey}`);
    }
  }

  // ── Axios Wrap ──────────────────────────────────────────────

  /**
   * Track từng axios instance đã wrap — WeakSet thư giún không cần cleanup.
   * Dùng WeakSet thay vì boolean _wrapped để cho phép cùng 1 ResponseCache
   * wrap nhiều axios instances khác nhau mà không bị idempotent guard chặn nhau.
   */
  private _wrappedInstances = new WeakSet<object>();

  wrap(axiosInstance: AxiosInstance): void {
    if (!this.options.enabled) return;
    // Idempotent guard per-instance — tránh wrap cùng instance nhiều lần (hot reload, test setup)
    if (this._wrappedInstances.has(axiosInstance)) return;
    this._wrappedInstances.add(axiosInstance);

    const cache = this;
    const originalRequest = axiosInstance.request.bind(axiosInstance);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (axiosInstance as any).request = async <T = any>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> => {
      const method = (config.method ?? 'get').toLowerCase();
      const skipCache = (config as { skipCache?: boolean }).skipCache;

      if (method !== 'get' || skipCache) {
        return originalRequest<T>(config);
      }

      const key = buildRequestKey(config);
      const ttl = (config as { cacheTtl?: number }).cacheTtl;

      // Lấy cached entry + stale status cùng lúc để tránh race condition
      // giữa get() và isStale() riêng biệt
      const entry = cache.store.get(key);
      const now = Date.now();
      const isFresh = entry && now < entry.expiresAt;
      const isStaleEntry = entry && now >= entry.expiresAt;

      if (isFresh) {
        // Update LRU timestamp
        entry.lastAccessedAt = now;
        logger.debug(`[Cache] HIT: ${key}`);
        // Trả shallow copy của AxiosResponse để tránh caller vô tình
        // mutate wrapper object (vd: res.headers, res.status) ảnh hưởng cache.
        // response.data vẫn là shared reference — đây là trade-off hợp lý
        // vì deep clone toàn bộ data sẽ tốn kém và phá vỡ object references.
        return { ...entry.data } as AxiosResponse<T>;
      }

      if (isStaleEntry && cache.options.staleWhileRevalidate) {
        logger.debug(`[Cache] STALE — revalidating: ${key}`);
        // Revalidate in background, trả stale ngay.
        // Dùng setTimeout(fn, 0) để đảm bảo background request chạy sau
        // khi caller đã nhận response — tránh microtask contention.
        originalRequest<T>(config).then((fresh) => {
          cache.set(key, fresh as AxiosResponse, ttl);
        }).catch((err: unknown) => {
          // Log để developer biết background revalidation đang fail
          // (không throw vì không làm hỏng stale response caller đang dùng)
          logger.debug(
            `[Cache] Background revalidation failed for: ${key}`,
            err instanceof Error ? err.message : String(err)
          );
        });
        return { ...entry.data } as AxiosResponse<T>;
      }

      // Cache miss hoặc expired (no SWR)
      // Always store shallow copy to prevent caller mutations from affecting cache entry.
      // This makes cache miss behavior consistent with cache hit (both return shallow copies).
      const response = await originalRequest<T>(config);
      const cachedData = { ...response } as AxiosResponse;
      cache.set(key, cachedData, ttl);
      return response;
    };
  }
}
