import type { AxiosRequestConfig } from 'axios';

let _binaryCounter = 0;

function isBinaryData(data: unknown): boolean {
  return (
    (typeof FormData !== 'undefined' && data instanceof FormData) ||
    (typeof Blob !== 'undefined' && data instanceof Blob) ||
    (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) ||
    (typeof File !== 'undefined' && data instanceof File) ||
    ArrayBuffer.isView(data)
  );
}

export function buildRequestKey(config: AxiosRequestConfig): string {
  const method = (config.method ?? 'get').toLowerCase();
  const url = config.url ?? '';

  let paramsStr = '';
  if (config.params) {
    try {
      // Stable ordering keeps equivalent param objects on the same key.
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
    // Binary payloads stringify to `{}`, so each request gets a unique key.
    if (isBinaryData(config.data)) {
      dataStr = `__binary_${++_binaryCounter}__`;
    } else {
      try {
        dataStr = typeof config.data === 'string' ? config.data : JSON.stringify(config.data);
      } catch {
        dataStr = String(config.data);
      }
    }
  }

  return JSON.stringify([method, url, paramsStr, dataStr]);
}
