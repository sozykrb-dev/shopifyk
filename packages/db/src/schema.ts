import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Velnorix database schema.
 *
 * Tenancy model
 * -------------
 * Shared schema, every tenant row carries `store_id`. Two classes of table:
 *
 *   PLATFORM tables  - users, stores, plans, sessions, audit_logs ... no RLS,
 *                      reachable only through the `velnorix_platform` DB role.
 *   TENANT tables    - products, store_settings, (orders, customers, ... later)
 *                      protected by RLS on `store_id` for BOTH DB roles.
 *
 * See docs/SCHEMA.md and docs/adr/0003-multi-tenancy-and-rls.md.
 */

/* -------------------------------------------------------------------------- */
/* Enums                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The five authentication contexts. They are deliberately separate: a session
 * minted for `merchant_owner` can never be used against a super-admin route,
 * because the context is stored on the session and checked on every request.
 */
export const authContextEnum = pgEnum('auth_context', [
  'super_admin',
  'platform_staff',
  'merchant_owner',
  'merchant_staff',
  'customer',
]);

export const accountStatusEnum = pgEnum('account_status', [
  'pending_verification',
  'active',
  'disabled',
]);

export const storeStatusEnum = pgEnum('store_status', ['active', 'suspended', 'closed']);

export const roleScopeEnum = pgEnum('role_scope', ['platform', 'store']);

export const planIntervalEnum = pgEnum('plan_interval', ['monthly', 'yearly']);

export const productStatusEnum = pgEnum('product_status', ['draft', 'active', 'archived']);

export const domainTypeEnum = pgEnum('domain_type', ['subdomain', 'custom']);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const createdAt = timestamp('created_at', { withTimezone: true, mode: 'date' })
  .defaultNow()
  .notNull();

const updatedAt = timestamp('updated_at', { withTimezone: true, mode: 'date' })
  .defaultNow()
  .notNull();

/** Money is stored as an integer number of minor units + ISO-4217 code. Never a float. */
const moneyMinorUnits = (name: string) => integer(name).notNull();
const currencyCode = (name: string) => text(name).notNull().default('EGP');

/* -------------------------------------------------------------------------- */
/* PLATFORM: plans & billing                                                   */
/* -------------------------------------------------------------------------- */

export type PlanLimits = {
  /** -1 means unlimited. */
  products: number;
  staff: number;
  storageMb: number;
  customDomains: number;
};

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar').notNull(),
    priceMinor: moneyMinorUnits('price_minor').default(0),
    currency: currencyCode('currency'),
    interval: planIntervalEnum('interval').notNull().default('monthly'),
    trialDays: integer('trial_days').notNull().default(14),
    /**
     * Platform fee in basis points (250 = 2.5%). The column default is 0 so a
     * plan is never accidentally created with a fee; the values the platform
     * actually charges live in migration 0002 and are business decisions, not
     * code. Confirm them before launch.
     */
    transactionFeeBps: integer('transaction_fee_bps').notNull().default(0),
    limits: jsonb('limits').$type<PlanLimits>().notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex('plans_key_key').on(table.key)],
);

/* -------------------------------------------------------------------------- */
/* PLATFORM: tenants                                                           */
/* -------------------------------------------------------------------------- */

export const stores = pgTable(
  'stores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Subdomain: {slug}.velnorix.com. Also the tenant id used by RLS. */
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: storeStatusEnum('status').notNull().default('active'),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    // `AnyPgColumn` breaks the circular inference between stores and users.
    ownerUserId: uuid('owner_user_id').references((): AnyPgColumn => users.id, {
      onDelete: 'set null',
    }),
    defaultCurrency: currencyCode('default_currency'),
    defaultLocale: text('default_locale').notNull().default('ar'),
    timezone: text('timezone').notNull().default('Africa/Cairo'),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true, mode: 'date' }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true, mode: 'date' }),
    suspensionReason: text('suspension_reason'),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('stores_slug_key').on(table.slug),
    index('stores_status_idx').on(table.status),
  ],
);

export const storeDomains = pgTable(
  'store_domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    host: text('host').notNull(),
    type: domainTypeEnum('type').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
    createdAt,
  },
  (table) => [
    uniqueIndex('store_domains_host_key').on(table.host),
    index('store_domains_store_idx').on(table.storeId),
  ],
);

/* -------------------------------------------------------------------------- */
/* PLATFORM: identity                                                          */
/* -------------------------------------------------------------------------- */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    /** Immutable normalised email, generated by Postgres so it can never drift. */
    emailNormalized: text('email_normalized').generatedAlwaysAs(sql`lower(btrim(email))`),
    context: authContextEnum('context').notNull(),
    /**
     * Set for `customer` accounts only: the same email in two stores MUST be two
     * separate accounts, so customers are unique per (store_id, email).
     * Null for every other context.
     */
    storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    passwordHash: text('password_hash'),
    status: accountStatusEnum('status').notNull().default('pending_verification'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true, mode: 'date' }),
    preferredLocale: text('preferred_locale').notNull().default('ar'),
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'date' }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt,
    updatedAt,
  },
  (table) => [
    // Platform & merchant identities are global; customers are per store.
    uniqueIndex('users_global_email_key')
      .on(table.emailNormalized)
      .where(sql`context <> 'customer'`),
    uniqueIndex('users_store_customer_email_key')
      .on(table.storeId, table.emailNormalized)
      .where(sql`context = 'customer'`),
    index('users_context_idx').on(table.context),
    index('users_store_idx').on(table.storeId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Only the SHA-256 of the token is stored: a DB leak does not mint sessions. */
    tokenHash: text('token_hash').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    context: authContextEnum('context').notNull(),
    /** Merchant/customer sessions are pinned to one store. */
    storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    /** Idle expiry: sliding, refreshed on activity. */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** Absolute expiry: hard stop, no matter how active the session is. */
    absoluteExpiresAt: timestamp('absolute_expires_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    mfaCompletedAt: timestamp('mfa_completed_at', { withTimezone: true, mode: 'date' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }).defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedReason: text('revoked_reason'),
    replacedBySessionId: uuid('replaced_by_session_id'),
    createdAt,
  },
  (table) => [
    uniqueIndex('sessions_token_hash_key').on(table.tokenHash),
    index('sessions_user_idx').on(table.userId),
    index('sessions_store_idx').on(table.storeId),
    index('sessions_expires_idx').on(table.expiresAt),
  ],
);

export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
    createdAt,
  },
  (table) => [
    uniqueIndex('email_verification_tokens_hash_key').on(table.tokenHash),
    index('email_verification_tokens_user_idx').on(table.userId),
  ],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
    createdAt,
  },
  (table) => [
    uniqueIndex('password_reset_tokens_hash_key').on(table.tokenHash),
    index('password_reset_tokens_user_idx').on(table.userId),
  ],
);

