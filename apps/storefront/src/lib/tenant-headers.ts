/** Header names shared between the edge middleware and server code (no Node imports). */
export const TENANT_HEADERS = {
  host: 'x-velnorix-host',
  kind: 'x-velnorix-kind',
  storeSlug: 'x-velnorix-store-slug',
  devTenant: 'x-velnorix-dev-tenant',
  pathname: 'x-velnorix-pathname',
} as const;
