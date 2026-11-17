'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, Label } from '@velnorix/ui';
import { addToCartAction, type CartState } from '@/app/actions/cart.js';

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={disabled} loading={pending}>
      أضف إلى السلة
    </Button>
  );
}

/**
 * Add-to-cart form.
 *
 * Only the product id, variant id and quantity are sent: the price is read from
 * the database inside the action, never from the browser.
 */
export function AddToCartForm({
  productId,
  variants,
  inStock,
}: {
  productId: string;
  variants: readonly { id: string; title: string; inStock: boolean }[];
  inStock: boolean;
}) {
  const [variantId, setVariantId] = useState(variants[0]?.id ?? '');
  const [quantity, setQuantity] = useState(1);
  const [state, formAction] = useActionState<CartState, FormData>(addToCartAction, {});

  return (
    <form action={formAction} className="space-y-3">
      {state.error ? <Alert tone="danger" title={state.error} /> : null}
      {state.ok ? <Alert tone="success" title={state.ok} /> : null}

      <input type="hidden" name="productId" value={productId} />
      {variantId ? <input type="hidden" name="variantId" value={variantId} /> : null}

      {variants.length > 0 ? (
        <div className="space-y-2">
          <Label htmlFor="variant">اختر المقاس / اللون</Label>
          <div className="flex flex-wrap gap-2" id="variant">
            {variants.map((variant) => (
              <button
                key={variant.id}
                type="button"
                onClick={() => setVariantId(variant.id)}
                className={
                  variantId === variant.id
                    ? 'rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-sm font-medium'
                    : 'rounded-md border px-3 py-1.5 text-sm'
                }
              >
                {variant.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <Label htmlFor="quantity">الكمية</Label>
        <input
          id="quantity"
          name="quantity"
          type="number"
          min={1}
          max={99}
          value={quantity}
          onChange={(event) => setQuantity(Number(event.target.value))}
          className="h-9 w-20 rounded-md border border-input bg-background px-3 py-1 text-sm numeric"
        />
      </div>

      <SubmitButton disabled={!inStock} />
      {!inStock ? <p className="text-sm text-destructive">هذا المنتج غير متوفر حاليًا.</p> : null}
    </form>
  );
}
