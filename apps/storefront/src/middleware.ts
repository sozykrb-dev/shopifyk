import { NextResponse, type NextRequest } from 'next/server';
import { classifyTenantHost } from '@velnorix/core/hosts';
import { TENANT_HEADERS } from './lib/tenant-headers.js';

/**
 * Storefront middleware: host -> tenant.
 *
 * Runs on the edge, so it only classifies the Host header and forwards
 * `x-velnorix-*` headers. The store row is loaded on the server, where the
 * database driver is available.
 */

const DEV_TENANT_COOKIE = 'vx_dev_tenant_storefront';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};

export function middleware(request: NextRequest): NextResponse {
  const url = request.nextUrl;

  const classification = classifyTenantHost(request.headers.get('host'), {
    baseDomain: process.env.APP_BASE_DOMAIN ?? 'velnorix.test',
    devOverrideEnabled:
      process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_TENANT_OVERRIDE === 'true',
    query: url.searchParams,
    devTenantCookie: request.cookies.get(DEV_TENANT_COOKIE)?.value ?? null,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(TENANT_HEADERS.host, classification.host);
  requestHeaders.set(TENANT_HEADERS.kind, classification.kind);
  if (classification.storeSlug) {
    requestHeaders.set(TENANT_HEADERS.storeSlug, classification.storeSlug);
  }
  if (classification.devTenant) {
    requestHeaders.set(TENANT_HEADERS.devTenant, classification.devTenant);
  }
  requestHeaders.set(TENANT_HEADERS.pathname, url.pathname);

  // Drop the override from the visible URL so links and analytics stay clean.
  if (classification.devTenant !== null && url.searchParams.has('__tenant')) {
    url.searchParams.delete('__tenant');
  }

  const response =
    url.search !== request.nextUrl.search
      ? NextResponse.redirect(url)
      : NextResponse.next({ request: { headers: requestHeaders } });

  if (classification.devTenant) {
    response.cookies.set(DEV_TENANT_COOKIE, classification.devTenant, {
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 8,
    });
  }

  return response;
}
