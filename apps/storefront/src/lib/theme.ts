/**
 * Per-store theming.
 *
 * A store picks one accent colour; the design system reads it as an HSL
 * triplet on `--primary` so every token derived from it (ring, hover, ...)
 * follows automatically.
 */

export const DEFAULT_PRIMARY = '174 72% 26%';

/**
 * Converts `#0f766e` (or `0f766e`) into `174 72% 26%`.
 *
 * Falls back to the platform default for anything unparseable: a bad value in
 * the database must not break the storefront.
 */
export function hexToHslTriplet(hex: string): string {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!match) return DEFAULT_PRIMARY;

  const channels = [1, 2, 3].map((index) => parseInt(match[index] ?? '0', 16) / 255);
  const [r, g, b] = [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = Math.round(hue * 60);
    if (hue < 0) hue += 360;
  }

  return `${hue} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
}

/** Inline style that applies a store's accent colour, or nothing. */
export function themeStyle(
  primaryColor: string | null | undefined,
): { '--primary': string } | undefined {
  if (!primaryColor) return undefined;
  return { '--primary': hexToHslTriplet(primaryColor) };
}
