/**
 * Upload and download helpers with progress tracking.
 */

import type { AxiosInstance, AxiosProgressEvent, AxiosRequestConfig } from 'axios';
import type { ApiResponse, RequestOptions } from '../types';

function toAxiosConfig(options: RequestOptions): AxiosRequestConfig {
  // Strip custom props that are not part of AxiosRequestConfig.
  const {
    onUploadProgress: _up,
    onDownloadProgress: _down,
    abortKey: _ak,
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
          // event.total may be undefined when the server omits Content-Length.
          const percent =
            event.total ? Math.round((event.loaded * 100) / event.total) : 0;
          onUploadProgress(percent, event);
        }
      : undefined,
  });

  // Response interceptor normalizes response.data to ApiResponse<T>.
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

  // responseType: 'blob' — axios returns a Blob directly in response.data,
  // bypassing the JSON normalization in the response interceptor.
  const response = await axiosInstance.get<Blob>(url, {
    ...axiosConfig,
    responseType: 'blob',
    onDownloadProgress: onDownloadProgress
      ? (event: AxiosProgressEvent) => {
          // event.total may be undefined when the server omits Content-Length.
          const percent =
            event.total ? Math.round((event.loaded * 100) / event.total) : 0;
          onDownloadProgress(percent, event);
        }
      : undefined,
  });

  const blob = response.data;

  if (autoDownload && typeof window !== 'undefined') {
    // Priority: downloadFileName option → Content-Disposition header → 'download'
    const contentDisposition =
      (response.headers?.['content-disposition'] as string | undefined) ?? '';
    const fileNameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    const fileName =
      downloadFileName ??
      (fileNameMatch ? fileNameMatch[1].replace(/['"]/g, '') : 'download');

    // Use try/finally to ensure URL.revokeObjectURL is always called,
    // preventing a memory leak if anchor.click() or removeChild() throws.
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
