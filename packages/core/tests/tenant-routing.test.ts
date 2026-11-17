import { describe, expect, it } from 'vitest';
import { classifyTenantHost } from '../src/hosts.js';

const BASE = 'velnorix.test';
const ADMIN = 'admin.velnorix.test';

type Options = Partial<Parameters<typeof classifyTenantHost>[1]>;

/** `classifyTenantHost(host, options)` — the one host → tenant rule. */
const classify = (host: string | null, options: Options = {}) =>
  classifyTenantHost(host, { baseDomain: BASE, ...options });

describe('classifyTenantHost', () => {
  it('routes the platform console host to the platform context', () => {
    expect(classify(ADMIN, { adminHost: ADMIN })).toEqual({
      host: 'admin.velnorix.test',
      kind: 'platform',
      storeSlug: null,
      devTenant: null,
    });
  });

  it('never lets a store be called "admin"', () => {
    expect(classify(ADMIN, { adminHost: ADMIN }).kind).toBe('platform');
    // Without an explicit console host the shared rule still applies.
    expect(classify(ADMIN).kind).toBe('platform');
  });

  it('routes a store subdomain to that store', () => {
    const result = classify('cairo-sneakers.velnorix.test');
    expect(result.kind).toBe('store');
    expect(result.storeSlug).toBe('cairo-sneakers');
    expect(result.devTenant).toBeNull();
  });

  it('treats a foreign host as a custom domain belonging to a store', () => {
    const result = classify('www.cairo-sneakers.com');
    expect(result.kind).toBe('store');
    expect(result.storeSlug).toBe('www.cairo-sneakers.com');
  });

  it('normalises the Host header before classifying', () => {
    const result = classify('  Cairo-Sneakers.VELNORIX.test:3001  ');
    expect(result.host).toBe('cairo-sneakers.velnorix.test');
    expect(result.storeSlug).toBe('cairo-sneakers');
  });

  it('treats localhost as the platform host when there is no subdomain', () => {
    expect(classify('localhost:3001').kind).toBe('platform');
    expect(classify('127.0.0.1:3100', { treatLocalhostAsPlatform: false }).kind).toBe('store');
  });

  it('reads a dev subdomain from `*.localhost`', () => {
    const result = classify('cairo-sneakers.localhost:3001');
    expect(result.host).toBe('cairo-sneakers.localhost');
    expect(result.kind).toBe('store');
    expect(result.storeSlug).toBe('cairo-sneakers');
  });

  it('never lets a tenant override escape when it is disabled', () => {
    expect(
      classify('localhost:3001', {
        devOverrideEnabled: false,
        query: new URLSearchParams({ __tenant: 'zad-naturals' }),
      }).storeSlug,
    ).toBeNull();
  });

  it('pins a store through the query override when enabled', () => {
    const result = classify('localhost:3001', {
      devOverrideEnabled: true,
      query: new URLSearchParams({ __tenant: 'Zad-Naturals' }),
    });
    expect(result.kind).toBe('store');
    expect(result.storeSlug).toBe('zad-naturals');
    expect(result.devTenant).toBe('zad-naturals');
  });

  it('remembers the pinned store through the dev tenant cookie', () => {
    const result = classify('localhost:3001', {
      devOverrideEnabled: true,
      devTenantCookie: 'zad-naturals',
    });
    expect(result.kind).toBe('store');
    expect(result.storeSlug).toBe('zad-naturals');
  });

  it('ignores an invalid dev override instead of trusting it', () => {
    const result = classify('localhost:3001', {
      devOverrideEnabled: true,
      devTenantCookie: 'not a slug!',
    });
    expect(result.storeSlug).toBeNull();
    expect(result.devTenant).toBeNull();
  });

  it('prefers the query override over the cookie', () => {
    const result = classify('localhost:3001', {
      devOverrideEnabled: true,
      query: new URLSearchParams({ __tenant: 'cairo-sneakers' }),
      devTenantCookie: 'zad-naturals',
    });
    expect(result.storeSlug).toBe('cairo-sneakers');
  });

  it('lets the override win over the admin host', () => {
    const result = classify(ADMIN, {
      adminHost: ADMIN,
      devOverrideEnabled: true,
      query: new URLSearchParams({ __tenant: 'zad-naturals' }),
    });
    expect(result.kind).toBe('store');
    expect(result.storeSlug).toBe('zad-naturals');
  });

  it('marks a bare platform domain as unknown', () => {
    expect(classify('velnorix.test').kind).toBe('unknown');
  });

  it('never returns a store slug for an empty host', () => {
    expect(classify(null, { devOverrideEnabled: true })).toMatchObject({
      host: '',
      kind: 'unknown',
      storeSlug: null,
    });
  });
});
