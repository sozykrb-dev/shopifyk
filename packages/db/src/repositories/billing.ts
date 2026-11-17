import { and, desc, eq, sql } from 'drizzle-orm';
import { money, type Money } from '@velnorix/core';
import type { Database } from '../client.js';
import {
  invoices,
  plans,
  subscriptions,
  type Invoice,
  type InvoiceLine,
  type NewInvoice,
  type NewSubscription,
  type Subscription,
} from '../schema.js';

/**
 * Subscriptions and invoices.
 *
 * The invoice is a document, not a computation: the amount is written when the
 * invoice is issued and never recomputed, so raising the plan price tomorrow
 * cannot change what a merchant was billed last month.
 */

export type BillingPeriod = { start: Date; end: Date };

/** One month from `from`, clamped the way billing periods actually work. */
export function nextPeriod(from: Date, months = 1): BillingPeriod {
  const start = new Date(from);
  const end = new Date(from);
  end.setMonth(end.getMonth() + months);
  // 31 January + 1 month must land on 28/29 February, not 3 March.
  if (end.getDate() !== start.getDate()) end.setDate(0);
  return { start, end };
}

export async function getSubscriptionForStore(
  db: Database,
  storeId: string,
): Promise<Subscription | null> {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.storeId, storeId))
    .limit(1);
  return row ?? null;
}

/** Starts a subscription, or moves an existing one onto a different plan. */
export async function startSubscription(
  db: Database,
  input: {
    storeId: string;
    planId: string;
    trialDays?: number;
    provider?: string | null;
    providerReference?: string | null;
  },
): Promise<Subscription> {
  const now = new Date();
  const trialDays = input.trialDays ?? 0;
  const period = nextPeriod(trialDays > 0 ? addDays(now, trialDays) : now);

  const values: NewSubscription = {
    storeId: input.storeId,
    planId: input.planId,
    status: trialDays > 0 ? 'trialing' : 'active',
    currentPeriodStart: now,
    currentPeriodEnd: period.end,
    trialEndsAt: trialDays > 0 ? addDays(now, trialDays) : null,
    provider: input.provider ?? null,
    providerReference: input.providerReference ?? null,
  };

  const [row] = await db
    .insert(subscriptions)
    .values(values)
    .onConflictDoUpdate({
      target: subscriptions.storeId,
      set: {
        planId: input.planId,
        status: values.status,
        currentPeriodStart: values.currentPeriodStart,
        currentPeriodEnd: values.currentPeriodEnd,
        trialEndsAt: values.trialEndsAt,
        provider: values.provider,
        providerReference: values.providerReference,
        cancelledAt: null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}

export async function cancelSubscription(
  db: Database,
  storeId: string,
  options: { immediately?: boolean } = {},
): Promise<Subscription | null> {
  const [row] = await db
    .update(subscriptions)
    .set({
      status: options.immediately ? 'cancelled' : 'active',
      cancelledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.storeId, storeId))
    .returning();
  return row ?? null;
}

/** Moves a subscription into its next period. Returns false if none existed. */
export async function advanceSubscriptionPeriod(
  db: Database,
  storeId: string,
): Promise<Subscription | null> {
  const existing = await getSubscriptionForStore(db, storeId);
  if (!existing) return null;

  const period = nextPeriod(existing.currentPeriodEnd);
  const [row] = await db
    .update(subscriptions)
    .set({
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      status: 'active',
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.storeId, storeId))
    .returning();
  return row ?? null;
}

export type IssueInvoiceInput = {
  storeId: string;
  subscriptionId?: string | null;
  lines: readonly InvoiceLine[];
  currency?: string;
  taxMinor?: number;
  /** Days until the invoice is due. */
  dueInDays?: number;
  notes?: string | null;
};

/**
 * Issues an invoice for a store.
 *
 * The number is allocated per store inside this call, so two invoices issued at
 * once cannot both be "فاتورة 4".
 */
export async function issueInvoice(db: Database, input: IssueInvoiceInput): Promise<Invoice> {
  const storeId = input.storeId;
  const currency = input.currency ?? 'EGP';
  const subtotalMinor = input.lines.reduce((total, line) => total + line.totalMinor, 0);
  const taxMinor = Math.max(0, Math.trunc(input.taxMinor ?? 0));
  const now = new Date();
  const dueAt = addDays(now, input.dueInDays ?? 14);

  return db.transaction(async (tx) => {
    const [numbered] = await tx
      .select({
        value: sql<number>`(
          SELECT COALESCE(MAX(${invoices.invoiceNumber}), 0) + 1
          FROM ${invoices}
          WHERE ${invoices.storeId} = ${storeId}
        )`.as('invoice_number'),
      })
      .from(sql`(SELECT 1) AS t`);

    const values: NewInvoice = {
      storeId,
      subscriptionId: input.subscriptionId ?? null,
      invoiceNumber: numbered?.value ?? 1,
      status: 'open',
      currency,
      lines: [...input.lines],
      subtotalMinor,
      taxMinor,
      totalMinor: subtotalMinor + taxMinor,
      issuedAt: now,
      dueAt,
      notes: input.notes ?? null,
    };

    const [invoice] = await tx.insert(invoices).values(values).returning();
    return invoice!;
  });
}

export async function listInvoices(
  db: Database,
  storeId: string,
  options: { limit?: number; status?: Invoice['status'] } = {},
): Promise<Invoice[]> {
  const conditions = [eq(invoices.storeId, storeId)];
  if (options.status) conditions.push(eq(invoices.status, options.status));
  return db
    .select()
    .from(invoices)
    .where(and(...conditions))
    .orderBy(desc(invoices.issuedAt), desc(invoices.id))
    .limit(options.limit ?? 50);
}

export async function getInvoiceByNumber(
  db: Database,
  storeId: string,
  invoiceNumber: number,
): Promise<Invoice | null> {
  const [row] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.storeId, storeId), eq(invoices.invoiceNumber, invoiceNumber)))
    .limit(1);
  return row ?? null;
}

