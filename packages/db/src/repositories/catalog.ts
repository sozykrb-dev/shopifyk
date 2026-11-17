import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { requireTenantId } from '../tenant-context.js';
import {
  productImages,
  productVariants,
  type NewProductImage,
  type NewProductVariant,
  type ProductImage,
  type ProductVariant,
} from '../schema.js';

/**
 * Product media and variants (tenant tables).
 *
 * Images and variants are stored as rows rather than JSON so they can be
 * queried, counted and indexed, and so a variant can carry its own price and
 * stock -- which is what "size M is out of stock" actually means.
 */

export type ProductMedia = {
  images: ProductImage[];
  variants: ProductVariant[];
};

export async function listProductImages(db: Database, productId: string): Promise<ProductImage[]> {
  return db
    .select()
    .from(productImages)
    .where(
      and(eq(productImages.storeId, requireTenantId()), eq(productImages.productId, productId)),
    )
    .orderBy(asc(productImages.position), asc(productImages.createdAt));
}

export async function listProductVariants(
  db: Database,
  productId: string,
): Promise<ProductVariant[]> {
  return db
    .select()
    .from(productVariants)
    .where(
      and(eq(productVariants.storeId, requireTenantId()), eq(productVariants.productId, productId)),
    )
    .orderBy(asc(productVariants.position), asc(productVariants.createdAt));
}

/** Loads images and variants for one product in a single round trip. */
export async function getProductMedia(db: Database, productId: string): Promise<ProductMedia> {
  const [images, variants] = await Promise.all([
    listProductImages(db, productId),
    listProductVariants(db, productId),
  ]);
  return { images, variants };
}

export type ImageInput = {
  url: string;
  altEn?: string | null;
  altAr?: string | null;
};

export type VariantInput = {
  titleEn: string;
  titleAr: string;
  sku?: string | null;
  priceMinor: number;
  currency?: string;
  inventoryQuantity?: number;
};

/**
 * Replaces a product's images.
 *
 * Replace-instead-of-patch is deliberate: the admin form posts the whole list,
 * and a diffing update is the classic way to end up with orphaned rows. This
 * runs inside the caller's transaction, so a failure removes nothing.
 */
export async function replaceProductImages(
  db: Database,
  productId: string,
  images: readonly ImageInput[],
): Promise<ProductImage[]> {
  const storeId = requireTenantId();
  await db
    .delete(productImages)
    .where(and(eq(productImages.storeId, storeId), eq(productImages.productId, productId)));

  if (images.length === 0) return [];

  const rows: NewProductImage[] = images.map((image, index) => ({
    storeId,
    productId,
    url: image.url,
    altEn: image.altEn ?? null,
    altAr: image.altAr ?? null,
    position: index,
  }));
  return db.insert(productImages).values(rows).returning();
}

/** Replaces a product's variants. Same reasoning as `replaceProductImages`. */
export async function replaceProductVariants(
  db: Database,
  productId: string,
  variants: readonly VariantInput[],
): Promise<ProductVariant[]> {
  const storeId = requireTenantId();
  await db
    .delete(productVariants)
    .where(and(eq(productVariants.storeId, storeId), eq(productVariants.productId, productId)));

  if (variants.length === 0) return [];

  const rows: NewProductVariant[] = variants.map((variant, index) => ({
    storeId,
    productId,
    titleEn: variant.titleEn,
    titleAr: variant.titleAr,
    sku: variant.sku ?? null,
    priceMinor: variant.priceMinor,
    currency: variant.currency ?? 'EGP',
    inventoryQuantity: variant.inventoryQuantity ?? 0,
    position: index,
  }));
  return db.insert(productVariants).values(rows).returning();
}
