import { eq } from 'drizzle-orm';
import * as OTPAuth from 'otpauth';
import {
  assignPlatformRole,
  assignStoreMembership,
  closeDatabase,
  createProduct,
  createStore,
  createUser,
  findRoleByKey,
  findStoreBySlug,
  findUserByEmail,
  markEmailVerified,
  plans,
  products,
  recordAudit,
  stores,
  totpCredentials,
  upsertStoreSettings,
  withPlatform,
  withTenant,
  type Store,
  type User,
} from '@velnorix/db';
import { confirmTotpEnrollment, encryptTotpSecret, hashPassword } from '@velnorix/auth';
import { loadCliEnv } from './load-env.js';

loadCliEnv();

/**
 * Demo seed.
 *
 * Creates every kind of account the platform has -- all five authentication
 * contexts -- plus two stores with small catalogues, so the system can be
 * exercised by hand: sign in as each account type, switch stores, and watch
 * tenant isolation hold.
 *
 * It is idempotent: running it twice refreshes the demo accounts instead of
 * failing on a duplicate email.
 */

const PASSWORD = process.env.SEED_PASSWORD ?? 'Sahara!Dune#2026';
/**
 * Known TOTP seed for the seeded super admin, so the demo is actually
 * sign-in-able: the script prints the current 6-digit code for it.
 */
const DEMO_TOTP_SECRET = process.env.SEED_TOTP_SECRET ?? 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

type SeedProduct = {
  titleEn: string;
  titleAr: string;
  handle: string;
  priceMinor: number;
  sku: string;
  inventory: number;
};

type SeedStore = {
  slug: string;
  name: string;
  themeKey: string;
  primaryColor: string;
  products: SeedProduct[];
};

const STORES: SeedStore[] = [
  {
    slug: 'cairo-sneakers',
    name: 'متجر القاهرة للأحذية',
    themeKey: 'dawn',
    primaryColor: '#0f766e',
    products: [
      {
        titleEn: 'Cairo Runner',
        titleAr: 'حذاء القاهرة للجري',
        handle: 'cairo-runner',
        priceMinor: 189_900,
        sku: 'CS-RUN-001',
        inventory: 24,
      },
      {
        titleEn: 'Nile Leather Loafer',
        titleAr: 'حذاء النيل الجلدي',
        handle: 'nile-loafer',
        priceMinor: 245_000,
        sku: 'CS-LOA-002',
        inventory: 12,
      },
      {
        titleEn: 'Delta Court',
        titleAr: 'حذاء الدلتا الكلاسيكي',
        handle: 'delta-court',
        priceMinor: 159_900,
        sku: 'CS-COU-003',
        inventory: 30,
      },
      {
        titleEn: 'Khan Sandal',
        titleAr: 'صندل خان الخليلي',
        handle: 'khan-sandal',
        priceMinor: 79_900,
        sku: 'CS-SAN-004',
        inventory: 45,
      },
      {
        titleEn: 'Pyramid Trail',
        titleAr: 'حذاء الهرم للمشي',
        handle: 'pyramid-trail',
        priceMinor: 219_900,
        sku: 'CS-TRA-005',
        inventory: 8,
      },
      {
        titleEn: 'Corniche Slip-On',
        titleAr: 'حذاء الكورنيش',
        handle: 'corniche-slip-on',
        priceMinor: 129_900,
        sku: 'CS-SLI-006',
        inventory: 0,
      },
    ],
  },
  {
    slug: 'zad-naturals',
    name: 'زاد للمنتجات الطبيعية',
    themeKey: 'nebula',
    primaryColor: '#7c3aed',
    products: [
      {
        titleEn: 'Sidr Honey',
        titleAr: 'عسل سدر طبيعي',
        handle: 'sidr-honey',
        priceMinor: 45_000,
        sku: 'ZN-HON-001',
        inventory: 60,
      },
      {
        titleEn: 'Cold-Pressed Olive Oil',
        titleAr: 'زيت زيتون بكر ممتاز',
        handle: 'olive-oil',
        priceMinor: 32_000,
        sku: 'ZN-OIL-002',
        inventory: 40,
      },
      {
        titleEn: 'Nabati Dates Box',
        titleAr: 'علبة تمر نبتي',
        handle: 'nabati-dates',
        priceMinor: 18_500,
        sku: 'ZN-DAT-003',
        inventory: 120,
      },
      {
        titleEn: 'Hibiscus Tea',
        titleAr: 'شاي الكركديه',
        handle: 'hibiscus-tea',
        priceMinor: 9_500,
        sku: 'ZN-TEA-004',
        inventory: 200,
      },
      {
        titleEn: 'Za’atar Blend',
        titleAr: 'خلطة زعتر',
        handle: 'zaatar-blend',
        priceMinor: 12_000,
        sku: 'ZN-ZAA-005',
        inventory: 75,
      },
    ],
  },
];

