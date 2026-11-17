import { ValidationError } from './errors.js';

/**
 * Money is ALWAYS an integer number of minor units plus an ISO-4217 code.
 *
 * Rules that the rest of the codebase relies on:
 *  - never a float, never a string, never an implicit currency;
 *  - every currency carries its own decimal exponent (EGP 2, KWD 3, JPY 0);
 *  - arithmetic goes through BigInt so no intermediate value can drift;
 *  - splitting money (`allocate`) is lossless -- the parts always sum to the whole.
 */
export type Money = Readonly<{ amount: number; currency: string }>;

type CurrencyMeta = { code: string; exponent: number; locale: string };

/** ISO 4217 exponents for the currencies Velnorix supports today. */
const CURRENCIES: Record<string, { exponent: number; locale: string }> = {
  EGP: { exponent: 2, locale: 'ar-EG-u-nu-latn' },
  USD: { exponent: 2, locale: 'en-US' },
  EUR: { exponent: 2, locale: 'de-DE' },
  GBP: { exponent: 2, locale: 'en-GB' },
  SAR: { exponent: 2, locale: 'ar-SA-u-nu-latn' },
  AED: { exponent: 2, locale: 'ar-AE-u-nu-latn' },
  QAR: { exponent: 2, locale: 'ar-QA-u-nu-latn' },
  KWD: { exponent: 3, locale: 'ar-KW-u-nu-latn' },
  BHD: { exponent: 3, locale: 'ar-BH-u-nu-latn' },
  OMR: { exponent: 3, locale: 'ar-OM-u-nu-latn' },
  JOD: { exponent: 3, locale: 'ar-JO-u-nu-latn' },
  TND: { exponent: 3, locale: 'ar-TN-u-nu-latn' },
  IQD: { exponent: 3, locale: 'ar-IQ-u-nu-latn' },
  JPY: { exponent: 0, locale: 'ja-JP' },
  TRY: { exponent: 2, locale: 'tr-TR' },
};

/** Currencies Velnorix accepts. Adding one is a code change on purpose. */
export const SUPPORTED_CURRENCIES = Object.keys(CURRENCIES);

export function isSupportedCurrency(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, code);
}

export function currencyMeta(code: string): CurrencyMeta {
  const meta = CURRENCIES[code];
  if (!meta) {
    throw new ValidationError(
      `Unsupported currency "${code}". Supported: ${SUPPORTED_CURRENCIES.join(', ')}.`,
    );
  }
  return { code, ...meta };
}

export function currencyExponent(code: string): number {
  return currencyMeta(code).exponent;
}

function assertSafeInteger(amount: bigint, currency: string): number {
  if (amount > BigInt(Number.MAX_SAFE_INTEGER) || amount < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new ValidationError(`Amount in ${currency} exceeds the safe integer range.`);
  }
  return Number(amount);
}

/** Builds Money from an integer number of minor units. */
export function money(amount: number, currency: string): Money {
  currencyMeta(currency);
  if (!Number.isInteger(amount)) {
    throw new ValidationError(
      `Money amounts must be integers in minor units (received ${amount} for ${currency}).`,
    );
  }
  if (!Number.isSafeInteger(amount)) {
    throw new ValidationError(`Money amount out of range for ${currency}: ${amount}.`);
  }
  return Object.freeze({ amount, currency });
}

export function zero(currency: string): Money {
  return money(0, currency);
}

/**
 * Parses a decimal string ("199.99") into Money.
 * Decimal strings only -- never pass the result of a float calculation here.
 */
export function fromDecimal(value: string | number, currency: string): Money {
  const exponent = currencyExponent(currency);
  const raw = typeof value === 'number' ? value.toString() : value.trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) {
    throw new ValidationError(`"${raw}" is not a valid decimal amount for ${currency}.`);
  }

  const sign = match[1] ? -1n : 1n;
  const whole = BigInt(match[2] ?? '0');
  let fraction = match[3] ?? '';

  if (fraction.length > exponent) {
    const discarded = fraction.slice(exponent);
    if (/[1-9]/.test(discarded)) {
      throw new ValidationError(
        `"${raw}" has more precision than ${currency} supports (${exponent} decimals).`,
      );
    }
    fraction = fraction.slice(0, exponent);
  }

  const minorUnits =
    sign * (whole * 10n ** BigInt(exponent) + BigInt(fraction.padEnd(exponent, '0') || '0'));
  return money(assertSafeInteger(minorUnits, currency), currency);
}

