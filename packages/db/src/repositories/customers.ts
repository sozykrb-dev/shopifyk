import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { orders, users } from '../schema.js';

/**
 * Customers repository.
 *
 * A store's customers are the people who bought from it, which is *not* the
 * same set as the users who registered. Anyone can check out as a guest, and
 * plenty do — a merchant who only sees registered accounts concludes the store
 * has four customers when it actually has forty. So this reads orders first
 * and joins accounts onto them, rather than the other way round.
 *
 * Everything is grouped by email, because that is the only identifier a guest
 * order carries. Two rows for the same person under different capitalisation
 * would be two customers, so addresses are normalised on the way in.
 */

export type CustomerSummary = {
  email: string;
  /** Display name: the account's, or null when nobody registered. */
  fullName: string | null;
  /** Null for a guest who never created an account. */
  userId: string | null;
  registered: boolean;
  orderCount: number;
  /** Lifetime spend. Money is integer minor units — see ADR 0006. */
  totalSpentMinor: number;
  currency: string | null;
  lastOrderAt: Date | null;
};

export type ListCustomersOptions = {
  limit?: number;
  /** Case-insensitive match on name or email. */
  search?: string;
};

/**
 * One row per customer, best spenders first.
 *
 * Read inside `withPlatformTenant(storeId, …)`: orders are tenant data and RLS
 * is the reason a merchant cannot read another store's customers even if a
 * query here is ever written carelessly.
 */
export async function listStoreCustomers(
  db: Database,
  storeId: string,
  options: ListCustomersOptions = {},
): Promise<CustomerSummary[]> {
  const limit = options.limit ?? 100;

  /*
   * Orders are the source of truth for "is this a customer". Grouping by the
   * lowercased email folds guest and signed-in orders for the same person into
   * one row, which is what the merchant expects to see.
   */
  const grouped = await db
    .select({
      email: sql<string>`lower(${orders.email})`.as('email'),
      orderCount: sql<number>`count(*)::int`.as('order_count'),
      totalSpentMinor: sql<number>`coalesce(sum(${orders.totalMinor}), 0)::bigint`.as(
        'total_spent',
      ),
      /*
       * Cast to text and parse by hand. An aggregate over a timestamp comes
       * back from the driver as a string, not a Date -- annotating it
       * `sql<Date | null>` compiles happily and then explodes at render time
       * on `toLocaleDateString`. Being explicit here is the whole fix.
       */
      lastOrderAt: sql<string | null>`max(${orders.placedAt})::text`.as('last_order_at'),
      currency: sql<string | null>`min(${orders.currency})`.as('currency'),
    })
    .from(orders)
    .where(eq(orders.storeId, storeId))
    .groupBy(sql`lower(${orders.email})`)
    .orderBy(desc(sql`sum(${orders.totalMinor})`))
    .limit(limit);

  const accounts = await db
    .select({
      id: users.id,
      email: users.emailNormalized,
      fullName: users.fullName,
    })
    .from(users)
    .where(and(eq(users.context, 'customer'), eq(users.storeId, storeId)));

  const byEmail = new Map(
    accounts
      .filter((account) => account.email !== null)
      .map((account) => [account.email!.toLowerCase(), account]),
  );

  const rows: CustomerSummary[] = grouped.map((row) => {
    const account = byEmail.get(row.email);
    return {
      email: row.email,
      fullName: account?.fullName ?? null,
      userId: account?.id ?? null,
      registered: Boolean(account),
      orderCount: row.orderCount,
      totalSpentMinor: Number(row.totalSpentMinor),
      currency: row.currency,
      lastOrderAt: row.lastOrderAt ? new Date(row.lastOrderAt) : null,
    };
  });

  /*
   * Registered-but-never-ordered accounts are still customers in the sense
   * that matters: they gave you their email address. They are appended at the
   * bottom, because a list sorted by spend has nothing to say about them.
   */
  const seen = new Set(rows.map((row) => row.email));
  const withoutOrders = accounts
    .filter((account) => account.email !== null && !seen.has(account.email.toLowerCase()))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar'))
    .slice(0, Math.max(0, limit - rows.length))
    .map<CustomerSummary>((account) => ({
      email: account.email!.toLowerCase(),
      fullName: account.fullName,
      userId: account.id,
      registered: true,
      orderCount: 0,
      totalSpentMinor: 0,
      currency: null,
      lastOrderAt: null,
    }));

  const all = [...rows, ...withoutOrders];

  if (options.search) {
    const needle = options.search.trim().toLowerCase();
    return all.filter(
      (row) => row.email.includes(needle) || (row.fullName ?? '').toLowerCase().includes(needle),
    );
  }

  return all;
}

/** One customer's order history, newest first. */
export async function listCustomerOrdersByEmail(
  db: Database,
  storeId: string,
  email: string,
  limit = 50,
): Promise<
  Array<{
    id: string;
    orderNumber: number;
    status: string;
    paymentStatus: string;
    totalMinor: number;
    currency: string;
    placedAt: Date;
  }>
> {
  return db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      totalMinor: orders.totalMinor,
      currency: orders.currency,
      placedAt: orders.placedAt,
    })
    .from(orders)
    .where(and(eq(orders.storeId, storeId), eq(sql`lower(${orders.email})`, email.toLowerCase())))
    .orderBy(desc(orders.placedAt))
    .limit(limit);
}

/**
 * How many distinct customers, and how many of them came back.
 *
 * "Repeat customers" is the number a merchant actually cares about and the one
 * most dashboards leave out, because the query is mildly annoying.
 *
 * `guests` counts people who ordered without ever registering. If it is high,
 * the fix is a better checkout, not a better email campaign.
 */
export async function customerStats(
  db: Database,
  storeId: string,
): Promise<{ total: number; registered: number; guests: number; repeat: number }> {
  const rows = await db
    .select({
      email: sql<string>`lower(${orders.email})`.as('email'),
      orderCount: sql<number>`count(*)::int`.as('order_count'),
    })
    .from(orders)
    .where(eq(orders.storeId, storeId))
    .groupBy(sql`lower(${orders.email})`);

  const accounts = await db
    .select({ email: users.emailNormalized })
    .from(users)
    .where(and(eq(users.context, 'customer'), eq(users.storeId, storeId)));

  const accountEmails = new Set(
    accounts
      .filter((account) => account.email !== null)
      .map((account) => account.email!.toLowerCase()),
  );
  const buyers = new Set(rows.map((row) => row.email));

  // A registered account that never ordered is still a customer; a buyer
  // without an account is a guest. The union is the real customer count.
  const all = new Set<string>([...buyers, ...accountEmails]);

  return {
    total: all.size,
    registered: accountEmails.size,
    guests: [...buyers].filter((email) => !accountEmails.has(email)).length,
    repeat: rows.filter((row) => row.orderCount > 1).length,
  };
}
