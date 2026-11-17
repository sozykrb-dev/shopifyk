'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { PERMISSION } from '@velnorix/auth';
import {
  deleteProduct,
  getProductById,
  replaceProductImages,
  replaceProductVariants,
  updateProduct,
  withTenant,
  createProduct,
} from '@velnorix/db';
import { requirePrincipal } from '@/lib/session.js';

/**
 * Product Server Actions.
 *
 * Every action re-checks the permission and re-resolves the store from the Host
 * header. The store id never comes from the form: a merchant editing another
 * merchant's product is prevented by the permission set, by `withTenant()` and
 * by RLS, and it only takes one of those to hold.
 */

export type ProductFormState = { error?: string };

type ProductFormFields = {
  titleAr: string;
  titleEn: string;
  handle: string;
  descriptionAr: string;
  descriptionEn: string;
  price: string;
  currency: string;
  sku: string;
  inventory: string;
  status: 'draft' | 'active' | 'archived';
};

/**
 * Prices are entered in major units (ج.م) because that is what a merchant
 * types, and stored in minor units (قروش) because that is the only safe way to
 * do arithmetic. The conversion happens once, here.
 */
function parsePrice(value: string): number | null {
  const trimmed = value.trim().replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

function readFields(formData: FormData): ProductFormFields {
  return {
    titleAr: String(formData.get('titleAr') ?? '').trim(),
    titleEn: String(formData.get('titleEn') ?? '').trim(),
    handle: String(formData.get('handle') ?? '').trim(),
    descriptionAr: String(formData.get('descriptionAr') ?? '').trim(),
    descriptionEn: String(formData.get('descriptionEn') ?? '').trim(),
    price: String(formData.get('price') ?? ''),
    currency: String(formData.get('currency') ?? 'EGP').trim().toUpperCase(),
    sku: String(formData.get('sku') ?? '').trim(),
    inventory: String(formData.get('inventory') ?? '0').trim(),
    status: (String(formData.get('status') ?? 'draft') as ProductFormFields['status']),
  };
}

function validate(fields: ProductFormFields): string | null {
  if (!fields.titleAr || !fields.titleEn) {
    return 'الاسم بالعربية وبالإنجليزية مطلوبان.';
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.handle)) {
    return 'الرابط يجب أن يكون بالإنجليزية الصغيرة، والكلمات مفصولة بشرطة (مثال: red-sneaker).';
  }
  return null;
}

/** Requires the write permission and returns the tenant, or an error message. */
async function authorize(): Promise<{ storeId: string } | { error: string }> {
  const { principal, storeId } = await requirePrincipal(['merchant_owner', 'merchant_staff']);
  if (!storeId) return { error: 'هذا النطاق غير مرتبط بأي متجر.' };
  if (!principal.permissions.has(PERMISSION.STORE_PRODUCTS_WRITE)) {
    return { error: 'ليس لديك صلاحية تعديل المنتجات.' };
  }
  return { storeId };
}

function variantRows(formData: FormData): {
  titleAr: string;
  titleEn: string;
  sku: string | null;
  priceMinor: number;
  inventoryQuantity: number;
}[] {
  const titlesAr = formData.getAll('variantTitleAr').map(String);
  const titlesEn = formData.getAll('variantTitleEn').map(String);
  const skus = formData.getAll('variantSku').map(String);
  const prices = formData.getAll('variantPrice').map(String);
  const quantities = formData.getAll('variantQuantity').map(String);

  const rows: {
    titleAr: string;
    titleEn: string;
    sku: string | null;
    priceMinor: number;
    inventoryQuantity: number;
  }[] = [];

  for (let index = 0; index < titlesAr.length; index += 1) {
    const titleAr = titlesAr[index]?.trim() ?? '';
    const titleEn = titlesEn[index]?.trim() ?? '';
    // An empty row means "not filled in", not "a variant with no name".
    if (!titleAr && !titleEn) continue;

    const price = parsePrice(prices[index] ?? '');
    if (price === null) continue;

    rows.push({
      titleAr: titleAr || titleEn,
      titleEn: titleEn || titleAr,
      sku: skus[index]?.trim() || null,
      priceMinor: price,
      inventoryQuantity: Math.max(0, Math.trunc(Number(quantities[index] ?? '0') || 0)),
    });
  }
  return rows;
}

