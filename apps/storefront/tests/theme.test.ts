import { describe, expect, it } from 'vitest';
import { DEFAULT_PRIMARY, hexToHslTriplet, themeStyle } from '../src/lib/theme.js';

describe('hexToHslTriplet', () => {
  it('converts the platform teal', () => {
    expect(hexToHslTriplet('#0f766e')).toBe('175 77% 26%');
  });

  it('accepts a colour without the leading hash', () => {
    expect(hexToHslTriplet('0f766e')).toBe('175 77% 26%');
  });

  it('is case insensitive and tolerates surrounding space', () => {
    expect(hexToHslTriplet('  #0F766E ')).toBe('175 77% 26%');
  });

  it('converts primaries and greys', () => {
    expect(hexToHslTriplet('#ff0000')).toBe('0 100% 50%');
    expect(hexToHslTriplet('#00ff00')).toBe('120 100% 50%');
    expect(hexToHslTriplet('#0000ff')).toBe('240 100% 50%');
    // Achromatic colours have no hue and no saturation.
    expect(hexToHslTriplet('#000000')).toBe('0 0% 0%');
    expect(hexToHslTriplet('#ffffff')).toBe('0 0% 100%');
  });

  it('falls back to the platform default token instead of emitting garbage', () => {
    expect(hexToHslTriplet('')).toBe(DEFAULT_PRIMARY);
    expect(hexToHslTriplet('#fff')).toBe(DEFAULT_PRIMARY);
    expect(hexToHslTriplet('rebeccapurple')).toBe(DEFAULT_PRIMARY);
    expect(hexToHslTriplet('#zzzzzz')).toBe(DEFAULT_PRIMARY);
  });
});

describe('themeStyle', () => {
  it('applies a store accent colour', () => {
    expect(themeStyle('#0f766e')).toEqual({ '--primary': '175 77% 26%' });
  });

  it('applies nothing when the store has no accent colour', () => {
    expect(themeStyle(null)).toBeUndefined();
    expect(themeStyle(undefined)).toBeUndefined();
    expect(themeStyle('')).toBeUndefined();
  });
});
