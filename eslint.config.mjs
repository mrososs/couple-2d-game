import ngNative from '@ng-native/eslint-plugin';
import tseslint from 'typescript-eslint';

/**
 * Two kinds of code live here. `src/app` is native (NG Native on Fabric: no DOM), checked by
 * NG Native's rules for things that compile but do nothing on a device. `src/game`, `src/web` and
 * `src/web-host` run in a browser engine (the game page in its web view, and the browser host),
 * where the DOM is the point, so they get TypeScript's recommended rules only.
 */
export default tseslint.config(
  { ignores: ['.expo/', 'ios/', 'android/', 'dist/', 'dist-web/', 'node_modules/', 'scripts/', '**/*.d.ts'] },
  {
    files: ['src/**/*.ts', '*.mts'],
    extends: [tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  ...ngNative.configs.recommended.map((config) => ({
    ...config,
    files: (config.files ?? ['**/*.ts']).map((pattern) => `src/app/${pattern.replace(/^\*\*\//, '**/')}`),
  })),
);
