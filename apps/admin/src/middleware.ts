import { NextResponse, type NextRequest } from 'next/server';
import { classifyTenantHost } from '@velnorix/core/hosts';
import { TENANT_HEADERS } from './lib/tenant-headers.js';

/**
 * Edge middleware: turns a Host header into a request context.
 *
 * It deliberately does NOT talk to the database (no DB driver on the edge) and
 * does NOT make authorisation decisions: it only forwards `x-velnorix-*`
 * headers. Real session validation happens on the server, in
 * `requirePrincipal()`, which re-reads the session row and rejects any session
 * whose context does not match the host.
 */

const DEV_TENANT_COOKIE = 'vx_dev_tenant';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};

export function middleware(request: NextRequest): NextResponse {
  const url = request.nextUrl;

  const classification = classifyTenantHost(request.headers.get('host'), {
    baseDomain: process.env.APP_BASE_DOMAIN ?? 'velnorix.test',
    adminHost: process.env.ADMIN_BASE_DOMAIN ?? undefined,
    devOverrideEnabled:
      process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_TENANT_OVERRIDE === 'true',
    query: url.searchParams,
    devTenantCookie: request.cookies.get(DEV_TENANT_COOKIE)?.value ?? null,
    // `pnpm dev` on localhost with no override behaves like the platform console.
    treatLocalhostAsPlatform: !process.env.VERCEL,
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
