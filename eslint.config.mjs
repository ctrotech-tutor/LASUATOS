import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '**/.next/**',
    '**/node_modules/**',
    '**/drizzle/migrations/**',
    '**/coverage/**',
    '**/dist/**',
    // Vendored, minified browser assets copied in by scripts/copy-*-assets.mjs (git-ignored).
    'apps/web/public/pdf/**',
    'apps/web/public/face/wasm-*/**',
  ]),
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Video tooling: the .js storyboard runs in the page; the .mjs drivers run
    // in Node but evaluate code in the browser (page.evaluate), so both sets of
    // globals appear.
    files: ['tools/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
  },
]);
