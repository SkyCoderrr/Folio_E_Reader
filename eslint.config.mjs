import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
import hooks from 'eslint-plugin-react-hooks';
import refresh from 'eslint-plugin-react-refresh';
export default ts.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'vendor/**',
      'src-tauri/**',
      'tmp/**',
      '.test-profile/**',
      'contract/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'vite.config.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': hooks, 'react-refresh': refresh },
    rules: {
      ...hooks.configs.recommended.rules,
      // Allow explicit safe initial values before guarded DOM access.
      'no-useless-assignment': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  { files: ['**/*.mjs'], languageOptions: { globals: globals.node } },
);
