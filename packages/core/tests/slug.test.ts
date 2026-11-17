import { describe, expect, it } from 'vitest';
import { slugify, validateSlug } from '../src/slug.js';

describe('slugify', () => {
  it('keeps Arabic letters', () => {
    expect(slugify('متجر الأحذية')).toBe('متجر-الأحذية');
  });

  it('handles mixed scripts, casing and punctuation', () => {
    expect(slugify('  Cairo   Sneakers!! ')).toBe('cairo-sneakers');
    expect(slugify('Zad_Store/2026')).toBe('zad-store-2026');
    expect(slugify('---test---')).toBe('test');
  });

  it('strips emoji and symbols', () => {
    expect(slugify('Shop 🚀 Now')).toBe('shop-now');
  });
});

describe('validateSlug', () => {
  it('accepts a normal slug', () => {
    expect(validateSlug('Cairo Sneakers')).toEqual({ valid: true, slug: 'cairo-sneakers' });
  });

  it('rejects reserved words', () => {
    const result = validateSlug('admin');
    expect(result.valid).toBe(false);
    expect(validateSlug('www').valid).toBe(false);
  });

  it('rejects slugs that are too short', () => {
    expect(validateSlug('ab').valid).toBe(false);
    expect(validateSlug('أب').valid).toBe(false);
  });
});
