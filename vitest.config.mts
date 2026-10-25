import { ngNative } from '@ng-native/testing/vitest';
import { configDefaults, defineConfig } from 'vitest/config';

// Compiles Angular for the tests the way Metro compiles it for the app. Tests run in Node against
// a fake of the native side: no simulator, no device. The Supabase integration tests have a
// config of their own (vitest.supabase.config.mts) and stay out of this run.
export default defineConfig({
  plugins: [ngNative()],
  test: {
    exclude: [...configDefaults.exclude, 'tests/supabase/**'],
  },
});
