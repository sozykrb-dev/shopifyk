import { describe, expect, it } from 'vitest';
import { devTenantOverride, isLocalHost, normalizeHost, resolveHost } from '../src/hosts.js';
import { ValidationError } from '../src/errors.js';

const BASE = 'velnorix.test';

describe('resolveHost', () => {
  it('routes the admin subdomain to the platform console', () => {
    expect(resolveHost('admin.velnorix.test', BASE)).toEqual({
      kind: 'platform',
      host: 'admin.velnorix.test',
    });
  });

  it('treats any other subdomain as a store', () => {
    expect(resolveHost('cairo-sneakers.velnorix.test', BASE)).toEqual({
      kind: 'store',
      host: 'cairo-sneakers.velnorix.test',
      slug: 'cairo-sneakers',
    });
  });

  it('ignores the port and letter case', () => {
    expect(resolveHost('Cairo-Sneakers.velnorix.test:443', BASE)).toMatchObject({
      kind: 'store',
      slug: 'cairo-sneakers',
    });
  });

  it('treats an off-domain host as a custom domain', () => {
    expect(resolveHost('www.my-brand.com', BASE)).toEqual({
      kind: 'store',
      host: 'www.my-brand.com',
      slug: 'www.my-brand.com',
    });
  });

  it('rejects the bare domain and nested subdomains', () => {
    expect(resolveHost('velnorix.test', BASE).kind).toBe('unknown');
    expect(resolveHost('a.b.velnorix.test', BASE).kind).toBe('unknown');
    expect(resolveHost('', BASE).kind).toBe('unknown');
  });

  it('never resolves a look-alike domain', () => {
    expect(resolveHost('velnorix.test.evil.com', BASE)).toMatchObject({
      kind: 'store',
      slug: 'velnorix.test.evil.com',
    });
    expect(resolveHost('notvelnorix.test', BASE).kind).toBe('store');
  });
});

describe('normalizeHost', () => {
  it('lowercases and strips the port', () => {
    expect(normalizeHost('  ADMIN.Velnorix.test:3000  ')).toBe('admin.velnorix.test');
    expect(normalizeHost(null)).toBe('');
  });
});

describe('isLocalHost', () => {
  it('detects loopback hosts', () => {
    expect(isLocalHost('localhost:3000')).toBe(true);
    expect(isLocalHost('127.0.0.1')).toBe(true);
    expect(isLocalHost('store.velnorix.test')).toBe(false);
  });
});

describe('devTenantOverride', () => {
  it('is disabled by default', () => {
    expect(devTenantOverride(new URLSearchParams('__tenant=demo'), false)).toBeNull();
  });

  it('accepts a valid slug when enabled', () => {
    expect(devTenantOverride(new URLSearchParams('__tenant=Cairo-Store'), true)).toBe(
      'cairo-store',
    );
  });

  it('rejects malformed slugs', () => {
    expect(() => devTenantOverride(new URLSearchParams('__tenant=../etc'), true)).toThrow(
      ValidationError,
    );
  });
});