/** "199.99" (no currency symbol, always uses `.`). */
export function toDecimal(value: Money): string {
  const exponent = currencyExponent(value.currency);
  const negative = value.amount < 0;
  const digits = BigInt(Math.abs(value.amount))
    .toString()
    .padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${negative ? '-' : ''}${whole}${exponent > 0 ? `.${fraction}` : ''}`;
}

/** Localised display string, e.g. "ج.م. ١٩٩٫٩٩" or "EGP 199.99". */
export function formatMoney(value: Money, locale?: string): string {
  const meta = currencyMeta(value.currency);
  return new Intl.NumberFormat(locale ?? meta.locale, {
    style: 'currency',
    currency: value.currency,
    minimumFractionDigits: meta.exponent,
    maximumFractionDigits: meta.exponent,
  }).format(Number(toDecimal(value)));
}

export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new ValidationError(`Cannot combine ${a.currency} with ${b.currency}.`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(assertSafeInteger(BigInt(a.amount) + BigInt(b.amount), a.currency), a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(assertSafeInteger(BigInt(a.amount) - BigInt(b.amount), a.currency), a.currency);
}

/** Multiplies by an integer quantity (line items, instalments, ...). */
export function multiply(value: Money, quantity: number): Money {
  if (!Number.isInteger(quantity)) {
    throw new ValidationError(`Quantity must be an integer (received ${quantity}).`);
  }
  const result = BigInt(value.amount) * BigInt(quantity);
  return money(assertSafeInteger(result, value.currency), value.currency);
}

export function negate(value: Money): Money {
  return money(-value.amount, value.currency);
}

export function compare(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return a.amount === b.amount ? 0 : a.amount < b.amount ? -1 : 1;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount;
}

export function isZero(value: Money): boolean {
  return value.amount === 0;
}

export function isPositive(value: Money): boolean {
  return value.amount > 0;
}

export function sum(values: readonly Money[], currency: string): Money {
  return values.reduce((total, value) => add(total, value), zero(currency));
}

export function min(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b;
}

export function max(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b;
}

export type RoundingMode = 'half-up' | 'half-even' | 'up' | 'down';

/**
 * Divides by `divisor` with an explicit rounding mode. `up`/`down` round away
 * from / towards zero, so they behave symmetrically for negative amounts.
 */
function divideRound(amount: bigint, divisor: bigint, mode: RoundingMode): bigint {
  if (divisor === 0n) throw new ValidationError('Division by zero.');
  const negative = amount < 0n !== divisor < 0n;
  const absAmount = amount < 0n ? -amount : amount;
  const absDivisor = divisor < 0n ? -divisor : divisor;
  const quotient = absAmount / absDivisor;
  const remainder = absAmount % absDivisor;

  let rounded = quotient;
  if (remainder !== 0n) {
    const twice = remainder * 2n;
    if (mode === 'up') rounded = quotient + 1n;
    else if (mode === 'down') rounded = quotient;
    else if (mode === 'half-up') rounded = twice >= absDivisor ? quotient + 1n : quotient;
    else
      rounded =
        twice > absDivisor || (twice === absDivisor && quotient % 2n === 1n)
          ? quotient + 1n
          : quotient;
  }
  return negative ? -rounded : rounded;
}

/**
 * Applies a rate expressed in basis points (100 bps = 1%).
 * Used for platform transaction fees and tax rates.
 */
export function applyRate(
  value: Money,
  basisPoints: number,
  mode: RoundingMode = 'half-up',
): Money {
  if (!Number.isInteger(basisPoints)) {
    throw new ValidationError('Rates must be expressed as integer basis points.');
  }
  const scaled = BigInt(value.amount) * BigInt(basisPoints);
  return money(
    assertSafeInteger(divideRound(scaled, 10_000n, mode), value.currency),
    value.currency,
  );
}

/**
 * Splits money across `weights` without losing a single minor unit
 * (largest-remainder method). Leftover minor units go to the first shares.
 */
export function allocate(value: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) throw new ValidationError('Cannot allocate across zero shares.');
  if (weights.some((weight) => !Number.isInteger(weight) || weight < 0)) {
    throw new ValidationError('Allocation weights must be non-negative integers.');
  }

  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  if (totalWeight === 0)
    throw new ValidationError('Total allocation weight must be greater than zero.');

  const amount = BigInt(value.amount);
  const total = BigInt(totalWeight);
  const base = weights.map((weight) => (amount * BigInt(weight)) / total);
  const distributed = base.reduce((acc, part) => acc + part, 0n);
  let leftover = amount - distributed;

  const shares = base.map((part) => part);
  let index = 0;
  while (leftover > 0n && shares.length > 0) {
    shares[index % shares.length] = (shares[index % shares.length] ?? 0n) + 1n;
    leftover -= 1n;
    index += 1;
  }

  return shares.map((share) => money(assertSafeInteger(share, value.currency), value.currency));
}