type SeedContext = User['context'];

async function upsertUser(input: {
  email: string;
  fullName: string;
  context: SeedContext;
  storeId?: string | null;
  locale?: string;
}): Promise<User> {
  return withPlatform(async (db) => {
    const existing = await findUserByEmail(db, input.email, input.context, input.storeId ?? null);
    if (existing) return existing;

    const created = await createUser(db, {
      email: input.email,
      fullName: input.fullName,
      context: input.context,
      storeId: input.storeId ?? null,
      passwordHash: await hashPassword(PASSWORD),
      preferredLocale: input.locale ?? 'ar',
    });
    return markEmailVerified(db, created.id);
  });
}

async function grantPlatformRoleTo(email: string, roleKey: string): Promise<void> {
  await withPlatform(async (db) => {
    const user = await findUserByEmail(db, email);
    const role = await findRoleByKey(db, roleKey);
    if (!user || !role) throw new Error(`Cannot grant ${roleKey} to ${email}.`);
    await assignPlatformRole(db, { userId: user.id, roleId: role.id });
  });
}

async function grantStoreRole(storeId: string, email: string, roleKey: string): Promise<void> {
  await withPlatform(async (db) => {
    const user = await findUserByEmail(db, email);
    const role = await findRoleByKey(db, roleKey);
    if (!user || !role) throw new Error(`Cannot grant ${roleKey} to ${email}.`);
    await assignStoreMembership(db, { storeId, userId: user.id, roleId: role.id });
  });
}

async function seedStore(definition: SeedStore, planId: string): Promise<Store> {
  const store = await withPlatform(async (db) => {
    const existing = await findStoreBySlug(db, definition.slug);
    return (
      existing ??
      createStore(db, {
        slug: definition.slug,
        name: definition.name,
        planId,
        defaultCurrency: 'EGP',
        defaultLocale: 'ar',
      })
    );
  });

  await withTenant(store.id, async (db) => {
    await upsertStoreSettings(db, store.id, {
      themeKey: definition.themeKey,
      primaryColor: definition.primaryColor,
      locale: 'ar',
      currency: 'EGP',
    });

    const existing = await db.select({ handle: products.handle }).from(products);
    const handles = new Set(existing.map((row) => row.handle));

    for (const product of definition.products) {
      if (handles.has(product.handle)) continue;
      await createProduct(db, {
        storeId: store.id,
        titleEn: product.titleEn,
        titleAr: product.titleAr,
        handle: product.handle,
        descriptionEn: `${product.titleEn} — demo product from ${definition.name}.`,
        descriptionAr: `${product.titleAr} — منتج تجريبي من ${definition.name}.`,
        priceMinor: product.priceMinor,
        currency: 'EGP',
        sku: product.sku,
        inventoryQuantity: product.inventory,
        status: 'active',
      });
    }
  });

  return store;
}

/** Enrols the demo super admin in TOTP with a seed we can print a code for. */
async function enrollDemoTotp(userId: string, accountLabel: string): Promise<string> {
  await withPlatform(async (db) => {
    const secretEncrypted = encryptTotpSecret(DEMO_TOTP_SECRET);
    await db
      .insert(totpCredentials)
      .values({ userId, secretEncrypted })
      .onConflictDoUpdate({
        target: totpCredentials.userId,
        set: { secretEncrypted, confirmedAt: null },
      });

    const result = await confirmTotpEnrollment(db, userId, currentTotpCode());
    if (!result.ok) throw new Error(`TOTP enrolment failed: ${result.error.message}`);
  });

  return new OTPAuth.TOTP({
    issuer: 'Velnorix',
    label: accountLabel,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(DEMO_TOTP_SECRET),
  }).toString();
}

function currentTotpCode(): string {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(DEMO_TOTP_SECRET),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }).generate();
}

