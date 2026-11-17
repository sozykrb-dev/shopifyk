import Link from 'next/link';
import { Badge, Button } from '@velnorix/ui';
import { currentCart } from '@/lib/cart.js';
import { resolveStorefront } from '@/lib/store-context.js';
import { logoutAction } from '@/app/actions/account.js';

/**
 * Storefront header: the store's name, the cart, and the customer's account.
 *
 * It is a Server Component, so the cart total and the signed-in customer are
 * read on every request -- a stale "3 items in your cart" is worse than a slow
 * header.
 */
export async function StoreHeader({
  storeName,
  storeSlug,
  children,
}: {
  storeName: string;
  storeSlug: string;
  children: React.ReactNode;
}) {
  const resolved = await resolveStorefront();

  let itemCount = 0;
  if (resolved) {
    const cart = await currentCart({
      storeId: resolved.store.id,
      currency: resolved.currency,
      customerUserId: resolved.customerUserId,
    });
    itemCount = cart.itemCount;
  }

  const signedIn = Boolean(resolved?.customerUserId);

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <Link href="/" className="flex flex-col">
            <span className="text-base font-semibold tracking-tight">{storeName}</span>
            <span className="text-xs text-muted-foreground numeric">{storeSlug}</span>
          </Link>

          <nav className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link href="/">الرئيسية</Link>
            </Button>

            <Button asChild variant="ghost" size="sm" className="relative">
              <Link href="/cart" aria-label="السلة">
                السلة
                {itemCount > 0 ? (
                  <Badge tone="primary" className="ms-1 px-1.5 py-0 numeric">
                    {itemCount}
                  </Badge>
                ) : null}
              </Link>
            </Button>

            {signedIn ? (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/account">حسابي</Link>
                </Button>
                <form action={logoutAction}>
                  <Button type="submit" variant="ghost" size="sm">
                    خروج
                  </Button>
                </form>
              </>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/account/login">تسجيل الدخول</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href="/account/register">تسجيل</Link>
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>
      {children}
      <footer className="mt-16 border-t">
        <div className="mx-auto max-w-6xl px-4 py-8 text-xs text-muted-foreground">
          {storeName} · مدعوم بـ Velnorix
        </div>
      </footer>
    </>
  );
}
