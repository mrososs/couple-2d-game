import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';

export type GameClient = SupabaseClient<Database>;

/** The Supabase project to play online with: its URL and publishable (client) key. */
export interface OnlineConfig {
  readonly url: string;
  readonly publishableKey: string;
}

/**
 * Reads the project from the environment, or null when none is configured (online play is then
 * off). Each build fills these in its own way: Expo inlines `EXPO_PUBLIC_*` when it bundles, Vite
 * through `define` in vite.config.mts, and the integration tests from .env.local. Only the
 * publishable key ever belongs here; row level security is what protects the data.
 */
export function onlineConfigFromEnv(): OnlineConfig | null {
  // Written out in full: Expo only inlines the literal `process.env.EXPO_PUBLIC_…` expression.
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && publishableKey ? { url, publishableKey } : null;
}

/** Where the player's session is kept between launches (AsyncStorage's shape fits). */
export interface AuthStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export interface GameClientOptions {
  /** Defaults to the page's localStorage where there is one. */
  readonly storage?: AuthStorage;
  /** False keeps the session in memory only, as the integration tests do for their players. */
  readonly persistSession?: boolean;
}

export function createGameClient(config: OnlineConfig, options: GameClientOptions = {}): GameClient {
  return createClient<Database>(config.url, config.publishableKey, {
    auth: {
      storage: options.storage,
      persistSession: options.persistSession ?? true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}