function imageRows(formData: FormData): { url: string; altAr: string | null; altEn: string | null }[] {
  const urls = formData.getAll('imageUrl').map((value) => String(value).trim());
  const altsAr = formData.getAll('imageAltAr').map(String);
  const altsEn = formData.getAll('imageAltEn').map(String);

  return urls
    .map((url, index) => ({
      url,
      altAr: altsAr[index]?.trim() || null,
      altEn: altsEn[index]?.trim() || null,
    }))
    // Only https URLs: a `javascript:` URL in an image field is a stored XSS.
    .filter((image) => /^https:\/\/\S+$/.test(image.url));
}

export async function createProductAction(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const auth = await authorize();
  if ('error' in auth) return { error: auth.error };

  const fields = readFields(formData);
  const invalid = validate(fields);
  if (invalid) return { error: invalid };

  const priceMinor = parsePrice(fields.price);
  if (priceMinor === null) return { error: 'السعر يجب أن يكون رقمًا موجبًا (مثال: 249.99).' };

  const storeId = auth.storeId;
  let productId: string;
  try {
    const product = await withTenant(storeId, (db) =>
      createProduct(db, {
        storeId,
        titleAr: fields.titleAr,
        titleEn: fields.titleEn,
        handle: fields.handle,
        descriptionAr: fields.descriptionAr || null,
        descriptionEn: fields.descriptionEn || null,
        priceMinor,
        currency: fields.currency,
        sku: fields.sku || null,
        inventoryQuantity: Math.max(0, Math.trunc(Number(fields.inventory) || 0)),
        status: fields.status,
      }),
    );
    productId = product.id;

    const variants = variantRows(formData);
    if (variants.length > 0) {
      await withTenant(storeId, (db) => replaceProductVariants(db, productId, variants));
    }
    const images = imageRows(formData);
    if (images.length > 0) {
      await withTenant(storeId, (db) => replaceProductImages(db, productId, images));
    }
  } catch {
    // The unique index on (store_id, handle) is the real guard; a friendly
    // message beats a 500.
    return { error: 'يوجد منتج آخر بنفس الرابط. غيّر الرابط وحاول مرة أخرى.' };
  }

  revalidatePath('/products');
  redirect(`/products/${productId}?created=1`);
}

export async function updateProductAction(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const auth = await authorize();
  if ('error' in auth) return { error: auth.error };

  const productId = String(formData.get('productId') ?? '');
  const fields = readFields(formData);
  const invalid = validate(fields);
  if (invalid) return { error: invalid };

  const priceMinor = parsePrice(fields.price);
  if (priceMinor === null) return { error: 'السعر يجب أن يكون رقمًا موجبًا (مثال: 249.99).' };

  const storeId = auth.storeId;
  try {
    const updated = await withTenant(storeId, (db) =>
      updateProduct(db, productId, {
        titleAr: fields.titleAr,
        titleEn: fields.titleEn,
        handle: fields.handle,
        descriptionAr: fields.descriptionAr || null,
        descriptionEn: fields.descriptionEn || null,
        priceMinor,
        currency: fields.currency,
        sku: fields.sku || null,
        inventoryQuantity: Math.max(0, Math.trunc(Number(fields.inventory) || 0)),
        status: fields.status,
      }),
    );
    if (!updated) return { error: 'المنتج غير موجود في هذا المتجر.' };

    await withTenant(storeId, (db) => replaceProductVariants(db, productId, variantRows(formData)));
    await withTenant(storeId, (db) => replaceProductImages(db, productId, imageRows(formData)));
  } catch {
    return { error: 'يوجد منتج آخر بنفس الرابط. غيّر الرابط وحاول مرة أخرى.' };
  }

  revalidatePath('/products');
  revalidatePath(`/products/${productId}`);
  return {};
}

export async function deleteProductAction(formData: FormData): Promise<void> {
  const { principal, storeId } = await requirePrincipal(['merchant_owner', 'merchant_staff']);
  const productId = String(formData.get('productId') ?? '');

  // Deleting is a separate permission from editing: a staff member who may
  // write products must not be able to erase the catalogue.
  if (!storeId || !principal.permissions.has(PERMISSION.STORE_PRODUCTS_DELETE)) {
    redirect('/products?denied=1');
  }

  const product = await withTenant(storeId, (db) => getProductById(db, productId));
  if (!product) redirect('/products');

  await withTenant(storeId, (db) => deleteProduct(db, productId));
  revalidatePath('/products');
  redirect('/products?deleted=1');
}
