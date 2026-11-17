-- ===========================================================================
-- 0001 · Database roles, privileges and Row-Level Security
--
-- Threat model: the application must NEVER connect as a superuser or as the
-- owner of the tables, because both bypass RLS. So:
--
--   velnorix           LOGIN role the app connects with. Owns nothing.
--   velnorix_app       NOLOGIN role used inside tenant transactions
--                      (`SET LOCAL ROLE velnorix_app` + app.current_store_id).
--   velnorix_platform  NOLOGIN role used for platform tables and for tenant
--                      tables only when a tenant context is explicitly set.
--
-- Both app roles are created with NOBYPASSRLS, and every tenant table has
-- FORCE ROW LEVEL SECURITY, so even the table owner cannot read across tenants.
-- ===========================================================================

-- 1 · Roles -----------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'velnorix') THEN
    CREATE ROLE velnorix LOGIN;
  END IF;
  -- Idempotent hardening: whatever the role looked like before, it is never
  -- allowed to bypass RLS, never a superuser, never able to create objects.
  ALTER ROLE velnorix LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'velnorix_app') THEN
    CREATE ROLE velnorix_app NOLOGIN;
  END IF;
  ALTER ROLE velnorix_app NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'velnorix_platform') THEN
    CREATE ROLE velnorix_platform NOLOGIN;
  END IF;
  ALTER ROLE velnorix_platform NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
END
$$;

-- NOINHERIT on velnorix means privileges are never active unless the code
-- explicitly does `SET LOCAL ROLE ...`, which is exactly what we want: a query
-- that forgets to switch roles has no privileges at all.
GRANT velnorix_app TO velnorix;
GRANT velnorix_platform TO velnorix;

-- 2 · Privileges ------------------------------------------------------------
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO velnorix', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO velnorix_app, velnorix_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO velnorix_app, velnorix_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO velnorix_app, velnorix_platform;

-- Tables created by later migrations get the same treatment automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO velnorix_app, velnorix_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO velnorix_app, velnorix_platform;

-- 3 · Tenant context helper --------------------------------------------------
-- Reads the GUC set by the tenant-scoped data layer. Unknown/malformed values
-- resolve to NULL, and `store_id = NULL` is never true, so a missing tenant
-- context denies every row instead of leaking all of them.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN current_setting('app.current_store_id', true) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN current_setting('app.current_store_id', true)::uuid
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION current_tenant_id() IS
  'Tenant id for the current transaction (SET LOCAL app.current_store_id).';

-- 4 · Row-Level Security -----------------------------------------------------

-- products ------------------------------------------------------------------
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;

CREATE POLICY "products_tenant_isolation" ON "products"
  FOR ALL TO "velnorix_app"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());

CREATE POLICY "products_platform_scoped" ON "products"
  FOR ALL TO "velnorix_platform"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());

-- store_settings ------------------------------------------------------------
ALTER TABLE "store_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "store_settings" FORCE ROW LEVEL SECURITY;

CREATE POLICY "store_settings_tenant_isolation" ON "store_settings"
  FOR ALL TO "velnorix_app"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());

CREATE POLICY "store_settings_platform_scoped" ON "store_settings"
  FOR ALL TO "velnorix_platform"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());

-- audit_logs ----------------------------------------------------------------
-- A merchant sees only their own store's trail (platform-wide entries have a
-- NULL store_id and are invisible to tenants). Platform staff see everything.
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_tenant_isolation" ON "audit_logs"
  FOR ALL TO "velnorix_app"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());

CREATE POLICY "audit_logs_platform" ON "audit_logs"
  FOR ALL TO "velnorix_platform"
  USING (true)
  WITH CHECK (true);
