import Link from 'next/link';
import { Button } from '@velnorix/ui';

/**
 * Cursor pagination controls.
 *
 * Cursors are opaque strings: they are passed straight through to the next
 * request and never parsed in the browser.
 */
export function PaginationLinks({
  basePath,
  nextCursor,
  prevCursor,
  hasMore,
  query = {},
}: {
  basePath: string;
  nextCursor: string | null;
  prevCursor: string | null;
  hasMore: boolean;
  query?: Record<string, string | undefined>;
}) {
  function hrefWith(cursor: string): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value) params.set(key, value);
    }
    params.set('cursor', cursor);
    return `${basePath}?${params.toString()}`;
  }

  return (
    <nav className="flex items-center justify-between gap-3" aria-label="ترقيم الصفحات">
      {prevCursor ? (
        <Link href={hrefWith(prevCursor)}>
          <Button variant="outline" size="sm">
            السابق
          </Button>
        </Link>
      ) : (
        <Button variant="outline" size="sm" disabled>
          السابق
        </Button>
      )}

      {hasMore && nextCursor ? (
        <Link href={hrefWith(nextCursor)}>
          <Button variant="outline" size="sm">
            التالي
          </Button>
        </Link>
      ) : (
        <Button variant="outline" size="sm" disabled>
          التالي
        </Button>
      )}
    </nav>
  );
}