/**
 * Marks an invoice paid.
 *
 * `paymentMethod` is recorded rather than assumed: a manual transfer and a card
 * charge are both just "paid", and the finance team needs to know which.
 */
export async function markInvoicePaid(
  db: Database,
  invoiceId: string,
  options: { method?: string; reference?: string | null; paidAt?: Date } = {},
): Promise<Invoice | null> {
  const [row] = await db
    .update(invoices)
    .set({
      status: 'paid',
      paidAt: options.paidAt ?? new Date(),
      paymentMethod: options.method ?? 'manual',
      paymentReference: options.reference ?? null,
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId))
    .returning();
  return row ?? null;
}

export async function voidInvoice(db: Database, invoiceId: string): Promise<Invoice | null> {
  const [row] = await db
    .update(invoices)
    .set({ status: 'void', voidedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.status, 'open')))
    .returning();
  return row ?? null;
}

/**
 * Overdue open invoices for one store, which is what a dunning email would be
 * built from.
 *
 * Scoped to a store rather than global: the platform role only ever sees rows
 * inside a tenant scope, so "every overdue invoice" is read store by store --
 * which is also how dunning is sent.
 */
export async function listOverdueInvoices(
  db: Database,
  storeId: string,
  asOf = new Date(),
): Promise<Invoice[]> {
  return db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.storeId, storeId),
        eq(invoices.status, 'open'),
        // `sql` cannot bind a JS Date through the driver, so it is passed as an
        // ISO string and cast on the server.
        sql`${invoices.dueAt} < ${asOf.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(invoices.dueAt);
}

/**
 * One store's subscription and what it contributes to MRR.
 *
 * Read inside `withPlatformTenant(store.id)`: billing rows are tenant data like
 * any other, so there is no "read everything" query to leak. The platform
 * totals are summed by the caller over the stores it is allowed to see, which
 * also keeps the cost proportional to what is actually on screen.
 */
export async function storeRevenue(
  db: Database,
  storeId: string,
): Promise<{
  mrrMinor: number;
  currency: string;
  status: string | null;
  planKey: string | null;
  trialing: boolean;
}> {
  const [row] = await db
    .select({
      price: plans.priceMinor,
      currency: plans.currency,
      status: subscriptions.status,
      planKey: plans.key,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.storeId, storeId))
    .limit(1);

  const paying = row?.status === 'active' || row?.status === 'past_due';

  return {
    mrrMinor: paying ? Number(row?.price ?? 0) : 0,
    currency: row?.currency ?? 'EGP',
    status: row?.status ?? null,
    planKey: row?.planKey ?? null,
    trialing: row?.status === 'trialing',
  };
}

/** The current period's price for a store, as a Money. */
export function subscriptionPrice(plan: { priceMinor: number; currency: string }): Money {
  return money(plan.priceMinor, plan.currency);
}

function addDays(from: Date, days: number): Date {
  const date = new Date(from);
  date.setDate(date.getDate() + days);
  return date;
}