/** TOTP seeds are encrypted at rest with the platform KMS/env key. */
export const totpCredentials = pgTable('totp_credentials', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  secretEncrypted: text('secret_encrypted').notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true, mode: 'date' }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
  createdAt,
});

export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
    createdAt,
  },
  (table) => [index('recovery_codes_user_idx').on(table.userId)],
);

/* -------------------------------------------------------------------------- */
/* PLATFORM: RBAC (permissions stored as data, never as code)                  */
/* -------------------------------------------------------------------------- */

export const permissions = pgTable('permissions', {
  /** e.g. `store:products.write` or `platform:tenants.suspend`. */
  key: text('key').primaryKey(),
  group: text('group').notNull(),
  descriptionEn: text('description_en').notNull(),
  descriptionAr: text('description_ar').notNull(),
});

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    scope: roleScopeEnum('scope').notNull(),
    /** Null = system role shipped by the platform; set = store-specific custom role. */
    storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt,
  },
  (table) => [
    uniqueIndex('roles_system_key_key')
      .on(table.scope, table.key)
      .where(sql`store_id IS NULL`),
    uniqueIndex('roles_store_key_key')
      .on(table.storeId, table.key)
      .where(sql`store_id IS NOT NULL`),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionKey] })],
);

export const storeMemberships = pgTable(
  'store_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    status: accountStatusEnum('status').notNull().default('active'),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('store_memberships_store_user_key').on(table.storeId, table.userId),
    index('store_memberships_role_idx').on(table.roleId),
  ],
);

export const userPlatformRoles = pgTable(
  'user_platform_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    createdAt,
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })],
);

/* -------------------------------------------------------------------------- */
/* PLATFORM: audit                                                             */
/* -------------------------------------------------------------------------- */

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    actorType: text('actor_type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorContext: authContextEnum('actor_context'),
    /** Tenant the action belongs to; null for platform-wide actions. */
    storeId: uuid('store_id').references(() => stores.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
  },
  (table) => [
    index('audit_logs_store_time_idx').on(table.storeId, table.occurredAt),
    index('audit_logs_actor_idx').on(table.actorUserId),
    index('audit_logs_action_idx').on(table.action),
  ],
);

/* -------------------------------------------------------------------------- */
/* TENANT tables -- every one of these is protected by RLS                     */
/* -------------------------------------------------------------------------- */

export const storeSettings = pgTable('store_settings', {
  storeId: uuid('store_id')
    .primaryKey()
    .references(() => stores.id, { onDelete: 'cascade' }),
  themeKey: text('theme_key').notNull().default('dawn'),
  primaryColor: text('primary_color').notNull().default('#0f766e'),
  logoUrl: text('logo_url'),
  locale: text('locale').notNull().default('ar'),
  currency: currencyCode('currency'),
  createdAt,
  updatedAt,
});

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Tenant discriminator. Indexed and always the leading column. */
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    titleEn: text('title_en').notNull(),
    titleAr: text('title_ar').notNull(),
    handle: text('handle').notNull(),
    descriptionEn: text('description_en'),
    descriptionAr: text('description_ar'),
    status: productStatusEnum('status').notNull().default('draft'),
    priceMinor: moneyMinorUnits('price_minor').default(0),
    currency: currencyCode('currency'),
    sku: text('sku'),
    inventoryQuantity: integer('inventory_quantity').notNull().default(0),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('products_store_handle_key').on(table.storeId, table.handle),
    // Composite indexes lead with store_id: every query is tenant scoped.
    index('products_store_status_idx').on(table.storeId, table.status),
    index('products_store_created_idx').on(table.storeId, table.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Inferred types                                                              */
/* -------------------------------------------------------------------------- */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Store = typeof stores.$inferSelect;
export type NewStore = typeof stores.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Plan = typeof plans.$inferSelect;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Role = typeof roles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type StoreMembership = typeof storeMemberships.$inferSelect;
export type StoreSettings = typeof storeSettings.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type StoreDomain = typeof storeDomains.$inferSelect;

export const schema = {
  plans,
  stores,
  storeDomains,
  users,
  sessions,
  emailVerificationTokens,
  passwordResetTokens,
  totpCredentials,
  recoveryCodes,
  permissions,
  roles,
  rolePermissions,
  storeMemberships,
  userPlatformRoles,
  auditLogs,
  storeSettings,
  products,
};
