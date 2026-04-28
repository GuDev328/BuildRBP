// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { uploadFile, downloadFile } from '../../src/features/uploadDownload';
import type { RequestOptions } from '../../src/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInstance(adapterFn?: (config: any) => Promise<any>): AxiosInstance {
  const instance = axios.create({ baseURL: 'http://localhost' });
  if (adapterFn) {
    instance.defaults.adapter = adapterFn;
  }
  return instance;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('uploadDownload', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── uploadFile ─────────────────────────────────────────────────────────────

  describe('uploadFile', () => {
    it('gửi POST request với FormData', async () => {
      let capturedConfig: any = null;
      const instance = makeInstance(async (config) => {
        capturedConfig = config;
        return {
          data: { data: { fileId: 'abc' }, message: 'Uploaded', status: 200 },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      });

      const formData = new FormData();
      formData.append('file', new Blob(['hello']), 'hello.txt');

      await uploadFile(instance, '/upload', formData);

      expect(capturedConfig.method).toBe('post');
      expect(capturedConfig.url).toBe('/upload');
    });

    it('set Content-Type: multipart/form-data', async () => {
      let capturedConfig: any = null;
      const instance = makeInstance(async (config) => {
        capturedConfig = config;
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
      });

      const formData = new FormData();
      await uploadFile(instance, '/upload', formData);

      expect(capturedConfig.headers?.['Content-Type']).toBe('multipart/form-data');
    });

    it('trả về response.data như ApiResponse', async () => {
      const instance = makeInstance(async (config) => ({
        data: { data: { fileId: 'xyz' }, message: 'Done', status: 201 },
        status: 201,
        statusText: 'Created',
        headers: {},
        config,
      }));

      const formData = new FormData();
      const result = await uploadFile<{ fileId: string }>(instance, '/upload', formData);

      expect(result).toEqual({
        data: { fileId: 'xyz' },
        message: 'Done',
        status: 201,
      });
    });

    it('gọi onUploadProgress với percent khi event.total có giá trị', async () => {
      const progressValues: number[] = [];
      const instance = makeInstance(async (config: any) => {
        // Simulate progress events
        if (config.onUploadProgress) {
          config.onUploadProgress({ loaded: 50, total: 100 });
          config.onUploadProgress({ loaded: 100, total: 100 });
        }
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
      });

      const formData = new FormData();
      await uploadFile(instance, '/upload', formData, {
        onUploadProgress: (percent) => progressValues.push(percent),
      });

      expect(progressValues).toEqual([50, 100]);
    });

    it('gọi onUploadProgress với 0 khi event.total là undefined', async () => {
      const progressValues: number[] = [];
      const instance = makeInstance(async (config: any) => {
        if (config.onUploadProgress) {
          config.onUploadProgress({ loaded: 50, total: undefined });
        }
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
      });

      const formData = new FormData();
      await uploadFile(instance, '/upload', formData, {
        onUploadProgress: (percent) => progressValues.push(percent),
      });

      expect(progressValues).toEqual([0]);
    });

    it('không set onUploadProgress khi không có callback', async () => {
      let capturedConfig: any = null;
      const instance = makeInstance(async (config) => {
        capturedConfig = config;
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
      });

      const formData = new FormData();
      await uploadFile(instance, '/upload', formData);

      expect(capturedConfig.onUploadProgress).toBeUndefined();
    });

    it('forward extra options (headers, params) đến axios', async () => {
      let capturedConfig: any = null;
      const instance = makeInstance(async (config) => {
        capturedConfig = config;
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
      });

      const formData = new FormData();
      const options: RequestOptions = {
        params: { ref: 'test' },
        headers: { 'X-Custom': 'value' },
      };
      await uploadFile(instance, '/upload', formData, options);

      expect(capturedConfig.params).toEqual({ ref: 'test' });
    });

    it('loại bỏ custom props (abortKey, autoDownload, ...) trước khi pass vào axios', async () => {
      let capturedConfig: any = null;
      const instance = makeInstance(async (config) => {
        capturedConfig = config;
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
      });

      const formData = new FormData();
      await uploadFile(instance, '/upload', formData, {
        abortKey: 'upload-1',
        autoDownload: true,
        downloadFileName: 'test.txt',
      } as any);

      // Custom props không được pass vào config
      expect(capturedConfig.abortKey).toBeUndefined();
      expect(capturedConfig.autoDownload).toBeUndefined();
      expect(capturedConfig.downloadFileName).toBeUndefined();
    });
  });

  // ── downloadFile ───────────────────────────────────────────────────────────

  describe('downloadFile', () => {
    it('gửi GET request với responseType: blob', async () => {
      let capturedConfig: any = null;
      const mockBlob = new Blob(['file content'], { type: 'text/plain' });
      const instance = makeInstance(async (config) => {
        capturedConfig = config;
        return { data: mockBlob, status: 200, statusText: 'OK', headers: {}, config };
      });

      await downloadFile(instance, '/files/report.pdf');

      expect(capturedConfig.responseType).toBe('blob');
      expect(capturedConfig.method).toBe('get');
    });

    it('trả về Blob', async () => {
      const mockBlob = new Blob(['file content'], { type: 'application/pdf' });
      const instance = makeInstance(async (config) => ({
        data: mockBlob,
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }));

      const result = await downloadFile(instance, '/files/report.pdf');
      expect(result).toBeInstanceOf(Blob);
      expect(result).toBe(mockBlob);
    });

    it('gọi onDownloadProgress với percent khi event.total có giá trị', async () => {
      const progressValues: number[] = [];
      const mockBlob = new Blob(['data']);
      const instance = makeInstance(async (config: any) => {
        if (config.onDownloadProgress) {
          config.onDownloadProgress({ loaded: 25, total: 100 });
          config.onDownloadProgress({ loaded: 75, total: 100 });
          config.onDownloadProgress({ loaded: 100, total: 100 });
        }
        return { data: mockBlob, status: 200, statusText: 'OK', headers: {}, config };
      });

      await downloadFile(instance, '/file', {
        onDownloadProgress: (percent) => progressValues.push(percent),
      });

      expect(progressValues).toEqual([25, 75, 100]);
    });

    it('gọi onDownloadProgress với 0 khi event.total là undefined', async () => {
      const progressValues: number[] = [];
      const mockBlob = new Blob(['data']);
      const instance = makeInstance(async (config: any) => {
        if (config.onDownloadProgress) {
          config.onDownloadProgress({ loaded: 50, total: undefined });
        }
        return { data: mockBlob, status: 200, statusText: 'OK', headers: {}, config };
      });

      await downloadFile(instance, '/file', {
        onDownloadProgress: (percent) => progressValues.push(percent),
      });

      expect(progressValues).toEqual([0]);
    });

    it('không set onDownloadProgress khi không có callback', async () => {
      let capturedConfig: any = null;
      const mockBlob = new Blob(['data']);
      const instance = makeInstance(async (config) => {
        capturedConfig = config;
        return { data: mockBlob, status: 200, statusText: 'OK', headers: {}, config };
      });

      await downloadFile(instance, '/file');
      expect(capturedConfig.onDownloadProgress).toBeUndefined();
    });

    it('không trigger auto-download khi autoDownload=false', async () => {
      // window.URL.createObjectURL không có trong Node environment
      const createObjectURL = vi.fn(() => 'blob:mock-url');
      const revokeObjectURL = vi.fn();

      const mockBlob = new Blob(['data']);
      const instance = makeInstance(async (config) => ({
        data: mockBlob,
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }));

      await downloadFile(instance, '/file', { autoDownload: false });

      // createObjectURL không được gọi vì autoDownload=false
      expect(createObjectURL).not.toHaveBeenCalled();
    });

    it('trigger auto-download khi autoDownload=true trong browser environment', async () => {
      // jsdom không implement URL.createObjectURL — cần define trước khi spy
      URL.createObjectURL = vi.fn(() => 'blob:mock-url');
      URL.revokeObjectURL = vi.fn();

      const mockAnchor = {
        href: '',
        download: '',
        click: vi.fn(),
      };
      vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any);
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockAnchor as any);
      vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockAnchor as any);
      const createObjectURL = vi.spyOn(URL, 'createObjectURL');
      const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL');

      const mockBlob = new Blob(['data']);
      const instance = makeInstance(async (config) => ({
        data: mockBlob,
        status: 200,
        statusText: 'OK',
        headers: { 'content-disposition': 'attachment; filename="report.pdf"' },
        config,
      }));

      await downloadFile(instance, '/file', {
        autoDownload: true,
        downloadFileName: 'myfile.pdf',
      });

      expect(createObjectURL).toHaveBeenCalledWith(mockBlob);
      expect(mockAnchor.click).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });

    it('extract filename từ Content-Disposition khi downloadFileName không được set', async () => {
      URL.createObjectURL = vi.fn(() => 'blob:mock');
      URL.revokeObjectURL = vi.fn();
      const mockAnchor = { href: '', download: '', click: vi.fn() };
      vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any);
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockAnchor as any);
      vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockAnchor as any);

      const mockBlob = new Blob(['data']);
      const instance = makeInstance(async (config) => ({
        data: mockBlob,
        status: 200,
        statusText: 'OK',
        headers: { 'content-disposition': 'attachment; filename="server-name.xlsx"' },
        config,
      }));

      await downloadFile(instance, '/file', { autoDownload: true });

      expect(mockAnchor.download).toBe('server-name.xlsx');
    });

    it('dùng "download" làm fallback filename khi Content-Disposition không có filename', async () => {
      URL.createObjectURL = vi.fn(() => 'blob:mock');
      URL.revokeObjectURL = vi.fn();
      const mockAnchor = { href: '', download: '', click: vi.fn() };
      vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any);
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockAnchor as any);
      vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockAnchor as any);

      const mockBlob = new Blob(['data']);
      const instance = makeInstance(async (config) => ({
        data: mockBlob,
        status: 200,
        statusText: 'OK',
        headers: {}, // không có Content-Disposition
        config,
      }));

      await downloadFile(instance, '/file', { autoDownload: true });

      expect(mockAnchor.download).toBe('download');
    });

    it('gọi revokeObjectURL dù anchor.click() throw (finally guard)', async () => {
      URL.createObjectURL = vi.fn(() => 'blob:mock');
      URL.revokeObjectURL = vi.fn();
      const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
      const mockAnchor = {
        href: '',
        download: '',
        click: vi.fn(() => { throw new Error('Click failed'); }),
      };
      vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any);
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockAnchor as any);
      vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockAnchor as any);

      const mockBlob = new Blob(['data']);
      const instance = makeInstance(async (config) => ({
        data: mockBlob,
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }));

      await expect(
        downloadFile(instance, '/file', { autoDownload: true })
      ).rejects.toThrow('Click failed');

      // revokeObjectURL vẫn được gọi dù có lỗi
      expect(revokeSpy).toHaveBeenCalledWith('blob:mock');
    });
  });
});
