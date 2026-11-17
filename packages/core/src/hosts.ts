import { ValidationError } from './errors.js';

/**
 * Host-based tenant resolution.
 *
 * Production routing is purely host based:
 *
 *   admin.velnorix.com     -> platform console (super admin / platform staff)
 *   {store}.velnorix.com   -> that store's storefront
 *   {store}.velnorix.com/admin -> that store's admin
 *   www.my-brand.com       -> a verified custom domain for one store
 *
 * This module is pure and dependency free so it can run in the edge runtime
 * (middleware) as well as on the server.
 */

export type HostResolution =
  | { kind: 'platform'; host: string }
  | { kind: 'store'; host: string; slug: string }
  | { kind: 'unknown'; host: string };

/** Strips the port and lowercases; the Host header is user input. */
export function normalizeHost(host: string | null | undefined): string {
  if (!host) return '';
  return host.trim().toLowerCase().split(':')[0] ?? '';
}

/**
 * Classifies a host.
 *
 * `admin.velnorix.com` is the platform console; anything else on the platform
 * domain is a store subdomain. A host that is not on the platform domain is a
 * custom domain: the caller resolves it against `store_domains`.
 */
export function resolveHost(
  host: string,
  baseDomain: string,
  options: { adminSubdomain?: string } = {},
): HostResolution {
  const normalizedHost = normalizeHost(host);
  const normalizedBase = normalizeHost(baseDomain);
  if (!normalizedHost || !normalizedBase) return { kind: 'unknown', host: normalizedHost };

  const adminSubdomain = options.adminSubdomain ?? 'admin';

  if (normalizedHost === normalizedBase) return { kind: 'unknown', host: normalizedHost };

  if (normalizedHost.endsWith(`.${normalizedBase}`)) {
    const label = normalizedHost.slice(0, -(normalizedBase.length + 1));
    // Only the first label is a store slug: `a.b.velnorix.com` is not a store.
    if (!label || label.includes('.')) return { kind: 'unknown', host: normalizedHost };
    if (label === adminSubdomain) return { kind: 'platform', host: normalizedHost };
    return { kind: 'store', host: normalizedHost, slug: label };
  }

  if (normalizedHost === normalizedBase.replace(/^www\./, '')) {
    return { kind: 'unknown', host: normalizedHost };
  }

  // Not on the platform domain: treat as a custom domain, resolved by the
  // caller against the `store_domains` table.
  return { kind: 'store', host: normalizedHost, slug: normalizedHost };
}

/** True for hosts that can never be a store (localhost, IPs, ...). */
export function isLocalHost(host: string): boolean {
  const normalized = normalizeHost(host);
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    /^127\.\d+\.\d+\.\d+$/.test(normalized) ||
    normalized === '::1'
  );
}

/**
 * Development tenant override.
 *
 * With a wildcard domain, a developer (or a preview environment) has no
 * subdomain to work with, so a tenant can be pinned through `?__tenant=slug`.
 * It is a no-op unless the deployment explicitly enables it.
 */
export function devTenantOverride(params: URLSearchParams, enabled: boolean): string | null {
  if (!enabled) return null;
  const value = params.get('__tenant');
  if (!value) return null;
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(slug)) {
    throw new ValidationError('Invalid tenant override.');
  }
  return slug;
}

export type TenantKind = 'platform' | 'store' | 'unknown';

export type TenantClassification = {
  /** Normalised Host header (lower-cased, port stripped, trailing dot removed). */
  host: string;
  kind: TenantKind;
  /** Store slug for `{slug}.<base domain>`; the full host for custom domains. */
  storeSlug: string | null;
  /** Set only when the tenant came from the `?__tenant=` dev override. */
  devTenant: string | null;
};

export interface ClassifyTenantHostOptions {
  baseDomain: string;
  /** Full host of the platform console, e.g. `admin.velnorix.com`. */
  adminHost?: string | null;
  /** `ALLOW_DEV_TENANT_OVERRIDE` outside production. */
  devOverrideEnabled?: boolean;
  query?: URLSearchParams | null;
  devTenantCookie?: string | null;
  /**
   * On a local dev box `localhost` has no subdomain, so it is treated as the
   * platform host. Deployed preview URLs always carry a host, so this stays
   * true in production too -- it only changes what `localhost` falls back to.
   */
  treatLocalhostAsPlatform?: boolean;
}

/** The override is user input: an invalid slug must never become a tenant. */
function safeDevOverride(params: URLSearchParams | null, enabled: boolean): string | null {
  if (!enabled) return null;
  try {
    return devTenantOverride(params ?? new URLSearchParams(), true);
  } catch {
    return null;
  }
}

/**
 * Turns a Host header into the tenant the request belongs to.
 *
 * This is the single source of truth for "which tenant is this request for":
 * both apps call it from their middleware, so the platform console, a store's
 * admin and a store's storefront can never disagree about a host.
 */
export function classifyTenantHost(
  host: string | null | undefined,
  options: ClassifyTenantHostOptions,
): TenantClassification {
  const {
    baseDomain,
    adminHost = null,
    devOverrideEnabled = false,
    query = null,
    devTenantCookie = null,
    treatLocalhostAsPlatform = true,
  } = options;

  const normalizedHost = normalizeHost(host);
  const normalizedAdmin = adminHost ? normalizeHost(adminHost) : null;

  // The dev override wins over everything: it exists precisely because a dev or
  // preview environment has no wildcard domain to hang a subdomain off.
  const devTenant =
    safeDevOverride(query, devOverrideEnabled) ??
    (devTenantCookie
      ? safeDevOverride(new URLSearchParams({ __tenant: devTenantCookie }), devOverrideEnabled)
      : null);

  if (devTenant) {
    return { host: normalizedHost, kind: 'store', storeSlug: devTenant, devTenant };
  }

  // `admin.<base domain>` (or an explicitly configured console host) is always
  // the platform console, never a store called "admin".
  if (normalizedAdmin && normalizedHost === normalizedAdmin) {
    return { host: normalizedHost, kind: 'platform', storeSlug: null, devTenant: null };
  }

  // localhost, 127.x and ::1 can never be a real store domain.
  if (isLocalHost(normalizedHost)) {
    const firstLabel = normalizedHost.split('.')[0] ?? '';
    // `foo.localhost` is a dev subdomain pointing at the `foo` store.
    if (normalizedHost.endsWith('.localhost') && firstLabel) {
      return { host: normalizedHost, kind: 'store', storeSlug: firstLabel, devTenant: null };
    }
    return {
      host: normalizedHost,
      kind: treatLocalhostAsPlatform ? 'platform' : 'store',
      storeSlug: treatLocalhostAsPlatform ? null : normalizedHost,
      devTenant: null,
    };
  }

  const resolution = resolveHost(normalizedHost, baseDomain);
  if (resolution.kind === 'platform') {
    return { host: normalizedHost, kind: 'platform', storeSlug: null, devTenant: null };
  }
  if (resolution.kind === 'store') {
    return { host: normalizedHost, kind: 'store', storeSlug: resolution.slug, devTenant: null };
  }
  return { host: normalizedHost, kind: 'unknown', storeSlug: null, devTenant: null };
}
