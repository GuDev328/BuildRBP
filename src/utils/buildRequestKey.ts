import type { AxiosRequestConfig } from 'axios';

/**
 * Tạo unique string key từ method + url + params + data
 * Dùng cho: AbortManager, Deduplicator, Cache
 */
export function buildRequestKey(config: AxiosRequestConfig): string {
  const method = (config.method ?? 'get').toLowerCase();
  const url = config.url ?? '';

  let paramsStr = '';
  if (config.params) {
    try {
      // Sort keys để đảm bảo { a:1, b:2 } và { b:2, a:1 } cùng key
      const sorted = Object.fromEntries(
        Object.entries(config.params as Record<string, unknown>).sort(([a], [b]) =>
          a.localeCompare(b)
        )
      );
      paramsStr = JSON.stringify(sorted);
    } catch {
      paramsStr = String(config.params);
    }
  }

  let dataStr = '';
  if (config.data && method !== 'get') {
    try {
      dataStr = typeof config.data === 'string' ? config.data : JSON.stringify(config.data);
    } catch {
      dataStr = String(config.data);
    }
  }

  return JSON.stringify([method, url, paramsStr, dataStr]);
}
