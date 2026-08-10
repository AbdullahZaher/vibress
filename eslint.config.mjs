import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nxEslintPlugin from '@nx/eslint-plugin';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { '@nx': nxEslintPlugin },
  },
  {
    ignores: ['**/dist/**', '**/build/**', '**/.next/**', '**/coverage/**', '**/out/**', '**/*.js', '**/*.mjs', '**/*.cjs', '**/*.d.ts', 'references/**'],
  },
  {
    languageOptions: {
      globals: {
        process: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Baseline: typescript-eslint 8.x recommended now flags legacy `any`
      // usages that shipped across Batches 1-13. Keep the rule available but
      // match the historical behavior; new code must avoid `any` where
      // practical (enforced by review and tests).
      '@typescript-eslint/no-explicit-any': 'off',
      '@nx/enforce-module-boundaries': [
        'error',
        {
          allow: [],
          depConstraints: [
            { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['type:domain', 'type:platform'] },
            { sourceTag: 'type:domain', onlyDependOnLibsWithTags: ['type:domain', 'type:platform'] },
            { sourceTag: 'type:platform', onlyDependOnLibsWithTags: ['type:platform'] }
          ]
        }
      ],
    },
  }
);
