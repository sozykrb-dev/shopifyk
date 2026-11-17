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
  createCoupon,
  createShippingRate,
  createTaxRule,
  issueInvoice,
  markInvoicePaid,
  markEmailVerified,
  orderItems,
  orders,
  plans,
  products,
  recordAudit,
  startSubscription,
  stores,
  totpCredentials,
  upsertStoreSettings,
  withPlatform,
  withPlatformTenant,
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

  const catalogue = await withTenant(store.id, (db) =>
    db
      .select({
        titleAr: products.titleAr,
        titleEn: products.titleEn,
        priceMinor: products.priceMinor,
        sku: products.sku,
      })
      .from(products)
      .where(eq(products.status, 'active')),
  );
  await seedOrders(
    store.id,
    catalogue.map((row) => ({ ...row, sku: row.sku ?? '' })),
  );

  return store;
}

/**
 * Demo orders for one store.
 *
 * Written directly rather than through `placeOrder()` because these are
 * historical orders, not live carts: they have numbers, statuses and dates
 * spread across the last fortnight, which is what the orders list, the
 * dashboard and the customer's order history all need in order to look real.
 * They are snapshots all the same -- title and price copied, never joined.
 */
async function seedOrders(
  storeId: string,
  catalogue: { titleAr: string; titleEn: string; priceMinor: number; sku: string }[],
): Promise<number> {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const DEMO: {
    daysAgo: number;
    status: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
    paymentStatus: 'unpaid' | 'paid';
    customer: { name: string; email: string; phone: string; city: string; region: string };
    lines: { index: number; quantity: number }[];
  }[] = [
    {
      daysAgo: 0.2,
      status: 'pending',
      paymentStatus: 'unpaid',
      customer: {
        name: 'أحمد الشريف',
        email: 'ahmed.sherif@example.com',
        phone: '01001234567',
        city: 'القاهرة',
        region: 'مدينة نصر',
      },
      lines: [
        { index: 0, quantity: 1 },
        { index: 1, quantity: 2 },
      ],
    },
    {
      daysAgo: 2,
      status: 'confirmed',
      paymentStatus: 'unpaid',
      customer: {
        name: 'منى عبد الرحمن',
        email: 'mona.abdelrahman@example.com',
        phone: '01112345678',
        city: 'الجيزة',
        region: 'الدقي',
      },
      lines: [{ index: 2, quantity: 1 }],
    },
    {
      daysAgo: 6,
      status: 'shipped',
      paymentStatus: 'paid',
      customer: {
        name: 'كريم محمود',
        email: 'kareem.mahmoud@example.com',
        phone: '01223456789',
        city: 'الإسكندرية',
        region: 'سموحة',
      },
      lines: [{ index: 1, quantity: 1 }],
    },
    {
      daysAgo: 11,
      status: 'delivered',
      paymentStatus: 'paid',
      customer: {
        name: 'سلمى حسن',
        email: 'salma.hassan@example.com',
        phone: '01556789012',
        city: 'المنصورة',
        region: 'المنصورة',
      },
      lines: [
        { index: 2, quantity: 2 },
        { index: 3, quantity: 1 },
      ],
    },
    {
      daysAgo: 15,
      status: 'cancelled',
      paymentStatus: 'unpaid',
      customer: {
        name: 'يوسف إبراهيم',
        email: 'youssef.ibrahim@example.com',
        phone: '01099887766',
        city: 'أسيوط',
        region: 'أسيوط',
      },
      lines: [{ index: 3, quantity: 1 }],
    },
  ];

  await withTenant(storeId, async (db) => {
    // Idempotent: seeding twice must not duplicate the order book.
    const [existing] = await db.select({ count: orders.id }).from(orders).limit(1);
    if (existing) return;

    let number = 1001;
    for (const demo of DEMO) {
      const lines = demo.lines
        .map((line) => {
          const product = catalogue[line.index];
          if (!product) return null;
          return {
            product,
            quantity: line.quantity,
            lineTotal: product.priceMinor * line.quantity,
          };
        })
        .filter((line): line is NonNullable<typeof line> => line !== null);
      if (lines.length === 0) continue;

      const subtotal = lines.reduce((total, line) => total + line.lineTotal, 0);
      const placedAt = new Date(now - demo.daysAgo * day);

      const [order] = await db
        .insert(orders)
        .values({
          storeId,
          orderNumber: number,
          email: demo.customer.email,
          phone: demo.customer.phone,
          shippingName: demo.customer.name,
          addressLine1: 'شارع الجمهورية، عمارة ١٢',
          city: demo.customer.city,
          region: demo.customer.region,
          countryCode: 'EG',
          currency: 'EGP',
          subtotalMinor: subtotal,
          totalMinor: subtotal,
          status: demo.status,
          paymentStatus: demo.paymentStatus,
          fulfillmentStatus: demo.status === 'delivered' ? 'fulfilled' : 'unfulfilled',
          paymentMethod: 'cash_on_delivery',
          placedAt,
          createdAt: placedAt,
        })
        .returning({ id: orders.id });
      if (!order) continue;

      await db.insert(orderItems).values(
        lines.map((line) => ({
          storeId,
          orderId: order.id,
          titleAr: line.product.titleAr,
          titleEn: line.product.titleEn,
          sku: line.product.sku,
          quantity: line.quantity,
          unitPriceMinor: line.product.priceMinor,
          lineTotalMinor: line.lineTotal,
          currency: 'EGP',
        })),
      );

      number += 1;
    }
  });

  return DEMO.length;
}

