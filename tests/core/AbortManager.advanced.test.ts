/**
 * Advanced AbortManager tests:
 *  - register() trả về signal đã abort khi gọi lần 2 cùng key
 *  - abort() signal thực sự bị aborted
 *  - abortAll() + register lại
 *  - pendingKeys danh sách đúng
 *  - multiple keys independent
 *  - Signal abort listener fires
 */

import { describe, it, expect, vi } from 'vitest';
import { AbortManager } from '../../src/core/AbortManager';

describe('AbortManager — advanced', () => {
  // ── register() auto-cancel ─────────────────────────────────────────────────

  describe('register() — duplicate key handling', () => {
    it('register cùng key lần 2 → signal cũ bị abort', () => {
      const manager = new AbortManager();
      const signal1 = manager.register('key1');

      // Đăng ký lần 2 → signal cũ bị cancel
      manager.register('key1');

      expect(signal1.aborted).toBe(true);
    });

    it('register cùng key lần 2 → trả về signal MỚI (chưa abort)', () => {
      const manager = new AbortManager();
      const signal1 = manager.register('key1');
      const signal2 = manager.register('key1');

      expect(signal1).not.toBe(signal2);
      expect(signal2.aborted).toBe(false);
    });

    it('pendingCount không tăng khi register duplicate key', () => {
      const manager = new AbortManager();
      manager.register('key1');
      expect(manager.pendingCount).toBe(1);
      manager.register('key1'); // replace, không add
      expect(manager.pendingCount).toBe(1);
    });

    it('register nhiều key khác nhau → pendingCount tăng đúng', () => {
      const manager = new AbortManager();
      manager.register('a');
      manager.register('b');
      manager.register('c');
      expect(manager.pendingCount).toBe(3);
    });
  });

  // ── abort() actual signal state ────────────────────────────────────────────

  describe('abort() — signal state verification', () => {
    it('signal.aborted=true sau khi abort(key)', () => {
      const manager = new AbortManager();
      const signal = manager.register('req-1');
      expect(signal.aborted).toBe(false);

      manager.abort('req-1');
      expect(signal.aborted).toBe(true);
    });

    it('abort() listener fires khi signal bị abort', () => {
      const manager = new AbortManager();
      const signal = manager.register('req-1');
      const listener = vi.fn();
      signal.addEventListener('abort', listener);

      manager.abort('req-1');
      expect(listener).toHaveBeenCalledOnce();
    });

    it('abort() chỉ ảnh hưởng key đúng — key khác không bị abort', () => {
      const manager = new AbortManager();
      const s1 = manager.register('k1');
      const s2 = manager.register('k2');
      const s3 = manager.register('k3');

      manager.abort('k2');

      expect(s1.aborted).toBe(false);
      expect(s2.aborted).toBe(true);
      expect(s3.aborted).toBe(false);
    });

    it('pendingCount giảm sau khi abort', () => {
      const manager = new AbortManager();
      manager.register('k1');
      manager.register('k2');
      expect(manager.pendingCount).toBe(2);

      manager.abort('k1');
      expect(manager.pendingCount).toBe(1);
    });
  });

  // ── abortAll() ─────────────────────────────────────────────────────────────

  describe('abortAll() comprehensive', () => {
    it('tất cả signals bị abort sau abortAll()', () => {
      const manager = new AbortManager();
      const signals = ['a', 'b', 'c', 'd'].map((k) => ({
        key: k,
        signal: manager.register(k),
      }));

      manager.abortAll();

      signals.forEach(({ signal }) => {
        expect(signal.aborted).toBe(true);
      });
    });

    it('pendingCount=0 sau abortAll()', () => {
      const manager = new AbortManager();
      manager.register('a');
      manager.register('b');
      manager.register('c');
      manager.abortAll();
      expect(manager.pendingCount).toBe(0);
    });

    it('có thể register lại sau abortAll()', () => {
      const manager = new AbortManager();
      manager.register('k1');
      manager.abortAll();
      expect(manager.pendingCount).toBe(0);

      const newSignal = manager.register('k1');
      expect(newSignal.aborted).toBe(false);
      expect(manager.pendingCount).toBe(1);
    });

    it('abortAll trên manager rỗng không throw', () => {
      const manager = new AbortManager();
      expect(() => manager.abortAll()).not.toThrow();
    });

    it('listeners của tất cả signals đều được gọi khi abortAll()', () => {
      const manager = new AbortManager();
      const listeners = ['a', 'b', 'c'].map((k) => {
        const signal = manager.register(k);
        const fn = vi.fn();
        signal.addEventListener('abort', fn);
        return fn;
      });

      manager.abortAll();
      listeners.forEach((fn) => expect(fn).toHaveBeenCalledOnce());
    });
  });

  // ── clear() ────────────────────────────────────────────────────────────────

  describe('clear() — remove without abort', () => {
    it('clear() xóa key khỏi pending map', () => {
      const manager = new AbortManager();
      manager.register('k1');
      expect(manager.pendingCount).toBe(1);
      manager.clear('k1');
      expect(manager.pendingCount).toBe(0);
    });

    it('clear() KHÔNG abort signal — signal vẫn usable', () => {
      const manager = new AbortManager();
      const signal = manager.register('k1');
      manager.clear('k1');
      // Signal không bị abort — vẫn fresh
      expect(signal.aborted).toBe(false);
    });

    it('clear() key không tồn tại không throw', () => {
      const manager = new AbortManager();
      expect(() => manager.clear('ghost')).not.toThrow();
    });

    it('clear() nhiều keys riêng biệt', () => {
      const manager = new AbortManager();
      manager.register('a');
      manager.register('b');
      manager.register('c');
      manager.clear('a');
      manager.clear('c');
      expect(manager.pendingCount).toBe(1);
      expect(manager.pendingKeys).toEqual(['b']);
    });
  });

  // ── pendingKeys ────────────────────────────────────────────────────────────

  describe('pendingKeys', () => {
    it('trả về empty array khi không có pending', () => {
      const manager = new AbortManager();
      expect(manager.pendingKeys).toEqual([]);
    });

    it('trả về đúng list keys đang pending', () => {
      const manager = new AbortManager();
      manager.register('request-1');
      manager.register('request-2');
      manager.register('request-3');

      const keys = manager.pendingKeys;
      expect(keys).toContain('request-1');
      expect(keys).toContain('request-2');
      expect(keys).toContain('request-3');
      expect(keys).toHaveLength(3);
    });

    it('pendingKeys được cập nhật sau abort()', () => {
      const manager = new AbortManager();
      manager.register('a');
      manager.register('b');
      manager.abort('a');
      expect(manager.pendingKeys).toEqual(['b']);
    });

    it('pendingKeys rỗng sau abortAll()', () => {
      const manager = new AbortManager();
      manager.register('a');
      manager.register('b');
      manager.abortAll();
      expect(manager.pendingKeys).toEqual([]);
    });
  });

  // ── AbortController integration ────────────────────────────────────────────

  describe('AbortSignal integration with fetch/axios', () => {
    it('signal được trả về là instance AbortSignal', () => {
      const manager = new AbortManager();
      const signal = manager.register('fetch-1');
      expect(signal).toBeInstanceOf(AbortSignal);
    });

    it('nhiều lần abort() cùng key idempotent — không throw', () => {
      const manager = new AbortManager();
      manager.register('k1');
      manager.abort('k1');
      // Key đã bị xóa sau abort — gọi lại không throw
      expect(() => manager.abort('k1')).not.toThrow();
    });

    it('abort sau clear() — key không còn trong map → no-op', () => {
      const manager = new AbortManager();
      const signal = manager.register('k1');
      manager.clear('k1'); // xóa mà không abort
      manager.abort('k1'); // abort key không tồn tại → no-op

      expect(signal.aborted).toBe(false); // signal gốc không bị abort
    });
  });
});
