import { describe, expect, it } from 'vitest';
import {
  allocate,
  applyRate,
  fromDecimal,
  money,
  sum,
  toDecimal,
  subtract,
  equals,
  formatMoney,
  add,
} from '../src/money.js';
import { ValidationError } from '../src/errors.js';

describe('money', () => {
  it('stores integer minor units only', () => {
    expect(() => money(10.5, 'EGP')).toThrow(ValidationError);
    expect(money(1050, 'EGP')).toEqual({ amount: 1050, currency: 'EGP' });
  });

  it('rejects unknown currencies instead of guessing an exponent', () => {
    expect(() => money(100, 'XYZ')).toThrow(/Unsupported currency/);
  });

  it('respects each currency decimal exponent', () => {
    expect(fromDecimal('10.5', 'EGP').amount).toBe(1050);
    expect(fromDecimal('10.5', 'KWD').amount).toBe(10500);
    expect(fromDecimal('10500', 'JPY').amount).toBe(10500);
    expect(toDecimal(fromDecimal('1.234', 'KWD'))).toBe('1.234');
    expect(toDecimal(money(1050, 'JPY'))).toBe('1050');
  });

  it('rejects amounts with more precision than the currency supports', () => {
    expect(() => fromDecimal('10.999', 'EGP')).toThrow(/more precision/);
    expect(fromDecimal('10.9900', 'EGP').amount).toBe(1099);
  });

  it('rejects malformed decimal strings', () => {
    expect(() => fromDecimal('1,234.50', 'EGP')).toThrow(ValidationError);
    expect(() => fromDecimal('', 'EGP')).toThrow(ValidationError);
    expect(() => fromDecimal('abc', 'EGP')).toThrow(ValidationError);
  });

  it('adds, subtracts and sums without float drift', () => {
    const a = fromDecimal('0.1', 'EGP');
    const b = fromDecimal('0.2', 'EGP');
    expect(equals(add(a, b), fromDecimal('0.3', 'EGP'))).toBe(true);
    expect(sum([a, b, a], 'EGP').amount).toBe(40);
    expect(subtract(fromDecimal('1.00', 'EGP'), fromDecimal('0.01', 'EGP')).amount).toBe(99);
  });

  it('refuses to combine different currencies', () => {
    expect(() => add(money(100, 'EGP'), money(100, 'USD'))).toThrow(/Cannot combine/);
  });

  describe('applyRate', () => {
    it('charges 2.5% with half-up rounding', () => {
      expect(applyRate(money(10_000, 'EGP'), 250).amount).toBe(250); // 250.00
      expect(applyRate(money(100, 'EGP'), 250).amount).toBe(3); //    2.50 -> 3
      expect(applyRate(money(10, 'EGP'), 250).amount).toBe(0); //     0.25 -> 0
      expect(applyRate(money(20, 'EGP'), 250).amount).toBe(1); //     0.50 -> 1 (half up)
      expect(applyRate(money(30, 'EGP'), 250).amount).toBe(1); //     0.75 -> 1
    });

    it('rounds half-even mode deterministically', () => {
      expect(applyRate(money(20, 'EGP'), 250, 'half-even').amount).toBe(0); // 0.5 -> even (0)
      expect(applyRate(money(60, 'EGP'), 250, 'half-even').amount).toBe(2); // 1.5 -> even (2)
      expect(applyRate(money(20, 'EGP'), 250, 'half-up').amount).toBe(1);
    });

    it('rounds symmetric negative amounts away from zero with mode "up"', () => {
      expect(applyRate(money(-2, 'EGP'), 250, 'up').amount).toBe(-1);
      expect(applyRate(money(2, 'EGP'), 250, 'up').amount).toBe(1);
      expect(applyRate(money(2, 'EGP'), 250, 'down').amount).toBe(0);
    });

    it('supports 0% fees', () => {
      expect(applyRate(money(10_000, 'EGP'), 0).amount).toBe(0);
    });

    it('rejects fractional basis points', () => {
      expect(() => applyRate(money(100, 'EGP'), 2.5)).toThrow(ValidationError);
    });
  });

  describe('allocate', () => {
    it('splits without losing a single minor unit', () => {
      const parts = allocate(money(1000, 'EGP'), [1, 1, 1]);
      expect(parts.map((p) => p.amount)).toEqual([334, 333, 333]);
      expect(parts.reduce((total, part) => total + part.amount, 0)).toBe(1000);
    });

    it('handles uneven weights', () => {
      const parts = allocate(money(100, 'EGP'), [7, 3]);
      expect(parts.map((p) => p.amount)).toEqual([70, 30]);
    });

    it('handles a single share and rejects empty/zero weights', () => {
      expect(allocate(money(99, 'EGP'), [1])[0]?.amount).toBe(99);
      expect(() => allocate(money(99, 'EGP'), [])).toThrow(ValidationError);
      expect(() => allocate(money(99, 'EGP'), [0, 0])).toThrow(ValidationError);
    });
  });

  it('formats for the Egyptian market', () => {
    const formatted = formatMoney(money(199_99, 'EGP'));
    expect(formatted.replace(/\s/g, ' ')).toMatch(/199/);
  });
});
