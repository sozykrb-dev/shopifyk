/**
 * Slugs for store subdomains, product handles and collection handles.
 *
 * Arabic is a first-class citizen here: we keep Arabic letters instead of
 * transliterating them, so `متجر-الأحذية` is a valid handle and stays readable
 * in URLs and search results.
 */

/** Subdomains we will never hand out to a merchant. */
export const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'assets',
  'billing',
  'blog',
  'cdn',
  'checkout',
  'dashboard',
  'docs',
  'help',
  'internal',
  'login',
  'logout',
  'mail',
  'me',
  'new',
  'platform',
  'settings',
  'shop',
  'signup',
  'static',
  'status',
  'support',
  'velnorix',
  'www',
]);

const MIN_LENGTH = 3;
const MAX_LENGTH = 63;

/**
 * Unicode-aware slugify: lowercases, collapses separators, strips anything that
 * is not a letter, a digit or a dash, and trims dashes from both ends.
 */
export function slugify(input: string, maxLength = MAX_LENGTH): string {
  const normalised = input.normalize('NFKC').toLowerCase();
  const slug = normalised
    .replace(/[\s_/\\]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');

  return slug;
}

export type SlugValidation =
  { valid: true; slug: string } | { valid: false; slug: string; reason: string };

export function validateSlug(input: string, { reserved = RESERVED_SLUGS } = {}): SlugValidation {
  const slug = slugify(input);

  if (slug.length < MIN_LENGTH) {
    return { valid: false, slug, reason: `Must be at least ${MIN_LENGTH} characters.` };
  }
  if (slug.length > MAX_LENGTH) {
    return { valid: false, slug, reason: `Must be at most ${MAX_LENGTH} characters.` };
  }
  if (reserved.has(slug)) {
    return { valid: false, slug, reason: `"${slug}" is reserved.` };
  }
  if (/^-|-$/.test(slug)) {
    return { valid: false, slug, reason: 'Cannot start or end with a dash.' };
  }
  return { valid: true, slug };
}
