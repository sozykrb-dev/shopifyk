import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import { baseConfig } from './base.mjs';

/**
 * Flat config for the Next.js apps: the shared base config plus React, hooks
 * and Next-specific rules.
 *
 * The plugins are registered for every file (not only `*.tsx`) so that
 * `next build` can see them when it inspects the config file itself.
 */
export default [
  {
    ignores: [...(baseConfig[0]?.ignores ?? [])],
  },
  js.configs.recommended,
  ...baseConfig.slice(1),
  {
    plugins: { react, 'react-hooks': reactHooks, '@next/next': nextPlugin },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: { react: { version: 'detect' } },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/jsx-curly-brace-presence': ['warn', { props: 'never', children: 'never' }],
      // A dropped `await` is how a failed payment silently becomes a successful
      // one, so floating promises stay an error everywhere except JSX
      // attributes, where `onClick={async () => ...}` is idiomatic.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
];
