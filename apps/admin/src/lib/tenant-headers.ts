/**
 * Header names shared between the edge middleware and server code.
 *
 * This module is imported by `middleware.ts`, so it must stay free of any
 * Node-only import (no database, no crypto).
 */
export const TENANT_HEADERS = {
  host: 'x-velnorix-host',
  kind: 'x-velnorix-kind',
  storeSlug: 'x-velnorix-store-slug',
  devTenant: 'x-velnorix-dev-tenant',
  pathname: 'x-velnorix-pathname',
} as const;
