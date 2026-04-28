// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildRequestKey } from '../../src/utils/buildRequestKey';

describe('buildRequestKey', () => {
  it('tạo key từ method + url', () => {
    const key = buildRequestKey({ method: 'get', url: '/users' });
    expect(key).toBe(JSON.stringify(['get', '/users', '', '']));
  });

  it('normalize method về lowercase', () => {
    const k1 = buildRequestKey({ method: 'GET', url: '/users' });
    const k2 = buildRequestKey({ method: 'get', url: '/users' });
    expect(k1).toBe(k2);
  });

  it('default method là get khi không truyền', () => {
    const k1 = buildRequestKey({ url: '/users' });
    const k2 = buildRequestKey({ method: 'get', url: '/users' });
    expect(k1).toBe(k2);
  });

  it('params order khác nhau → cùng key (deterministic)', () => {
    const k1 = buildRequestKey({ method: 'get', url: '/users', params: { b: 2, a: 1 } });
    const k2 = buildRequestKey({ method: 'get', url: '/users', params: { a: 1, b: 2 } });
    expect(k1).toBe(k2);
  });

  it('params khác nhau → key khác nhau', () => {
    const k1 = buildRequestKey({ method: 'get', url: '/users', params: { page: 1 } });
    const k2 = buildRequestKey({ method: 'get', url: '/users', params: { page: 2 } });
    expect(k1).not.toBe(k2);
  });

  it('URL có ký tự đặc biệt không gây collision', () => {
    const k1 = buildRequestKey({ method: 'get', url: '/a:b' });
    const k2 = buildRequestKey({ method: 'get', url: '/a', params: { b: '' } });
    expect(k1).not.toBe(k2);
  });

  it('không include data trong GET key', () => {
    const k1 = buildRequestKey({ method: 'get', url: '/users', data: { foo: 'bar' } });
    const k2 = buildRequestKey({ method: 'get', url: '/users' });
    expect(k1).toBe(k2);
  });

  it('include data trong POST key', () => {
    const k1 = buildRequestKey({ method: 'post', url: '/users', data: { name: 'Alice' } });
    const k2 = buildRequestKey({ method: 'post', url: '/users', data: { name: 'Bob' } });
    expect(k1).not.toBe(k2);
  });

  it('URL default là empty string khi không truyền', () => {
    const key = buildRequestKey({ method: 'get' });
    expect(key).toBe(JSON.stringify(['get', '', '', '']));
  });

  // ── Binary data (FormData / Blob) — Bug #4 fix ─────────────────────────────

  it('FormData: 2 requests cùng URL tạo key KHÁC NHAU — không auto-cancel nhau', () => {
    const fd1 = new FormData();
    const fd2 = new FormData();
    const k1 = buildRequestKey({ method: 'post', url: '/upload', data: fd1 });
    const k2 = buildRequestKey({ method: 'post', url: '/upload', data: fd2 });
    // Phải khác nhau để mỗi upload có AbortController riêng
    expect(k1).not.toBe(k2);
  });

  it('Blob: 2 requests cùng URL tạo key KHÁC NHAU', () => {
    const b1 = new Blob(['hello']);
    const b2 = new Blob(['world']);
    const k1 = buildRequestKey({ method: 'post', url: '/upload', data: b1 });
    const k2 = buildRequestKey({ method: 'post', url: '/upload', data: b2 });
    expect(k1).not.toBe(k2);
  });

  it('FormData và JSON body cùng URL → key khác nhau', () => {
    const fd = new FormData();
    const k1 = buildRequestKey({ method: 'post', url: '/api', data: fd });
    const k2 = buildRequestKey({ method: 'post', url: '/api', data: { name: 'Alice' } });
    expect(k1).not.toBe(k2);
  });

  it('binary dataStr chứa __binary_ prefix để phân biệt', () => {
    const fd = new FormData();
    const key = buildRequestKey({ method: 'post', url: '/upload', data: fd });
    const parsed = JSON.parse(key) as string[];
    expect(parsed[3]).toMatch(/^__binary_\d+__$/);
  });
});
