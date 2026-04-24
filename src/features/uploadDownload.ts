/**
 * Upload/Download helpers với progress tracking
 */

import type { AxiosInstance, AxiosProgressEvent, AxiosRequestConfig } from 'axios';
import type { ApiResponse, RequestOptions } from '../types';

function toAxiosConfig(options: RequestOptions): AxiosRequestConfig {
  // Loại bỏ các custom props không thuộc AxiosRequestConfig
  const {
    onUploadProgress: _up,
    onDownloadProgress: _down,
    abortKey: _ak,
    cacheTtl: _ct,
    skipCache: _sc,
    skipDedup: _sd,
    autoDownload: _ad,
    downloadFileName: _dfn,
    ...axiosOptions
  } = options;
  return axiosOptions as AxiosRequestConfig;
}

// ─── Upload ───────────────────────────────────────────────────────────────────

export async function uploadFile<T = unknown>(
  axiosInstance: AxiosInstance,
  url: string,
  formData: FormData,
  options: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const { onUploadProgress } = options;
  const axiosConfig = toAxiosConfig(options);

  const response = await axiosInstance.post(url, formData, {
    ...axiosConfig,
    headers: {
      ...axiosConfig.headers,
      'Content-Type': 'multipart/form-data',
    },
    onUploadProgress: onUploadProgress
      ? (event: AxiosProgressEvent) => {
          // event.total có thể undefined nếu server không gửi Content-Length
          const percent =
            event.total ? Math.round((event.loaded * 100) / event.total) : 0;
          onUploadProgress(percent, event);
        }
      : undefined,
  });

  // Response interceptor đã normalize response.data thành ApiResponse<T>
  return response.data as ApiResponse<T>;
}

// ─── Download ─────────────────────────────────────────────────────────────────

export async function downloadFile(
  axiosInstance: AxiosInstance,
  url: string,
  options: RequestOptions = {}
): Promise<Blob> {
  const { onDownloadProgress, autoDownload, downloadFileName } = options;
  const axiosConfig = toAxiosConfig(options);

  // responseType: 'blob' — axios trả về Blob trực tiếp trong response.data
  // (KHÔNG đi qua response interceptor normalize vì data không phải JSON)
  const response = await axiosInstance.get<Blob>(url, {
    ...axiosConfig,
    responseType: 'blob',
    onDownloadProgress: onDownloadProgress
      ? (event: AxiosProgressEvent) => {
          // event.total có thể undefined nếu server không gửi Content-Length
          const percent =
            event.total ? Math.round((event.loaded * 100) / event.total) : 0;
          onDownloadProgress(percent, event);
        }
      : undefined,
  });

  const blob = response.data;

  // Auto trigger browser download nếu đang ở môi trường browser
  if (autoDownload && typeof window !== 'undefined') {
    // Ưu tiên: downloadFileName option → Content-Disposition header → fallback 'download'
    const contentDisposition =
      (response.headers?.['content-disposition'] as string | undefined) ?? '';
    const fileNameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    const fileName =
      downloadFileName ??
      (fileNameMatch ? fileNameMatch[1].replace(/['"]/g, '') : 'download');

    // Dùng try/finally để đảm bảo URL.revokeObjectURL luôn được gọi,
    // tránh memory leak dù anchor.click() hay removeChild() có throw
    const href = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } finally {
      URL.revokeObjectURL(href);
    }
  }

  return blob;
}
