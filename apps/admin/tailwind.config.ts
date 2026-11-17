import type { Config } from 'tailwindcss';
import sharedConfig from '@velnorix/ui/tailwind-preset';

export default {
  presets: [sharedConfig],
  content: ['./src/**/*.{ts,tsx}', '../../packages/design-system/src/**/*.{ts,tsx}'],
} satisfies Config;
