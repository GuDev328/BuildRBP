import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AbortManager } from '../../src/core/AbortManager';

describe('AbortManager', () => {
  let manager: AbortManager;

  beforeEach(() => {
    manager = new AbortManager();
  });

  describe('register()', () => {
    it('trả về AbortSignal', () => {
      const signal = manager.register('test-key');
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
    });

    it('auto-cancel request cũ khi register cùng key', () => {
      const signal1 = manager.register('same-key');
      const signal2 = manager.register('same-key');

      expect(signal1.aborted).toBe(true);
      expect(signal2.aborted).toBe(false);
    });

    it('các key khác nhau không ảnh hưởng nhau', () => {
      const s1 = manager.register('key-1');
      const s2 = manager.register('key-2');

      expect(s1.aborted).toBe(false);
      expect(s2.aborted).toBe(false);
    });

    it('tăng pendingCount khi register', () => {
      manager.register('a');
      manager.register('b');
      expect(manager.pendingCount).toBe(2);
    });
  });

  describe('abort()', () => {
    it('hủy signal của key đúng', () => {
      const signal = manager.register('my-key');
      manager.abort('my-key');
      expect(signal.aborted).toBe(true);
    });

    it('giảm pendingCount sau khi abort', () => {
      manager.register('a');
      manager.register('b');
      manager.abort('a');
      expect(manager.pendingCount).toBe(1);
    });

    it('không throw khi abort key không tồn tại', () => {
      expect(() => manager.abort('nonexistent')).not.toThrow();
    });
  });

  describe('abortAll()', () => {
    it('hủy tất cả pending signals', () => {
      const s1 = manager.register('a');
      const s2 = manager.register('b');
      const s3 = manager.register('c');

      manager.abortAll();

      expect(s1.aborted).toBe(true);
      expect(s2.aborted).toBe(true);
      expect(s3.aborted).toBe(true);
    });

    it('pendingCount = 0 sau abortAll()', () => {
      manager.register('a');
      manager.register('b');
      manager.abortAll();
      expect(manager.pendingCount).toBe(0);
    });

    it('không throw khi không có pending requests', () => {
      expect(() => manager.abortAll()).not.toThrow();
    });

    it('có thể register lại sau abortAll()', () => {
      manager.register('a');
      manager.abortAll();
      const signal = manager.register('a');
      expect(signal.aborted).toBe(false);
      expect(manager.pendingCount).toBe(1);
    });
  });

  describe('clear()', () => {
    it('xóa key khỏi map mà không abort signal', () => {
      const signal = manager.register('my-key');
      manager.clear('my-key');
      // Signal không bị abort, chỉ bị remove khỏi map
      expect(signal.aborted).toBe(false);
      expect(manager.pendingCount).toBe(0);
    });
  });

  describe('pendingKeys', () => {
    it('trả về danh sách keys đang pending', () => {
      manager.register('a');
      manager.register('b');
      expect(manager.pendingKeys).toContain('a');
      expect(manager.pendingKeys).toContain('b');
    });
  });
});
