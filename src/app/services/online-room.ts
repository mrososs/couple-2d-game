import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AppState } from '@ng-native/device';
import type { CharacterId, LevelId } from '../../game/bridge/protocol.ts';
import type { Json } from '../../online/database.types.ts';
import type { MotionState } from '../../online/motion.ts';
import {
  formatOnlineCode,
  OnlineError,
  toOnlineError,
  type LevelCompletion,
  type LevelStart,
  type OnlineErrorKey,
  type PlayerBroadcast,
  type PresenceMeta,
  type PuzzleResult,
  type RoomPlayer,
  type RoomSeat,
  type RoomSnapshot,
  type SharedLevelState,
  type SyncEvent,
} from '../../online/protocol.ts';
import { RoomChannel, type ChannelStatus, type SendResult } from '../../online/room-channel.ts';
import * as api from '../../online/rooms-api.ts';
import { Online, OnlineSession } from './online.ts';

export type OnlineRoomStatus = ChannelStatus | 'idle';

/**
 * A room on the server, for two phones anywhere with internet. Holds what the screens and the
 * game need as signals: the seat, who sits in the room and who is connected, and the shared level
 * state with its version, kept current from the server's announcements. When the app comes back
 * from the background it catches up from the server, since announcements sent while it was away
 * are gone.
 */
@Injectable({ providedIn: 'root' })
export class OnlineRoom {
  private readonly online = inject(Online);
  private readonly session = inject(OnlineSession);
  private channel: RoomChannel | null = null;
  private readonly listeners = new Set<(message: PlayerBroadcast) => void>();

  readonly seat = signal<RoomSeat | null>(null);
  readonly status = signal<OnlineRoomStatus>('idle');
  readonly error = signal<OnlineErrorKey | null>(null);
  /** The players seated in the room, by the server. */
  readonly players = signal<readonly RoomPlayer[]>([]);
  /** The players connected right now, by Presence. */
  readonly connected = signal<readonly PresenceMeta[]>([]);
  readonly levelId = signal<LevelId | null>(null);
  readonly shared = signal<SharedLevelState | null>(null);
  readonly version = signal(0);
  /** The newest announcement, for screens that react to one (a puzzle solved, a level completed). */
  readonly lastSync = signal<SyncEvent | null>(null);

  readonly code = computed(() => {
    const seat = this.seat();
    return seat ? formatOnlineCode(seat.code) : null;
  });
  readonly partner = computed(() => this.players().find((p) => p.slot !== this.seat()?.slot) ?? null);
  readonly partnerOnline = computed(() => this.connected().some((p) => p.slot !== this.seat()?.slot));
  /** Slot 1 opened the room and plays the character they chose; slot 2 plays the other one. */
  readonly me = computed<CharacterId | null>(() => {
    const seat = this.seat();
    if (!seat) return null;
    const host = this.players().find((p) => p.slot === 1)?.avatar_character ?? 'wife';
    return seat.slot === 1 ? host : host === 'wife' ? 'husband' : 'wife';
  });

  constructor() {
    const appState = inject(AppState);
    effect(() => {
      if (appState.active()) untracked(() => void this.channel?.resync().catch(() => undefined));
    });
    inject(DestroyRef).onDestroy(() => void this.close());
  }

  get available(): boolean {
    return this.online.available;
  }

  /** Opens a room for this couple and joins its channel. */
  create(): Promise<RoomSeat> {
    return this.attempt(async () => {
      await this.session.ensureSignedIn();
      return this.enter(await api.createRoom(this.online.client));
    });
  }

  /** Takes a seat in the room with this code and joins its channel. */
  join(code: string): Promise<RoomSeat> {
    return this.attempt(async () => {
      await this.session.ensureSignedIn();
      return this.enter(await api.joinRoom(this.online.client, code));
    });
  }

  async leave(): Promise<void> {
    const seat = this.seat();
    await this.close();
    if (seat) await api.leaveRoom(this.online.client, seat.room_id).catch(() => undefined);
  }

  startLevel(levelId: LevelId, restart = false): Promise<LevelStart> {
    return this.attempt(() => api.startLevel(this.online.client, this.roomId(), levelId, restart));
  }

  /** This player's part of a shared puzzle; the server decides, and announces the outcome to both. */
  submitPart(puzzle: string, value: Json = true): Promise<PuzzleResult> {
    return this.attempt(() => api.submitPuzzlePart(this.online.client, this.roomId(), puzzle, value));
  }

  completeLevel(levelId: LevelId): Promise<LevelCompletion> {
    return this.attempt(() => api.completeLevel(this.online.client, this.roomId(), levelId));
  }

  /** Sends to the partner (an intention, an effect). Never counts for anything on the server. */
  send(message: PlayerBroadcast): Promise<SendResult> {
    return this.channel?.send(message) ?? Promise.resolve('error');
  }

  /** Call every frame with this player's movement; it goes out at most 15 times a second. */
  updateMotion(state: MotionState, now?: number): void {
    this.channel?.updateMotion(state, now);
  }

  /** Listens to the partner's broadcasts; returns a function that stops listening. */
  onBroadcast(listener: (message: PlayerBroadcast) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private roomId(): string {
    const seat = this.seat();
    if (!seat) throw new OnlineError('not_in_room');
    return seat.room_id;
  }

  private async enter(seat: RoomSeat): Promise<RoomSeat> {
    await this.close();
    this.seat.set(seat);
    this.status.set('connecting');
    const channel = new RoomChannel(
      this.online.client,
      seat.room_id,
      { user_id: this.session.userId()!, slot: seat.slot, character: null, online_at: new Date().toISOString() },
      {
        onStatus: (status) => this.status.set(status),
        onPresence: (players) => this.connected.set(players),
        onResync: (snapshot) => this.apply(snapshot),
        onSync: (event) => this.announce(event),
        onBroadcast: (message) => this.listeners.forEach((listener) => listener(message)),
      },
    );
    this.channel = channel;
    await channel.open();
    return seat;
  }

  private apply(snapshot: RoomSnapshot): void {
    this.players.set(snapshot.players);
    if (snapshot.state) {
      this.levelId.set(snapshot.state.level_id);
      this.shared.set(snapshot.state.state);
      this.version.set(snapshot.state.version);
    }
  }

  private announce(event: SyncEvent): void {
    this.lastSync.set(event);
    if (event.event === 'members') {
      // Seats changed: the snapshot has the new players' names and looks.
      void this.channel?.resync().catch(() => undefined);
      return;
    }
    this.version.set(event.payload.version);
    if (event.event === 'level') this.levelId.set(event.payload.level_id);
    // Announcements say what changed; the state itself comes from the server, never from a guess.
    void this.channel?.resync().catch(() => undefined);
  }

  private async close(): Promise<void> {
    const channel = this.channel;
    this.channel = null;
    await channel?.close();
    this.seat.set(null);
    this.players.set([]);
    this.connected.set([]);
    this.shared.set(null);
    this.levelId.set(null);
    this.status.set('idle');
  }

  private async attempt<T>(work: () => Promise<T>): Promise<T> {
    try {
      const result = await work();
      this.error.set(null);
      return result;
    } catch (e) {
      const error = e instanceof OnlineError ? e : toOnlineError({ message: (e as Error)?.message });
      this.error.set(error.key);
      throw error;
    }
  }
}
