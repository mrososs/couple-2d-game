/**
 * The JSON contract between the native app (NG Native screens) and the game page (Phaser inside a
 * DOM component's web view). Only plain data crosses: the two sides are separate JavaScript
 * runtimes, so nothing here may hold a function, a class instance or a signal.
 *
 * Traffic is deliberately low-frequency. Movement, physics and per-frame state stay inside the
 * page; the app hears about milestones (ready, objective progress, completion), and the page hears
 * about session changes, settings and the occasional command.
 */

import type { LinkEnd } from '../net/link.ts';
import type { HapticKind, NetConfig, PauseReason } from '../net/protocol.ts';

export type CharacterId = 'wife' | 'husband';
export type LevelId = 'level01' | 'level02' | 'level03';
/** `sandbox` is the Phase 0 integration room, kept as a smoke test of the bridge. */
export type SceneId = LevelId | 'sandbox';

export const LEVEL_IDS: readonly LevelId[] = ['level01', 'level02', 'level03'];

export interface GameSession {
  readonly sceneId: SceneId;
  /** A new id restarts the scene; the same id re-sent (as on `ready`) changes nothing. */
  readonly sessionId: number;
  /** The character the first keyboard set and the touch stick start on. */
  readonly lead: CharacterId;
  readonly names: Readonly<Record<CharacterId, string>>;
  /** Index into each character's outfit palette. */
  readonly outfits: Readonly<Record<CharacterId, number>>;
  /** Shows physics bodies, interaction ranges and an FPS readout. */
  readonly devMode: boolean;
  /** Present for two-phone play: this page is the host's simulation or the guest's view of it. */
  readonly net?: NetConfig;
}

export interface GameSettings {
  readonly sound: boolean;
  /** 0..1 */
  readonly volume: number;
  /** Short contextual hints and arrows. */
  readonly hints: boolean;
  /** Fewer particles and screen shakes. */
  readonly reducedMotion: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  sound: true,
  volume: 0.7,
  hints: true,
  reducedMotion: false,
};

/**
 * `decline` is the host's "no" to the partner's restart request. On the guest's phone, pause,
 * resume and restart are requests the host's game decides on.
 */
export type GameCommandKind = 'pause' | 'resume' | 'restart' | 'decline';

export interface GameCommand {
  /** Increases with every command, so re-sending the same inputs never repeats one. */
  readonly seq: number;
  readonly kind: GameCommandKind;
}

export interface LevelResult {
  /**
   * The play this result belongs to: the same on both phones in two-phone play, so a result that
   * arrives twice (the game page and the lobby, or again after a reconnection) is saved once.
   */
  readonly id?: string;
  readonly levelId: LevelId;
  /** 1..3: every completed level earns at least one; the rest reward the approach. */
  readonly stars: number;
  readonly durationSec: number;
  /** Keys into the level's `insights` table, in the order they should be shown. */
  readonly insights: readonly string[];
  /** Small numbers the result screen can show ("you spent 2,580 of 3,000 EGP"). */
  readonly metrics: Readonly<Record<string, number | string | boolean>>;
}

export type GameEvent =
  | {
      readonly type: 'ready';
      readonly sceneId: SceneId;
      readonly sessionId: number;
      readonly renderer: 'webgl' | 'canvas';
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly type: 'objective';
      readonly sceneId: SceneId;
      readonly done: number;
      readonly total: number;
      readonly text: string;
    }
  | {
      readonly type: 'interaction';
      readonly sceneId: SceneId;
      readonly objectId: string;
      readonly by: CharacterId;
    }
  /** Why the game is paused: this player, the partner, or the partner's phone being away. */
  | { readonly type: 'paused'; readonly reasons?: readonly PauseReason[] }
  | { readonly type: 'resumed' }
  /** Host only: the partner asks to start the level again. */
  | { readonly type: 'request'; readonly kind: 'restart' }
  /** Guest only: the host's answer to its restart request. */
  | { readonly type: 'answer'; readonly kind: 'restart'; readonly ok: boolean }
  /** Feel on this phone: the app plays it through the native haptics engine. */
  | { readonly type: 'haptic'; readonly kind: HapticKind }
  /** A longer buzz on this phone, as when the partner asks for a hand. */
  | { readonly type: 'vibrate' }
  /**
   * Two-phone play: whether this page can reach the other phone. `host-left`: the host closed the
   * level; `closed`: the room is gone or refused this phone (`end` says why).
   */
  | { readonly type: 'net'; readonly status: 'connecting' | 'online' | 'partner-away' | 'offline' | 'host-left' | 'closed'; readonly end?: LinkEnd }
  | { readonly type: 'complete'; readonly result: LevelResult }
  | { readonly type: 'perf'; readonly fps: number }
  | { readonly type: 'disposed'; readonly sceneId: SceneId };

export function isLevelId(value: unknown): value is LevelId {
  return typeof value === 'string' && (LEVEL_IDS as readonly string[]).includes(value);
}
