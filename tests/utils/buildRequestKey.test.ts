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
    // URL /a:b và /a với params {b:''} không được collision
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
});