async function main(): Promise<void> {
  const [plan] = await withPlatform((db) =>
    db.select({ id: plans.id }).from(plans).where(eq(plans.key, 'growth')),
  );
  if (!plan) throw new Error('No "growth" plan found: run `pnpm db:migrate` first.');

  /* Platform team (super admin + staff) ------------------------------------ */
  const owner = await upsertUser({
    email: 'owner@velnorix.test',
    fullName: 'مالك المنصة',
    context: 'super_admin',
  });
  const support = await upsertUser({
    email: 'support@velnorix.test',
    fullName: 'دعم المنصة',
    context: 'platform_staff',
  });
  const finance = await upsertUser({
    email: 'finance@velnorix.test',
    fullName: 'مالية المنصة',
    context: 'platform_staff',
  });

  await grantPlatformRoleTo(owner.email, 'platform_owner');
  await grantPlatformRoleTo(support.email, 'platform_support');
  await grantPlatformRoleTo(finance.email, 'platform_finance');

  /* Two demo stores with catalogues ---------------------------------------- */
  const cairo = await seedStore(STORES[0]!, plan.id);
  const zad = await seedStore(STORES[1]!, plan.id);

  /* Merchant owners and staff ---------------------------------------------- */
  const cairoOwner = await upsertUser({
    email: 'owner@cairo-sneakers.test',
    fullName: 'مالك متجر القاهرة',
    context: 'merchant_owner',
  });
  const cairoManager = await upsertUser({
    email: 'manager@cairo-sneakers.test',
    fullName: 'مدير متجر القاهرة',
    context: 'merchant_staff',
  });
  const zadOwner = await upsertUser({
    email: 'owner@zad-naturals.test',
    fullName: 'مالك متجر زاد',
    context: 'merchant_owner',
  });

  await grantStoreRole(cairo.id, cairoOwner.email, 'store_owner');
  await grantStoreRole(cairo.id, cairoManager.email, 'store_manager');
  await grantStoreRole(zad.id, zadOwner.email, 'store_owner');

  await withPlatform((db) =>
    db.update(stores).set({ ownerUserId: cairoOwner.id }).where(eq(stores.id, cairo.id)),
  );
  await withPlatform((db) =>
    db.update(stores).set({ ownerUserId: zadOwner.id }).where(eq(stores.id, zad.id)),
  );

  /* Customers: the same email in two stores is two separate accounts ------- */
  await upsertUser({
    email: 'ahmed@example.com',
    fullName: 'أحمد (القاهرة)',
    context: 'customer',
    storeId: cairo.id,
  });
  await upsertUser({
    email: 'ahmed@example.com',
    fullName: 'أحمد (زاد)',
    context: 'customer',
    storeId: zad.id,
  });
  await upsertUser({
    email: 'nour@example.com',
    fullName: 'نور',
    context: 'customer',
    storeId: zad.id,
  });

  /* Mandatory 2FA for the platform owner ----------------------------------- */
  const otpauthUri = await enrollDemoTotp(owner.id, owner.email);

  await withPlatform((db) =>
    recordAudit(db, {
      actorType: 'system',
      action: 'platform.seed.completed',
      metadata: { stores: [cairo.slug, zad.slug] },
    }),
  );

  await closeDatabase();

  const baseDomain = process.env.APP_BASE_DOMAIN ?? 'velnorix.test';
  console.log('\n──────────────────────────────────────────────────────────────');
  console.log('  Velnorix · demo data ready');
  console.log('──────────────────────────────────────────────────────────────');
  console.log(`  Password for every account: ${PASSWORD}\n`);
  console.log('  Platform console');
  console.log(`    owner@velnorix.test        super admin   (2FA code now: ${currentTotpCode()})`);
  console.log('    support@velnorix.test      support');
  console.log('    finance@velnorix.test      finance\n');
  console.log('  Store admin');
  console.log(
    `    ${cairo.slug}: owner@cairo-sneakers.test (owner) · manager@cairo-sneakers.test (manager)`,
  );
  console.log(`    ${zad.slug}:  owner@zad-naturals.test (owner)\n`);
  console.log('  Customers: ahmed@example.com exists in BOTH stores as two separate accounts.');
  console.log(`  2FA setup URI (paste in an authenticator app):\n    ${otpauthUri}`);
  console.log(
    `\n  Hosts: admin.${baseDomain} · ${cairo.slug}.${baseDomain} · ${zad.slug}.${baseDomain}`,
  );
  console.log('──────────────────────────────────────────────────────────────\n');
}

main().catch((error: unknown) => {
  console.error('[seed] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
