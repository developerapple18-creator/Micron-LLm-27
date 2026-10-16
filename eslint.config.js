import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'tmp/**',
      '.pnpm-store/**',
      '.conversation/**',
      'generated-artifacts/**',
      '**/test-artifacts/**',
      '**/generated/**',
      '**/.generated/**',
    ],
  },
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-dupe-args': 'error',
      'no-dupe-keys': 'error',
      'no-constant-binary-expression': 'error',
      'no-unsafe-finally': 'error',
    },
  },
];
