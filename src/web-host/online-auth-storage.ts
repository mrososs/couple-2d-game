import type { AuthStorage } from '../online/client.ts';

/**
 * The browser host's place for the online session: localStorage, under a prefix, so two tabs
 * playing as two phones (`?profile=a`, `?profile=b`) are two different players.
 */
export function onlineAuthStorage(prefix: string): AuthStorage {
  return {
    getItem: (key) => localStorage.getItem(prefix + key),
    setItem: (key, value) => localStorage.setItem(prefix + key, value),
    removeItem: (key) => localStorage.removeItem(prefix + key),
  };
}
