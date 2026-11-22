import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/public/**',
      '**/.expo/**',
      '**/.swc/**',
      '**/src-tauri/**',
      '.omp/**',
      '.trellis/**',
      '.worktrees/**',
      '.agents/**',
      '.codex/**',
      // e2e/ is a manual, Docker-dependent verification runner —
      // deliberately outside the root lint/typecheck/test gates (see
      // e2e/README.md; task 09-22-e2e-sync-roundtrip).
      'e2e/**',
      'server/deploy/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-console': 'error',
      'no-debugger': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // server/app runs under Node; declare its globals (no unpinned `globals` dep)
    files: ['server/app/**/*.ts'],
    languageOptions: {
      globals: {
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        performance: 'readonly',
      },
    },
  },
  {
    // logger modules are the sanctioned console wrappers (spec: only logging
    // path). The server has its own (Rule 1: it cannot import core's).
    // init-db.ts is a CLI setup script with direct terminal output.
    files: ['packages/core/src/lib/logger.ts', 'server/app/src/logger.ts', 'server/app/src/init-db.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Repo-owned CommonJS tooling/config files (metro/babel/jest/tailwind +
    // jest mocks/plugins): declare node globals + allow require (they are
    // CJS, not ESM).
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // ESM tooling/config files (jest/eslint/prettier .mjs): node globals.
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
      },
    },
  },
  // must be last: turns off rules that conflict with Prettier
  prettier,
);
