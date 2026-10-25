import { InjectionToken, signal, type Signal, type WritableSignal } from '@angular/core';

/**
 * Where the app keeps what must survive a restart. On a phone this is `@ng-native/expo`'s
 * `Storage` (AsyncStorage on disk, owned by the native app - the game's web view only has an
 * in-memory localStorage on Android). In the browser host it is the page's own localStorage. Both
 * have the same shape: a key bound to a signal that writes through when set.
 */
export interface KeyValueStore {
  signal<T>(key: string, initial: T): WritableSignal<T>;
  readonly ready: Signal<boolean>;
  flush(): Promise<void>;
}

export const KEY_VALUE_STORE = new InjectionToken<KeyValueStore>('bwbt.keyValueStore');

/** A store for tests: values live in a map, as JSON text, like the native store's strings. */
export class MemoryStore implements KeyValueStore {
  readonly ready = signal(true).asReadonly();
  private readonly map = new Map<string, string>();
  private readonly signals = new Map<string, WritableSignal<unknown>>();

  constructor(seed: Record<string, unknown> = {}) {
    for (const [k, v] of Object.entries(seed)) this.map.set(k, JSON.stringify(v));
  }

  signal<T>(key: string, initial: T): WritableSignal<T> {
    const existing = this.signals.get(key);
    if (existing) return existing as WritableSignal<T>;
    const raw = this.map.get(key);
    const s = signal<T>(raw === undefined ? initial : (JSON.parse(raw) as T));
    const set = s.set.bind(s);
    s.set = (next: T) => {
      set(next);
      this.map.set(key, JSON.stringify(next));
    };
    s.update = (fn: (v: T) => T) => s.set(fn(s()));
    this.signals.set(key, s as WritableSignal<unknown>);
    return s;
  }

  async flush(): Promise<void> {}

  raw(key: string): unknown {
    const raw = this.map.get(key);
    return raw === undefined ? undefined : JSON.parse(raw);
  }
}
