-- ===========================================================================
-- 0002 · Reference data: permissions, system roles, plans
--
-- Permissions are DATA, not code. The RBAC engine (packages/auth) reads them
-- from these tables, so adding a permission or tuning a role is a migration,
-- never a redeploy of business logic. Everything here is idempotent.
-- ===========================================================================

-- 1 · Permission catalogue ---------------------------------------------------
INSERT INTO "permissions" ("key", "group", "description_en", "description_ar") VALUES
  -- Storefront catalogue
  ('store:dashboard.read',   'dashboard',  'View the store dashboard',                  'عرض لوحة تحكم المتجر'),
  ('store:products.read',    'products',   'View products',                             'عرض المنتجات'),
  ('store:products.write',   'products',   'Create and edit products',                  'إنشاء وتعديل المنتجات'),
  ('store:products.delete',  'products',   'Delete products',                           'حذف المنتجات'),
  ('store:collections.read', 'products',   'View collections',                          'عرض المجموعات'),
  ('store:collections.write','products',   'Create and edit collections',               'إنشاء وتعديل المجموعات'),
  ('store:inventory.read',   'inventory',  'View inventory levels',                     'عرض مستويات المخزون'),
  ('store:inventory.write',  'inventory',  'Adjust inventory',                          'تعديل المخزون'),
  -- Orders
  ('store:orders.read',      'orders',     'View orders',                               'عرض الطلبات'),
  ('store:orders.write',     'orders',     'Create and edit orders',                    'إنشاء وتعديل الطلبات'),
  ('store:orders.fulfill',   'orders',     'Fulfil and ship orders',                    'تجهيز وشحن الطلبات'),
  ('store:orders.refund',    'orders',     'Refund orders',                             'إرجاع مبالغ الطلبات'),
  -- Customers
  ('store:customers.read',   'customers',  'View customers',                            'عرض العملاء'),
  ('store:customers.write',  'customers',  'Create and edit customers',                 'إنشاء وتعديل العملاء'),
  -- Growth
  ('store:discounts.read',   'marketing',  'View discounts',                            'عرض الخصومات'),
  ('store:discounts.write',  'marketing',  'Create and edit discounts',                 'إنشاء وتعديل الخصومات'),
  ('store:reports.read',     'reports',    'View reports and analytics',                'عرض التقارير والتحليلات'),
  -- Configuration
  ('store:settings.read',    'settings',   'View store settings',                       'عرض إعدادات المتجر'),
  ('store:settings.write',   'settings',   'Change store settings',                     'تغيير إعدادات المتجر'),
  ('store:domains.write',    'settings',   'Connect custom domains',                    'ربط النطاقات المخصصة'),
  ('store:staff.read',       'staff',      'View staff accounts',                       'عرض حسابات الموظفين'),
  ('store:staff.write',      'staff',      'Invite and manage staff accounts',          'دعوة وإدارة حسابات الموظفين'),
  ('store:billing.read',     'billing',    'View the store subscription and invoices',  'عرض اشتراك المتجر وفواتيره'),
  ('store:billing.write',    'billing',    'Change the store subscription',             'تغيير اشتراك المتجر'),
  ('store:api_keys.write',   'developers', 'Manage API keys and webhooks',              'إدارة مفاتيح API والـ webhooks'),
  -- Platform
  ('platform:tenants.read',      'tenants', 'View stores on the platform',                       'عرض المتاجر على المنصة'),
  ('platform:tenants.write',     'tenants', 'Edit stores on the platform',                       'تعديل المتاجر على المنصة'),
  ('platform:tenants.suspend',   'tenants', 'Suspend and restore stores',                        'إيقاف واستعادة المتاجر'),
  ('platform:tenants.impersonate','tenants','Sign in to a store as its owner (audited)',         'الدخول لمتجر بصفة مالكه (مُسجّل بالتدقيق)'),
  ('platform:plans.read',        'billing', 'View plans and limits',                             'عرض الباقات والحدود'),
  ('platform:plans.write',       'billing', 'Edit plans and limits',                             'تعديل الباقات والحدود'),
  ('platform:billing.read',      'billing', 'View platform revenue, MRR and invoices',           'عرض إيرادات المنصة والفواتير'),
  ('platform:billing.write',     'billing', 'Manage merchant subscriptions and invoices',        'إدارة اشتراكات وفواتير التجار'),
  ('platform:staff.read',        'staff',   'View platform staff',                               'عرض موظفي المنصة'),
  ('platform:staff.write',       'staff',   'Invite and manage platform staff',                  'دعوة وإدارة موظفي المنصة'),
  ('platform:audit.read',        'audit',   'Read the platform audit log',                       'قراءة سجل التدقيق'),
  ('platform:settings.write',    'settings','Change platform-wide settings',                     'تغيير إعدادات المنصة'),
  ('platform:system.read',       'system',  'View system health, queues and failed webhooks',    'عرض صحة النظام والطوابير')
ON CONFLICT ("key") DO UPDATE SET
  "group" = EXCLUDED."group",
  "description_en" = EXCLUDED."description_en",
  "description_ar" = EXCLUDED."description_ar";

-- 2 · System roles -----------------------------------------------------------
INSERT INTO "roles" ("key", "scope", "name_en", "name_ar", "is_system") VALUES
  ('platform_owner',   'platform', 'Platform Owner',   'مالك المنصة',    true),
  ('platform_support', 'platform', 'Platform Support', 'دعم المنصة',     true),
  ('platform_finance', 'platform', 'Platform Finance', 'مالية المنصة',   true),
  ('store_owner',      'store',    'Store Owner',      'مالك المتجر',    true),
  ('store_manager',    'store',    'Manager',          'مدير',           true),
  ('products_inventory','store',   'Products & Inventory', 'المنتجات والمخزون', true),
  ('orders_fulfillment','store',   'Orders & Fulfillment','الطلبات والتجهيز',  true),
  ('marketing',        'store',    'Marketing',        'التسويق',        true),
  ('support',          'store',    'Support',          'خدمة العملاء',   true),
  ('finance_readonly', 'store',    'Finance (read-only)','المالية (قراءة فقط)', true)
