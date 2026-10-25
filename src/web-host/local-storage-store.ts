import { signal, type WritableSignal } from '@angular/core';
import type { KeyValueStore } from '../app/services/kv-store.ts';

/** The browser host's store, over localStorage, which persists there. */
export class LocalStorageStore implements KeyValueStore {
  readonly ready = signal(true).asReadonly();
  private readonly signals = new Map<string, WritableSignal<unknown>>();

  /** A prefix keeps two "phones" apart when two tabs of one browser play together. */
  constructor(private readonly prefix = '') {}

  signal<T>(key: string, initial: T): WritableSignal<T> {
    const existing = this.signals.get(key);
    if (existing) return existing as WritableSignal<T>;
    let value = initial;
    try {
      const raw = localStorage.getItem(this.prefix + key);
      if (raw !== null) value = JSON.parse(raw) as T;
    } catch {
      value = initial;
    }
    const s = signal<T>(value);
    const write = (next: T) => {
      try {
        localStorage.setItem(this.prefix + key, JSON.stringify(next));
      } catch {
        // Private mode or a full quota: the game still plays, it just won't remember.
      }
    };
    const set = s.set.bind(s);
    s.set = (next: T) => {
      set(next);
      write(next);
    };
    s.update = (fn: (v: T) => T) => s.set(fn(s()));
    this.signals.set(key, s as WritableSignal<unknown>);
    return s;
  }

  async flush(): Promise<void> {}
}
