/**
 * The JSON contract between the native app (NG Native screens) and the game page (Phaser inside a
 * DOM component's web view). Only plain data crosses: the two sides are separate JavaScript
 * runtimes, so nothing here may hold a function, a class instance or a signal.
 *
 * Traffic is deliberately low-frequency. Movement, physics and per-frame state stay inside the
 * page; the app hears about milestones (ready, objective progress, completion), and the page hears
 * about session changes, settings and the occasional command.
 */

import type { HapticKind, NetConfig } from '../net/protocol.ts';

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

export type GameCommandKind = 'pause' | 'resume' | 'restart';

export interface GameCommand {
  /** Increases with every command, so re-sending the same inputs never repeats one. */
  readonly seq: number;
  readonly kind: GameCommandKind;
}

export interface LevelResult {
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
  | { readonly type: 'paused' }
  | { readonly type: 'resumed' }
  /** Feel on this phone: the app plays it through the native haptics engine. */
  | { readonly type: 'haptic'; readonly kind: HapticKind }
  /** A longer buzz on this phone, as when the partner asks for a hand. */
  | { readonly type: 'vibrate' }
  /** Two-phone play: whether this page can reach the other phone. */
  | { readonly type: 'net'; readonly status: 'connecting' | 'online' | 'partner-away' | 'offline' }
  | { readonly type: 'complete'; readonly result: LevelResult }
  | { readonly type: 'perf'; readonly fps: number }
  | { readonly type: 'disposed'; readonly sceneId: SceneId };

export function isLevelId(value: unknown): value is LevelId {
  return typeof value === 'string' && (LEVEL_IDS as readonly string[]).includes(value);
}
