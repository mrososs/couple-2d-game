import { Injectable, computed, inject } from '@angular/core';
import type { CharacterId, LevelId, LevelResult } from '../../game/bridge/protocol.ts';
import { KEY_VALUE_STORE } from './kv-store.ts';
import { applyResult, DEFAULT_SAVE, isUnlocked, normalizeSave, totalStars, type AppSettings, type Profile, type SaveData } from './progress-rules.ts';

/**
 * ProgressManager: the one saved document (profile, settings, level records), owned by the native
 * app and persisted through the platform's key-value store. The game page never writes it; it only
 * reports results, which arrive here over the bridge.
 */
@Injectable({ providedIn: 'root' })
export class Progress {
  private readonly store = inject(KEY_VALUE_STORE);
  private readonly raw = this.store.signal<SaveData>('bwbt.save.v1', DEFAULT_SAVE);

  /** False until the stored save has been read back on startup. */
  readonly ready = this.store.ready;
  readonly save = computed(() => normalizeSave(this.raw()));
  readonly profile = computed(() => this.save().profile);
  readonly settings = computed(() => this.save().settings);
  readonly stars = computed(() => totalStars(this.save()));

  isUnlocked(id: LevelId): boolean {
    return isUnlocked(this.save(), id);
  }

  record(id: LevelId) {
    return this.save().records[id];
  }

  /** Saves a finished level (once, however often it arrives) and returns the level it unlocked. */
  recordResult(result: LevelResult): LevelId | null {
    const { save, unlocked, duplicate } = applyResult(this.save(), result);
    if (duplicate) return null;
    this.raw.set(save);
    void this.store.flush().catch(() => undefined);
    return unlocked;
  }

  /** Whether this result was already saved on this phone. */
  hasResult(id: string): boolean {
    return this.save().savedResults.includes(id);
  }

  updateProfile(change: Partial<Profile>): void {
    this.raw.set({ ...this.save(), profile: { ...this.profile(), ...change } });
  }

  setName(id: CharacterId, name: string): void {
    this.updateProfile({ names: { ...this.profile().names, [id]: name } });
  }

  setOutfit(id: CharacterId, outfit: number): void {
    this.updateProfile({ outfits: { ...this.profile().outfits, [id]: outfit } });
  }

  updateSettings(change: Partial<AppSettings>): void {
    this.raw.set({ ...this.save(), settings: { ...this.settings(), ...change } });
  }

  markOnboarded(): void {
    if (!this.save().onboarded) this.raw.set({ ...this.save(), onboarded: true });
  }

  resetProgress(): void {
    this.raw.set({ ...this.save(), records: {} });
  }
}
