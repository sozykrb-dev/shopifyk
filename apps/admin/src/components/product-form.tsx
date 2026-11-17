'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus, Trash2 } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldHint,
  Input,
  Label,
  Separator,
  Textarea,
} from '@velnorix/ui';
import {
  createProductAction,
  updateProductAction,
  type ProductFormState,
} from '@/app/actions/products.js';

export type ProductInitialValues = {
  id?: string;
  titleAr: string;
  titleEn: string;
  handle: string;
  descriptionAr: string;
  descriptionEn: string;
  /** Major units, because that is what a merchant types. */
  price: string;
  currency: string;
  sku: string;
  inventory: number;
  status: 'draft' | 'active' | 'archived';
  variants: {
    id?: string;
    titleAr: string;
    titleEn: string;
    sku: string;
    /** Major units. */
    price: string;
    inventoryQuantity: number;
  }[];
  images: { url: string; altAr: string; altEn: string }[];
};

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {label}
    </Button>
  );
}

const EMPTY_VARIANT = { titleAr: '', titleEn: '', sku: '', price: '', inventoryQuantity: 0 };
const EMPTY_IMAGE = { url: '', altAr: '', altEn: '' };

/**
 * Product editor.
 *
 * Variants and images are edited as a whole list and replaced in one
 * transaction, which is the only way "I deleted row two" can mean the same
 * thing in the browser and in the database.
 */
