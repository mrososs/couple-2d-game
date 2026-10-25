import type { RealtimeChannel, RealtimeChannelSendResponse } from '@supabase/supabase-js';
import type { GameClient } from './client.ts';
import { MotionThrottle, type MotionState } from './motion.ts';
import {
  OnlineError,
  PLAYER_BROADCAST_EVENTS,
  roomTopic,
  SYNC_EVENTS,
  syncTopic,
  type PlayerBroadcast,
  type PresenceMeta,
  type RoomSnapshot,
  type SyncEvent,
} from './protocol.ts';
import { getRoomSnapshot } from './rooms-api.ts';

export type ChannelStatus = 'connecting' | 'live' | 'reconnecting' | 'denied' | 'closed';
/** 'ok' once Realtime has acknowledged the message; 'timed out' or 'error' otherwise. */
export type SendResult = RealtimeChannelSendResponse;

export interface RoomChannelHandlers {
  /** A partner's movement, intention or effect: smooth it, show it, never trust it. */
  readonly onBroadcast?: (message: PlayerBroadcast) => void;
  /** An authoritative change, announced by the server, newer than anything seen before. */
  readonly onSync?: (event: SyncEvent) => void;
  /** Who is connected to the room right now. */
  readonly onPresence?: (players: readonly PresenceMeta[]) => void;
  /** The whole authoritative state, after joining and after every reconnection. */
  readonly onResync?: (snapshot: RoomSnapshot) => void;
  readonly onStatus?: (status: ChannelStatus) => void;
}

/**
 * A player's connection to a room's two private Realtime topics (see protocol.ts): the players'
 * own traffic and Presence on `room:<id>`, and the server's announcements on `room-sync:<id>`.
 *
 * Nothing that matters is decided here. A broadcast from the partner is shown but never counted:
 * shared puzzles and progress go through the game functions, whose result the server announces.
 * Announcements carry the state version; an old one is dropped, and a gap (one missed while
 * offline) triggers a fresh snapshot. Every (re)subscription refetches that snapshot, which is
 * how a returning player catches up. One RoomChannel per room per client: opening one removes any
 * channel the client still holds on the same topics, so subscriptions never double up.
 */
export class RoomChannel {
  private play: RealtimeChannel | null = null;
  private sync: RealtimeChannel | null = null;
  private seen = 0;
  private closed = false;
  private status: ChannelStatus = 'connecting';
  private readonly throttle: MotionThrottle;

  constructor(
    private readonly client: GameClient,
    readonly roomId: string,
    private readonly me: PresenceMeta,
    private readonly handlers: RoomChannelHandlers = {},
  ) {
    this.throttle = new MotionThrottle((payload) => void this.send({ event: 'move', payload }));
  }

  /** The newest state version this player has. */
  get version(): number {
    return this.seen;
  }

  /**
   * Subscribes to both topics, announces this player through Presence, and catches up. Fails with
   * `not_in_room` as soon as Realtime refuses the player (not seated in the room), and with
   * `network` when the channels are not up within `timeoutMs`.
   */
  async open(timeoutMs = 10_000): Promise<RoomSnapshot> {
    // Private channels authorise with the player's own access token.
    await this.client.realtime.setAuth();
    for (const topic of [roomTopic(this.roomId), syncTopic(this.roomId)]) {
      for (const existing of this.client.getChannels()) {
        if (existing.topic === `realtime:${topic}`) await this.client.removeChannel(existing);
      }
    }

    const sync = this.client.channel(syncTopic(this.roomId), { config: { private: true } });
    for (const event of SYNC_EVENTS) {
      sync.on('broadcast', { event }, ({ payload }) => this.receive({ event, payload } as SyncEvent));
    }
    const play = this.client.channel(roomTopic(this.roomId), {
      config: { private: true, broadcast: { self: false, ack: true }, presence: { key: this.me.user_id } },
    });
    for (const event of PLAYER_BROADCAST_EVENTS) {
      play.on('broadcast', { event }, ({ payload }) => this.handlers.onBroadcast?.({ event, payload } as PlayerBroadcast));
    }
    play.on('presence', { event: 'sync' }, () => this.handlers.onPresence?.(this.presence()));
    this.sync = sync;
    this.play = play;

    try {
      await Promise.all([this.subscribe(sync, false, timeoutMs), this.subscribe(play, true, timeoutMs)]);
      return await this.resync();
    } catch (error) {
      // Not left half-open, retrying in the background.
      await this.close();
      throw error;
    }
  }

  /** Fetches the authoritative state: after a reconnection, or when the app returns to the foreground. */
  async resync(): Promise<RoomSnapshot> {
    const snapshot = await getRoomSnapshot(this.client, this.roomId);
    if (!snapshot) throw new OnlineError('not_in_room');
    if (snapshot.state) this.seen = Math.max(this.seen, snapshot.state.version);
    this.setStatus('live');
    this.handlers.onResync?.(snapshot);
    return snapshot;
  }

  /** Sends to the partner. Resolves when Realtime has acknowledged it. */
  async send(message: PlayerBroadcast): Promise<SendResult> {
    if (!this.play || this.closed) return 'error';
    return this.play.send({ type: 'broadcast', event: message.event, payload: message.payload });
  }

  /** Call every frame with this player's movement; at most 15 snapshots a second go out. */
  updateMotion(state: MotionState, now = Date.now()): void {
    if (this.status === 'live') this.throttle.update(state, now);
  }

  /** Who is connected, one entry per player. */
  presence(): PresenceMeta[] {
    const state = this.play?.presenceState<PresenceMeta>() ?? {};
    const players = new Map<string, PresenceMeta>();
    for (const metas of Object.values(state)) {
      for (const { user_id, slot, character, online_at } of metas) players.set(user_id, { user_id, slot, character, online_at });
    }
    return [...players.values()].sort((a, b) => a.slot - b.slot);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const channel of [this.play, this.sync]) {
      if (channel) await this.client.removeChannel(channel);
    }
    this.play = this.sync = null;
    this.setStatus('closed');
  }

  private subscribe(channel: RealtimeChannel, track: boolean, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (error?: OnlineError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => settle(new OnlineError('network', 'realtime_timeout')), timeoutMs);
      channel.subscribe(async (state, err) => {
        if (this.closed) return;
        if (state === 'SUBSCRIBED') {
          if (track) await channel.track({ ...this.me });
          if (!settled) settle();
          else void this.resync().catch(() => this.setStatus('reconnecting'));
        } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
          // A refusal is final. Anything else (a dropped socket, a server hiccup such as Realtime's
          // MissingPartition on a project's first private join) Realtime retries by itself, so
          // the open keeps waiting for that retry until its timeout.
          const denied = /unauthori[sz]ed|permission|not allowed/i.test(err?.message ?? '');
          if (denied && !settled) settle(new OnlineError('not_in_room', err?.message ?? state));
          else this.setStatus(denied ? 'denied' : 'reconnecting');
        }
      });
    });
  }

  private receive(event: SyncEvent): void {
    if (event.event !== 'members') {
      const version = event.payload.version;
      if (version <= this.seen) return;
      const missed = version > this.seen + 1;
      this.seen = version;
      this.handlers.onSync?.(event);
      if (missed) void this.resync().catch(() => this.setStatus('reconnecting'));
      return;
    }
    this.handlers.onSync?.(event);
  }

  private setStatus(status: ChannelStatus): void {
    if (this.status === status || (this.closed && status !== 'closed')) return;
    this.status = status;
    this.handlers.onStatus?.(status);
  }
}
