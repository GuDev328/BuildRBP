import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../../src/utils/logger';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('logger', () => {
  beforeEach(() => {
    // Enable logger cho toàn bộ test suite
    logger.enabled = true;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    logger.enabled = false;
  });

  // ── enabled flag ───────────────────────────────────────────────────────────

  describe('enabled flag', () => {
    it('không log gì khi enabled=false', () => {
      logger.enabled = false;
      logger.request({ method: 'get', url: '/test' });
      expect(console.log).not.toHaveBeenCalled();
    });

    it('log khi enabled=true', () => {
      logger.enabled = true;
      logger.request({ method: 'get', url: '/test' });
      // Trong Node environment, dùng console.log (không phải groupCollapsed)
      expect(console.log).toHaveBeenCalled();
    });
  });

  // ── logger.request ─────────────────────────────────────────────────────────

  describe('logger.request()', () => {
    it('trả về timestamp (number)', () => {
      const before = Date.now();
      const ts = logger.request({ method: 'get', url: '/test' });
      const after = Date.now();
      expect(typeof ts).toBe('number');
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it('trả về Date.now() khi disabled (không throw)', () => {
      logger.enabled = false;
      const ts = logger.request({ method: 'get', url: '/test' });
      expect(typeof ts).toBe('number');
    });

    it('log method và url đúng trong Node env', () => {
      logger.request({ method: 'post', url: '/users' });
      const logCall = (console.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(logCall).toContain('POST');
      expect(logCall).toContain('/users');
    });

    it('log params và body khi có', () => {
      logger.request({
        method: 'get',
        url: '/search',
        params: { q: 'hello' },
        body: { filter: 'active' },
      });
      // Không throw — chỉ verify log được gọi
      expect(console.log).toHaveBeenCalled();
    });
  });

  // ── logger.response ────────────────────────────────────────────────────────

  describe('logger.response()', () => {
    it('log status, method, url và duration', () => {
      const startTime = Date.now() - 150; // simulate 150ms ago
      logger.response({ method: 'get', url: '/test', status: 200 }, startTime);
      const logCall = (console.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(logCall).toContain('200');
      expect(logCall).toContain('GET');
      expect(logCall).toContain('/test');
      expect(logCall).toMatch(/\d+ms/);
    });

    it('không throw khi disabled', () => {
      logger.enabled = false;
      expect(() => {
        logger.response({ method: 'get', url: '/test', status: 200 }, Date.now());
      }).not.toThrow();
    });

    it('không log khi disabled', () => {
      logger.enabled = false;
      logger.response({ method: 'get', url: '/test', status: 200 }, Date.now());
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  // ── logger.error ───────────────────────────────────────────────────────────

  describe('logger.error()', () => {
    it('dùng console.error để log lỗi', () => {
      logger.error({ method: 'get', url: '/test', status: 500, error: 'Server error' }, Date.now());
      expect(console.error).toHaveBeenCalled();
    });

    it('log status ERR khi status là undefined', () => {
      logger.error({ method: 'get', url: '/test', error: 'network error' }, Date.now());
      const errorCall = (console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(errorCall).toContain('ERR');
    });

    it('log status number khi có', () => {
      logger.error({ method: 'delete', url: '/users/1', status: 403, error: 'Forbidden' }, Date.now());
      const errorCall = (console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(errorCall).toContain('403');
    });

    it('không throw khi disabled', () => {
      logger.enabled = false;
      expect(() => {
        logger.error({ method: 'get', url: '/', status: 500, error: 'err' }, Date.now());
      }).not.toThrow();
    });
  });

  // ── logger.warn ────────────────────────────────────────────────────────────

  describe('logger.warn()', () => {
    it('dùng console.warn', () => {
      logger.warn('Test warning message');
      expect(console.warn).toHaveBeenCalled();
    });

    it('log message chứa nội dung truyền vào', () => {
      logger.warn('[Mock] GET /test → 200');
      const warnCall = (console.warn as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(warnCall).toContain('[Mock]');
      expect(warnCall).toContain('/test');
    });

    it('forward extra args vào console.warn', () => {
      logger.warn('Message', { extra: 'data' });
      const calls = (console.warn as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(calls.length).toBeGreaterThan(1);
    });

    it('không throw khi disabled', () => {
      logger.enabled = false;
      expect(() => logger.warn('test')).not.toThrow();
    });

    it('không log khi disabled', () => {
      logger.enabled = false;
      logger.warn('should not log');
      expect(console.warn).not.toHaveBeenCalled();
    });
  });

  // ── logger.debug ───────────────────────────────────────────────────────────

  describe('logger.debug()', () => {
    it('dùng console.debug', () => {
      logger.debug('[Cache] HIT: /users');
      expect(console.debug).toHaveBeenCalled();
    });

    it('log message đúng nội dung', () => {
      logger.debug('[Dedup] Reusing request key');
      expect(console.debug).toHaveBeenCalled();
    });

    it('không throw khi disabled', () => {
      logger.enabled = false;
      expect(() => logger.debug('test')).not.toThrow();
    });

    it('không log khi disabled', () => {
      logger.enabled = false;
      logger.debug('should not appear');
      expect(console.debug).not.toHaveBeenCalled();
    });
  });
});