export function ProductForm({
  mode,
  initial,
}: {
  mode: 'create' | 'edit';
  initial: ProductInitialValues;
}) {
  const [state, formAction] = useActionState<ProductFormState, FormData>(
    mode === 'create' ? createProductAction : updateProductAction,
    {},
  );
  const [variants, setVariants] = useState(
    initial.variants.length > 0 ? initial.variants : [{ ...EMPTY_VARIANT }],
  );
  const [images, setImages] = useState(
    initial.images.length > 0 ? initial.images : [{ ...EMPTY_IMAGE }],
  );

  return (
    <form action={formAction} className="space-y-6">
      {initial.id ? <input type="hidden" name="productId" value={initial.id} /> : null}
      {state.error ? <Alert tone="danger" title={state.error} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>البيانات الأساسية</CardTitle>
          <CardDescription>الاسم بالعربية والإنجليزية، والسعر، والمخزون.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="titleAr">الاسم بالعربية</Label>
            <Input id="titleAr" name="titleAr" defaultValue={initial.titleAr} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="titleEn">الاسم بالإنجليزية</Label>
            <Input id="titleEn" name="titleEn" defaultValue={initial.titleEn} dir="ltr" required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="handle">الرابط (handle)</Label>
            <Input
              id="handle"
              name="handle"
              defaultValue={initial.handle}
              dir="ltr"
              className="numeric"
              required
            />
            <FieldHint>يظهر في رابط المنتج: /products/red-sneaker</FieldHint>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sku">رمز المنتج (SKU)</Label>
            <Input id="sku" name="sku" defaultValue={initial.sku} dir="ltr" className="numeric" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="price">السعر بالجنيه</Label>
            <Input
              id="price"
              name="price"
              inputMode="decimal"
              defaultValue={initial.price}
              dir="ltr"
              className="numeric"
              required
            />
            <FieldHint>اكتب 249.99 مثلًا؛ يُخزَّن بالقروش تلقائيًا.</FieldHint>
          </div>
          <div className="space-y-2">
            <Label htmlFor="inventory">المخزون</Label>
            <Input
              id="inventory"
              name="inventory"
              type="number"
              min={0}
              defaultValue={initial.inventory}
              dir="ltr"
              className="numeric"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="currency">العملة</Label>
            <select
              id="currency"
              name="currency"
              defaultValue={initial.currency}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="EGP">جنيه مصري (EGP)</option>
              <option value="SAR">ريال سعودي (SAR)</option>
              <option value="AED">درهم إماراتي (AED)</option>
              <option value="USD">دولار أمريكي (USD)</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">الحالة</Label>
            <select
              id="status"
              name="status"
              defaultValue={initial.status}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="draft">مسودة</option>
              <option value="active">منشور</option>
              <option value="archived">مؤرشف</option>
            </select>
            <FieldHint>المنشور فقط يظهر في المتجر.</FieldHint>
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="descriptionAr">الوصف بالعربية</Label>
            <Textarea
              id="descriptionAr"
              name="descriptionAr"
              rows={4}
              defaultValue={initial.descriptionAr}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="descriptionEn">الوصف بالإنجليزية</Label>
            <Textarea
              id="descriptionEn"
              name="descriptionEn"
              rows={4}
              defaultValue={initial.descriptionEn}
              dir="ltr"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>الخيارات (المقاسات والألوان)</CardTitle>
          <CardDescription>
            لكل خيار سعره ومخزونه. تُحفظ القائمة كاملة عند الحفظ.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {variants.map((variant, index) => (
            <div key={index} className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_1fr_1fr_1fr_5rem_auto]">
              <Input
                name="variantTitleAr"
                placeholder="الاسم عربي (٤٢)"
                defaultValue={variant.titleAr}
                aria-label={`اسم الخيار ${index + 1} بالعربية`}
              />
              <Input
                name="variantTitleEn"
                placeholder="Name (42)"
                defaultValue={variant.titleEn}
                dir="ltr"
                aria-label={`اسم الخيار ${index + 1} بالإنجليزية`}
              />
              <Input
                name="variantSku"
                placeholder="SKU"
                defaultValue={variant.sku}
                dir="ltr"
                className="numeric"
                aria-label={`رمز الخيار ${index + 1}`}
              />
              <Input
                name="variantPrice"
                inputMode="decimal"
                placeholder="السعر"
                defaultValue={variant.price}
                dir="ltr"
                className="numeric"
                aria-label={`سعر الخيار ${index + 1}`}
              />
              <Input
                name="variantQuantity"
                type="number"
                min={0}
                placeholder="المخزون"
                defaultValue={variant.inventoryQuantity}
                dir="ltr"
                className="numeric"
                aria-label={`مخزون الخيار ${index + 1}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`حذف الخيار ${index + 1}`}
                onClick={() => setVariants((rows) => rows.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setVariants((rows) => [...rows, { ...EMPTY_VARIANT }])}
          >
            <Plus className="size-4" /> إضافة خيار
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>الصور</CardTitle>
          <CardDescription>
            الصورة الأولى هي صورة الغلاف. الروابط يجب أن تبدأ بـ https.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {images.map((image, index) => (
            <div key={index} className="grid gap-2 rounded-md border p-3 md:grid-cols-[2fr_1fr_1fr_auto]">
              <Input
                name="imageUrl"
                placeholder="https://…"
                defaultValue={image.url}
                dir="ltr"
                aria-label={`رابط الصورة ${index + 1}`}
              />
              <Input
                name="imageAltAr"
                placeholder="الوصف عربي"
                defaultValue={image.altAr}
                aria-label={`وصف الصورة ${index + 1} بالعربية`}
              />
              <Input
                name="imageAltEn"
                placeholder="Alt (EN)"
                defaultValue={image.altEn}
                dir="ltr"
                aria-label={`وصف الصورة ${index + 1} بالإنجليزية`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`حذف الصورة ${index + 1}`}
                onClick={() => setImages((rows) => rows.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setImages((rows) => [...rows, { ...EMPTY_IMAGE }])}
          >
            <Plus className="size-4" /> إضافة صورة
          </Button>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex items-center gap-3">
        <SaveButton label={mode === 'create' ? 'إنشاء المنتج' : 'حفظ التغييرات'} />
        <Button asChild variant="ghost">
          <Link href="/products">إلغاء</Link>
        </Button>
      </div>
    </form>
  );
}
