import { Injectable, computed, inject, signal } from '@angular/core';
import type { LevelId } from '../../game/bridge/protocol.ts';
import { OnlineError, toOnlineError, type CoupleLevel, type OnlineErrorKey } from '../../online/protocol.ts';
import { getCoupleLevels } from '../../online/rooms-api.ts';
import { Online, OnlineSession } from './online.ts';

/**
 * The couple's progress as the server keeps it. Levels are completed and opened only by the
 * server (complete_level), so this is read-only: the app refreshes it after a level and when the
 * level screen opens. The phone's own Progress stays the offline record.
 */
@Injectable({ providedIn: 'root' })
export class CloudProgress {
  private readonly online = inject(Online);
  private readonly session = inject(OnlineSession);

  readonly levels = signal<readonly CoupleLevel[]>([]);
  readonly error = signal<OnlineErrorKey | null>(null);
  readonly unlocked = computed(() => new Set<LevelId>(this.levels().filter((l) => l.unlocked).map((l) => l.level_id)));
  readonly stars = computed(() => this.levels().reduce((sum, l) => sum + (l.stars ?? 0), 0));

  async refresh(): Promise<readonly CoupleLevel[]> {
    try {
      await this.session.ensureSignedIn();
      const levels = await getCoupleLevels(this.online.client);
      this.levels.set(levels);
      this.error.set(null);
      return levels;
    } catch (e) {
      const error = e instanceof OnlineError ? e : toOnlineError({ message: (e as Error)?.message });
      this.error.set(error.key);
      throw error;
    }
  }
}