/**
 * Demo subscriptions and invoices.
 *
 * Written inside `withPlatformTenant`, because billing rows are tenant data:
 * the platform acts on a store's books from inside that store's scope, not by
 * reading across every store at once.
 *
 * The amounts come from the plan rows rather than from literals, so the demo
 * never contradicts the pricing that is actually configured.
 */
async function seedBilling(
  storeId: string,
  planId: string,
  plan: { priceMinor: number; currency: string; nameAr: string; nameEn: string; trialDays: number },
): Promise<void> {
  await withPlatformTenant(storeId, async (db) => {
    const subscription = await startSubscription(db, {
      storeId,
      planId,
      trialDays: plan.trialDays,
      provider: 'manual',
    });

    const line = {
      descriptionAr: `اشتراك شهري — ${plan.nameAr}`,
      descriptionEn: `Monthly subscription — ${plan.nameEn}`,
      quantity: 1,
      unitAmountMinor: plan.priceMinor,
      totalMinor: plan.priceMinor,
    };

    // The current invoice is open; last month's is paid. Two states are enough
    // to see that the screens distinguish them.
    const current = await issueInvoice(db, {
      storeId,
      subscriptionId: subscription.id,
      lines: [line],
      currency: plan.currency,
      dueInDays: 7,
    });

    const previous = await issueInvoice(db, {
      storeId,
      subscriptionId: subscription.id,
      lines: [line],
      currency: plan.currency,
      dueInDays: -21,
    });
    await markInvoicePaid(db, previous.id, {
      method: 'manual_transfer',
      reference: 'SEED-DEMO-1',
    });
    void current;
  });
}

/**
 * Demo pricing rules.
 *
 * These are **configuration, not invented truth**. Egyptian VAT is 14% and is
 * displayed inclusive of the shelf price, which is why the rule is written
 * `priceInclusive`: the tax is extracted from the price, not added to it. The
 * shipping numbers and the coupon are plainly demo values, and the seed says so
 * in its output.
 *
 * A store that configured none of this would charge no tax and no shipping --
 * the engine's default is a zero rate, never a guess.
 */
async function seedPricing(storeId: string, currency: string): Promise<void> {
  await withPlatformTenant(storeId, async (db) => {
    await createTaxRule(db, {
      storeId,
      nameAr: 'ضريبة القيمة المضافة (14%)',
      nameEn: 'VAT (14%)',
      rateBps: 1_400,
      countryCode: 'EG',
      priceInclusive: true,
      taxesShipping: false,
    });

    await createShippingRate(db, {
      storeId,
      nameAr: 'شحن عادي',
      nameEn: 'Standard',
      amountMinor: 3_000,
      currency,
      countryCode: 'EG',
      freeAboveMinor: 100_000,
      minDays: 2,
      maxDays: 5,
    });

    await createShippingRate(db, {
      storeId,
      nameAr: 'شحن سريع',
      nameEn: 'Express',
      amountMinor: 7_000,
      currency,
      countryCode: 'EG',
      minDays: 1,
      maxDays: 2,
      priority: 10,
    });

    await createCoupon(db, {
      storeId,
      code: 'WELCOME10',
      type: 'percent',
      value: 1_000,
      currency,
      minSubtotalMinor: 20_000,
      usageLimit: 100,
      perCustomerLimit: 1,
    });
  });
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
  // The full row: the billing seed needs the plan's price, name and trial.
  const [plan] = await withPlatform((db) => db.select().from(plans).where(eq(plans.key, 'growth')));
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

  /* Pricing rules for both stores ----------------------------------------- */
  await seedPricing(cairo.id, cairo.currency);
  await seedPricing(zad.id, zad.currency);

  /* Subscriptions and invoices for both stores ----------------------------- */
  await seedBilling(cairo.id, plan.id, {
    priceMinor: plan.priceMinor,
    currency: plan.currency,
    nameAr: plan.nameAr,
    nameEn: plan.nameEn,
    trialDays: plan.trialDays,
  });

  const [starterPlan] = await withPlatform((db) =>
    db.select().from(plans).where(eq(plans.key, 'starter')),
  );
  if (starterPlan) {
    await seedBilling(zad.id, starterPlan.id, {
      priceMinor: starterPlan.priceMinor,
      currency: starterPlan.currency,
      nameAr: starterPlan.nameAr,
      nameEn: starterPlan.nameEn,
      trialDays: starterPlan.trialDays,
    });
  }

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
