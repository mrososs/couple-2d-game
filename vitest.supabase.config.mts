import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Integration tests against the hosted Supabase development project (see tests/supabase). They
// need the network and EXPO_PUBLIC_SUPABASE_* in .env.local, so `npm test` leaves them out; run
// them with `npm run test:supabase`, which also removes the test players afterwards.
export default defineConfig(({ mode }) => ({
  test: {
    include: ['tests/supabase/**/*.test.ts'],
    environment: 'node',
    env: loadEnv(mode, process.cwd(), 'EXPO_PUBLIC_'),
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
}));