ON CONFLICT DO NOTHING;

-- 3 · Role -> permission map -------------------------------------------------
INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", p.key
FROM "roles" r
CROSS JOIN (SELECT UNNEST(ARRAY[
  'platform:tenants.read','platform:tenants.write','platform:tenants.suspend',
  'platform:tenants.impersonate','platform:plans.read','platform:plans.write',
  'platform:billing.read','platform:billing.write','platform:staff.read',
  'platform:staff.write','platform:audit.read','platform:settings.write',
  'platform:system.read'
])::text AS key) p
WHERE r."key" = 'platform_owner' AND r."store_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", p.key
FROM "roles" r
CROSS JOIN (SELECT UNNEST(ARRAY[
  'platform:tenants.read','platform:audit.read','platform:system.read',
  'platform:tenants.impersonate'
])::text AS key) p
WHERE r."key" = 'platform_support' AND r."store_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", p.key
FROM "roles" r
CROSS JOIN (SELECT UNNEST(ARRAY[
  'platform:tenants.read','platform:billing.read','platform:billing.write',
  'platform:plans.read','platform:audit.read'
])::text AS key) p
WHERE r."key" = 'platform_finance' AND r."store_id" IS NULL
ON CONFLICT DO NOTHING;

-- Store owner: every store-scoped permission.
INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", p."key"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."key" = 'store_owner' AND r."store_id" IS NULL AND p."key" LIKE 'store:%'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", p.key
FROM "roles" r
CROSS JOIN (SELECT UNNEST(ARRAY[
  'store:dashboard.read','store:products.read','store:products.write','store:products.delete',
  'store:collections.read','store:collections.write','store:inventory.read','store:inventory.write',
  'store:orders.read','store:orders.write','store:orders.fulfill','store:orders.refund',
  'store:customers.read','store:customers.write','store:discounts.read','store:discounts.write',
  'store:reports.read','store:settings.read','store:settings.write','store:staff.read','store:billing.read'
])::text AS key) p
WHERE r."key" = 'store_manager' AND r."store_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", p.key
FROM "roles" r
CROSS JOIN (SELECT UNNEST(ARRAY[
  'store:dashboard.read','store:products.read','store:products.write','store:products.delete',
  'store:collections.read','store:collections.write','store:inventory.read','store:inventory.write'
])::text AS key) p
WHERE r."key" = 'products_inventory' AND r."store_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", p.key
FROM "roles" r
CROSS JOIN (SELECT UNNEST(ARRAY[
  'store:dashboard.read','store:orders.read','store:orders.write','store:orders.fulfill',
  'store:orders.refund','store:customers.read','store:products.read','store:inventory.read'
])::text AS key) p
WHERE r."key" = 'orders_fulfillment' AND r."store_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", p.key
FROM "roles" r
CROSS JOIN (SELECT UNNEST(ARRAY[
  'store:dashboard.read','store:products.read','store:collections.read','store:collections.write',
  'store:discounts.read','store:discounts.write','store:reports.read','store:customers.read'
])::text AS key) p
WHERE r."key" = 'marketing' AND r."store_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", p.key
FROM "roles" r
CROSS JOIN (SELECT UNNEST(ARRAY[
  'store:dashboard.read','store:orders.read','store:customers.read','store:customers.write',
  'store:products.read'
])::text AS key) p
WHERE r."key" = 'support' AND r."store_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", p.key
FROM "roles" r
CROSS JOIN (SELECT UNNEST(ARRAY[
  'store:dashboard.read','store:reports.read','store:orders.read','store:billing.read'
])::text AS key) p
WHERE r."key" = 'finance_readonly' AND r."store_id" IS NULL
ON CONFLICT DO NOTHING;

-- 4 · Subscription plans -----------------------------------------------------
-- Prices are integer minor units (EGP piastres). The transaction fee is in
-- basis points and is configurable per plan -- including 0, so the business
-- model stays open until we have talked to real merchants.
INSERT INTO "plans" ("key", "name_en", "name_ar", "price_minor", "currency", "interval",
                     "trial_days", "transaction_fee_bps", "limits", "is_default") VALUES
  ('trial',   'Free trial', 'فترة تجريبية',
      0,     'EGP', 'monthly', 14,   0, '{"products": 50, "staff": 2, "storageMb": 500, "customDomains": 0}', true),
  ('starter', 'Starter', 'المبتدئ',
      29900, 'EGP', 'monthly', 14, 250, '{"products": 500, "staff": 5, "storageMb": 2000, "customDomains": 0}', false),
  ('growth',  'Growth', 'النمو',
      89900, 'EGP', 'monthly', 14, 150, '{"products": 5000, "staff": 15, "storageMb": 10000, "customDomains": 1}', false),
  ('scale',   'Scale', 'التوسع',
     199900, 'EGP', 'monthly', 14, 100, '{"products": -1, "staff": -1, "storageMb": 50000, "customDomains": -1}', false)
ON CONFLICT ("key") DO UPDATE SET
  "name_en" = EXCLUDED."name_en",
  "name_ar" = EXCLUDED."name_ar",
  "price_minor" = EXCLUDED."price_minor",
  "transaction_fee_bps" = EXCLUDED."transaction_fee_bps",
  "limits" = EXCLUDED."limits";
