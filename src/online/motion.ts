import type { Facing, MoveSnapshot } from './protocol.ts';

/** A player's movement as the game knows it each frame; MotionThrottle adds the sequence and time. */
export type MotionState = Omit<MoveSnapshot, 'seq' | 't'>;

export interface MotionThrottleOptions {
  /** Most snapshots a second. */
  readonly hz?: number;
  /** A player standing still is re-sent this often, so a partner who reconnects sees them. */
  readonly heartbeatMs?: number;
  /** Movement smaller than this (in world pixels) does not count as a change. */
  readonly epsilon?: number;
}

/**
 * Sends a player's movement over Realtime without flooding it: at most `hz` snapshots a second,
 * only when something changed, and a slow heartbeat while standing still. Call update() every
 * frame; it decides whether this frame's state goes out.
 */
export class MotionThrottle {
  private readonly interval: number;
  private readonly heartbeatMs: number;
  private readonly epsilon: number;
  private last: MoveSnapshot | null = null;
  private seq = 0;

  constructor(
    private readonly send: (snapshot: MoveSnapshot) => void,
    options: MotionThrottleOptions = {},
  ) {
    this.interval = 1000 / (options.hz ?? 15);
    this.heartbeatMs = options.heartbeatMs ?? 1000;
    this.epsilon = options.epsilon ?? 0.5;
  }

  /** Returns whether a snapshot was sent. */
  update(state: MotionState, now: number): boolean {
    const last = this.last;
    if (last) {
      const elapsed = now - last.t;
      if (elapsed < this.interval) return false;
      if (!this.changed(state, last) && elapsed < this.heartbeatMs) return false;
    }
    const snapshot: MoveSnapshot = { ...state, seq: ++this.seq, t: now };
    this.last = snapshot;
    this.send(snapshot);
    return true;
  }

  private changed(state: MotionState, last: MoveSnapshot): boolean {
    return (
      Math.abs(state.x - last.x) > this.epsilon ||
      Math.abs(state.y - last.y) > this.epsilon ||
      Math.abs(state.vx - last.vx) > this.epsilon ||
      Math.abs(state.vy - last.vy) > this.epsilon ||
      state.facing !== last.facing ||
      state.carrying !== last.carrying
    );
  }
}

export interface MotionBufferOptions {
  /** How far in the past the partner is drawn, so there are usually two snapshots to blend. */
  readonly delayMs?: number;
  /** How long to keep moving a partner along their last velocity when snapshots are late. */
  readonly maxExtrapolateMs?: number;
  /** A jump longer than this (a respawn, a level change) is shown at once, not slid across. */
  readonly snapDistance?: number;
  readonly capacity?: number;
}

export interface MotionSample {
  readonly x: number;
  readonly y: number;
  readonly facing: Facing;
  readonly carrying: string | null;
  readonly moving: boolean;
}

/**
 * Smooths the partner's movement from the snapshots that arrive over Realtime. It draws the partner
 * `delayMs` in the past on the sender's own timeline, blending the two snapshots around that
 * moment. Network jitter then never shows as stutter. Late or repeated snapshots are dropped.
 * When the next one is overdue, the partner keeps going along their last velocity for a moment
 * rather than freezing.
 *
 * The sender's clock is mapped onto ours by the smallest receive-minus-send difference seen, which
 * belongs to the snapshot that came through fastest.
 */
export class MotionBuffer {
  private readonly delayMs: number;
  private readonly maxExtrapolateMs: number;
  private readonly snapDistance: number;
  private readonly capacity: number;
  private readonly snapshots: MoveSnapshot[] = [];
  private offset: number | null = null;

  constructor(options: MotionBufferOptions = {}) {
    this.delayMs = options.delayMs ?? 100;
    this.maxExtrapolateMs = options.maxExtrapolateMs ?? 150;
    this.snapDistance = options.snapDistance ?? 220;
    this.capacity = options.capacity ?? 32;
  }

  /** Returns false when the snapshot was older than one already received and so dropped. */
  push(snapshot: MoveSnapshot, receivedAt: number): boolean {
    const last = this.snapshots.at(-1);
    if (last && snapshot.seq <= last.seq) return false;
    const offset = receivedAt - snapshot.t;
    this.offset = this.offset === null ? offset : Math.min(this.offset, offset);
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.capacity) this.snapshots.splice(0, this.snapshots.length - this.capacity);
    return true;
  }

  /** Forgets everything, as when the partner leaves or the level changes. */
  clear(): void {
    this.snapshots.length = 0;
    this.offset = null;
  }

  sample(now: number): MotionSample | null {
    const list = this.snapshots;
    if (!list.length || this.offset === null) return null;
    const at = now - this.offset - this.delayMs;
    const first = list[0];
    const last = list[list.length - 1];

    if (at <= first.t) return this.pose(first, first.x, first.y);
    if (at >= last.t) {
      const ahead = Math.min(at - last.t, this.maxExtrapolateMs) / 1000;
      return this.pose(last, last.x + last.vx * ahead, last.y + last.vy * ahead);
    }
    let i = list.length - 1;
    while (i > 0 && list[i - 1].t > at) i--;
    const a = list[i - 1];
    const b = list[i];
    if (Math.hypot(b.x - a.x, b.y - a.y) > this.snapDistance) return this.pose(b, b.x, b.y);
    const k = (at - a.t) / (b.t - a.t);
    return this.pose(k < 0.5 ? a : b, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
  }

  private pose(from: MoveSnapshot, x: number, y: number): MotionSample {
    return { x, y, facing: from.facing, carrying: from.carrying, moving: from.vx !== 0 || from.vy !== 0 };
  }
}
