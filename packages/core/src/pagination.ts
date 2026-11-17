import { z } from 'zod';
import { ValidationError } from './errors.js';

/**
 * Cursor pagination.
 *
 * Every admin list and every public API list is cursor based: OFFSET pagination
 * breaks (duplicates/skips) as soon as a row is inserted while the user pages,
 * and it gets slower the deeper you go.
 */

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export const paginationInputSchema = z.object({
  // Values above MAX_LIMIT are clamped, not rejected: a client asking for 10_000
  // rows gets 100, it does not get an error in the middle of listing orders.
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .transform((value) => Math.min(value, MAX_LIMIT))
    .default(DEFAULT_LIMIT),
  cursor: z.string().min(1).max(512).optional(),
  direction: z.enum(['forward', 'backward']).default('forward'),
});

export type PaginationInput = z.infer<typeof paginationInputSchema>;

export type CursorPayload = {
  /** Sort key value of the last row (created_at, name, price, ...). */
  k: string;
  /** Tie-breaker: the row id, so equal sort keys still page deterministically. */
  i: string;
};

/** Opaque, URL-safe cursor. Clients must treat it as a black box. */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const result = z.object({ k: z.string(), i: z.string().min(1) }).safeParse(parsed);
    if (!result.success) throw new ValidationError('Malformed cursor.');
    return result.data;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('Malformed cursor.');
  }
}

export type Page<T> = {
  items: T[];
  /** Cursor to send for the next page; `null` when there is nothing more. */
  nextCursor: string | null;
  prevCursor: string | null;
  hasMore: boolean;
};

/**
 * Builds a page from `limit + 1` fetched rows: the extra row only tells us
 * whether another page exists, it is never returned to the caller.
 */
export function buildPage<T>(
  rows: T[],
  limit: number,
  keyOf: (row: T) => { k: string; i: string },
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const first = items[0];
  const last = items[items.length - 1];

  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(keyOf(last)) : null,
    prevCursor: first ? encodeCursor(keyOf(first)) : null,
  };
}
