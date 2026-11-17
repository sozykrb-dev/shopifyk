import { describe, expect, it } from 'vitest';
import {
  MAX_LIMIT,
  buildPage,
  decodeCursor,
  encodeCursor,
  paginationInputSchema,
} from '../src/pagination.js';
import { ValidationError } from '../src/errors.js';

describe('pagination', () => {
  it('clamps the limit and defaults sanely', () => {
    expect(paginationInputSchema.parse({}).limit).toBe(25);
    expect(paginationInputSchema.parse({ limit: '10' }).limit).toBe(10);
    expect(paginationInputSchema.parse({ limit: 9999 }).limit).toBe(MAX_LIMIT);
    expect(() => paginationInputSchema.parse({ limit: 0 })).toThrow();
  });

  it('round-trips a cursor', () => {
    const cursor = encodeCursor({ k: '2026-01-01T00:00:00.000Z', i: 'b7f1' });
    expect(cursor).not.toContain('=');
    expect(decodeCursor(cursor)).toEqual({ k: '2026-01-01T00:00:00.000Z', i: 'b7f1' });
  });

  it('rejects tampered cursors', () => {
    expect(() => decodeCursor('not-base64-json')).toThrow(ValidationError);
    expect(() => decodeCursor(encodeURIComponent('{"k":1}'))).toThrow(ValidationError);
  });

  it('drops the probe row and reports hasMore', () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      id: `id-${index}`,
      createdAt: `2026-01-0${index + 1}`,
    }));
    const page = buildPage(rows, 5, (row) => ({ k: row.createdAt, i: row.id }));

    expect(page.items).toHaveLength(5);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe(encodeCursor({ k: '2026-01-05', i: 'id-4' }));
    expect(page.prevCursor).toBe(encodeCursor({ k: '2026-01-01', i: 'id-0' }));
  });

  it('reports the last page', () => {
    const rows = [{ id: 'a', createdAt: 'x' }];
    const page = buildPage(rows, 5, (row) => ({ k: row.createdAt, i: row.id }));
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });
});
