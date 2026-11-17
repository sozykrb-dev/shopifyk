import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { truncateAllData } from '@velnorix/test-utils';
import {
  closeDatabase,
  createProduct,
  createStore,
  deleteProduct,
  getProductByHandle,
  listProducts,
  plans,
  updateProduct,
  withPlatform,
  withTenant,
  type Store,
} from '../src/index.js';

describe('products repository (tenant scope)', () => {
  let store: Store;

  beforeEach(async () => {
    await truncateAllData();
    store = await withPlatform(async (db) => {
      const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.key, 'starter'));
      if (!plan) throw new Error('missing starter plan');
      return createStore(db, { slug: 'cairo-sneakers', name: 'Cairo Sneakers', planId: plan.id });
    });
  });

  afterAll(async () => {
    await closeDatabase();
  });

  async function seed(count: number): Promise<void> {
    await withTenant(store.id, async (db) => {
      for (let index = 0; index < count; index += 1) {
        await createProduct(db, {
          storeId: store.id,
          titleEn: `Product ${index}`,
          titleAr: `منتج ${index}`,
          handle: `product-${index}`,
          priceMinor: 1_000 * (index + 1),
          status: index % 2 === 0 ? 'active' : 'draft',
        });
      }
    });
  }

  it('pages with a cursor and never repeats a row', async () => {
    await seed(7);

    const page1 = await withTenant(store.id, (db) => listProducts(db, { limit: 3 }));
    expect(page1.items).toHaveLength(3);
    expect(page1.hasMore).toBe(true);

    const page2 = await withTenant(store.id, (db) =>
      listProducts(db, { limit: 3, cursor: page1.nextCursor ?? undefined }),
    );
    const page3 = await withTenant(store.id, (db) =>
      listProducts(db, { limit: 3, cursor: page2.nextCursor ?? undefined }),
    );

    expect(page3.items).toHaveLength(1);
    expect(page3.hasMore).toBe(false);

    const handles = [...page1.items, ...page2.items, ...page3.items].map((p) => p.handle);
    expect(new Set(handles).size).toBe(7);
  });

  it('filters by status and searches in both languages', async () => {
    await seed(4);

    const active = await withTenant(store.id, (db) =>
      listProducts(db, { limit: 10, status: 'active' }),
    );
    expect(active.items.every((product) => product.status === 'active')).toBe(true);

    const byEnglish = await withTenant(store.id, (db) =>
      listProducts(db, { limit: 10, search: 'Product 1' }),
    );
    expect(byEnglish.items.map((product) => product.handle)).toEqual(['product-1']);

    const byArabic = await withTenant(store.id, (db) =>
      listProducts(db, { limit: 10, search: 'منتج 2' }),
    );
    expect(byArabic.items.map((product) => product.handle)).toEqual(['product-2']);
  });

  it('rejects a duplicate handle inside the same store', async () => {
    await seed(1);
    await expect(
      withTenant(store.id, (db) =>
        createProduct(db, {
          storeId: store.id,
          titleEn: 'Duplicate',
          titleAr: 'مكرر',
          handle: 'product-0',
          priceMinor: 1,
        }),
      ),
    ).rejects.toThrow();
  });

  it('updates and deletes products', async () => {
    await seed(1);
    const firstPage = await withTenant(store.id, (db) => listProducts(db, { limit: 1 }));
    const created = firstPage.items[0];
    expect(created).toBeDefined();

    const updated = await withTenant(store.id, (db) =>
      updateProduct(db, created!.id, { priceMinor: 12_345, status: 'active' }),
    );
    expect(updated.priceMinor).toBe(12_345);
    // Publishing stamps published_at exactly once; it is active already here.
    expect(updated.publishedAt).toBeInstanceOf(Date);
    const republished = await withTenant(store.id, (db) =>
      updateProduct(db, created!.id, { titleEn: 'Renamed' }),
    );
    expect(republished.publishedAt?.getTime()).toBe(updated.publishedAt?.getTime());

    expect(await withTenant(store.id, (db) => deleteProduct(db, created!.id))).toBe(true);
    expect(await withTenant(store.id, (db) => getProductByHandle(db, 'product-0'))).toBeNull();
  });
});
