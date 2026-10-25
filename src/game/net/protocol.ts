import type { CharacterId, LevelResult, SceneId } from '../bridge/protocol.ts';

/**
 * Two-phone play over the local network (Wi-Fi or a phone's hotspot).
 *
 * One phone hosts: it runs a WebSocket relay (a native module) and the authoritative game. The
 * other joins with a room code. Every message goes through the relay to every other client, so
 * each carries its channel and sender, and receivers ignore what is not theirs:
 *
 * - `lobby`: the two native apps agreeing who plays whom and which level starts.
 * - `game`: the two game pages. The guest sends its controls; the host simulates and sends back
 *   what the guest's screen should show. Nothing the guest sends can change the world directly.
 */

export const RELAY_PORT = 7777;
export const NET_VERSION = 1;

export type NetRole = 'host' | 'guest';

/** What the game page needs to take part, passed to it in the session. */
export interface NetConfig {
  readonly role: NetRole;
  /** ws://address:port of the relay. */
  readonly url: string;
  /** Room PIN, sent with every hello so a stray client on the network is ignored. */
  readonly pin: string;
  /** The character this phone controls. */
  readonly me: CharacterId;
}

// ---------------------------------------------------------------------------------------------
// Lobby

export type LobbyMessage =
  | { readonly ch: 'lobby'; readonly from: NetRole; readonly t: 'hello'; readonly pin: string; readonly v: number; readonly name: string }
  | {
      readonly ch: 'lobby';
      readonly from: 'host';
      readonly t: 'welcome';
      readonly guestPlays: CharacterId;
      readonly names: Readonly<Record<CharacterId, string>>;
      readonly outfits: Readonly<Record<CharacterId, number>>;
    }
  | { readonly ch: 'lobby'; readonly from: 'host'; readonly t: 'reject'; readonly reason: 'pin' | 'full' | 'version' }
  | { readonly ch: 'lobby'; readonly from: 'host'; readonly t: 'start'; readonly sceneId: SceneId; readonly sessionId: number }
  | { readonly ch: 'lobby'; readonly from: NetRole; readonly t: 'bye' }
  | { readonly ch: 'lobby'; readonly from: NetRole; readonly t: 'ping' };

// ---------------------------------------------------------------------------------------------
// Game

/** The guest's controls, sent when they change and as a heartbeat. */
export interface InputMessage {
  readonly ch: 'game';
  readonly from: 'guest';
  readonly t: 'in';
  readonly x: number;
  readonly y: number;
  /** Counters, not flags: a press is never lost or repeated by a dropped or duplicated message. */
  readonly ia: number;
  readonly ro: number;
}

export type GameNetMessage =
  | InputMessage
  | { readonly ch: 'game'; readonly from: 'guest'; readonly t: 'join'; readonly pin: string }
  | { readonly ch: 'game'; readonly from: NetRole; readonly t: 'pause' | 'resume' | 'restart' }
  | { readonly ch: 'game'; readonly from: 'host'; readonly t: 'snap'; readonly s: Snapshot }
  | { readonly ch: 'game'; readonly from: 'host'; readonly t: 'hud'; readonly h: HudEvent }
  | { readonly ch: 'game'; readonly from: 'host'; readonly t: 'fx'; readonly fx: EffectEvent }
  | { readonly ch: 'game'; readonly from: 'host'; readonly t: 'complete'; readonly result: LevelResult }
  | { readonly ch: 'game'; readonly from: 'host'; readonly t: 'paused'; readonly paused: boolean };

export type HudEvent =
  | { readonly k: 'title'; readonly text: string }
  | { readonly k: 'objectives'; readonly list: readonly { id: string; text: string; visible: boolean; done: boolean }[] }
  | { readonly k: 'toast'; readonly text: string; readonly kind: 'info' | 'good' | 'warn'; readonly ms: number }
  | { readonly k: 'intro'; readonly title: string; readonly lines: readonly string[]; readonly number: number };

/** One-shot effects the guest plays itself: sounds, particles, and feel on its own phone. */
export type EffectEvent =
  | { readonly k: 'sfx'; readonly name: string }
  | { readonly k: 'burst'; readonly x: number; readonly y: number; readonly n: number; readonly celebrate?: boolean }
  | { readonly k: 'haptic'; readonly kind: HapticKind; readonly who: CharacterId | 'both' }
  | { readonly k: 'vibrate'; readonly who: CharacterId };

export type HapticKind = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

/** A frame of the world as the guest should draw it. Only what changed since the last one. */
export interface Snapshot {
  /** Snapshot number; the first after a (re)join is full. */
  readonly n: number;
  readonly full: boolean;
  readonly world: SceneDelta;
  readonly hud: SceneDelta;
  readonly meta: SnapshotMeta;
}

export interface SceneDelta {
  /** Changed objects: id plus the fields that changed. */
  readonly o: readonly ObjectDelta[];
  /** Ids no longer in the scene. */
  readonly rm: readonly number[];
}

export type ObjectDelta = { readonly id: number } & Readonly<Record<string, unknown>>;

export interface SnapshotMeta {
  readonly world: { readonly w: number; readonly h: number };
  /** The net id of each character's sprite, for the guest's camera. */
  readonly players: Readonly<Record<CharacterId, number>>;
  /** Each character's current interaction prompt, for its own phone's button. */
  readonly prompts: Readonly<Record<CharacterId, string | null>>;
  /** Whether each character can rotate what they hold right now. */
  readonly rotate: Readonly<Record<CharacterId, boolean>>;
  /** Whether the guest's controls are reaching the host (heartbeat). */
  readonly guestOnline: boolean;
}

export type NetMessage = LobbyMessage | GameNetMessage;

export function parseNet(data: unknown): NetMessage | null {
  if (typeof data !== 'string') return null;
  try {
    const msg = JSON.parse(data) as Partial<NetMessage>;
    if (!msg || (msg.ch !== 'lobby' && msg.ch !== 'game') || (msg.from !== 'host' && msg.from !== 'guest') || typeof msg.t !== 'string') return null;
    return msg as NetMessage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Room codes

export interface RoomCode {
  /** The host's address: a full IPv4 address, or only its last number on the guest's network. */
  readonly host: string;
  readonly pin: string;
}

/**
 * A room code is the last number of the host's address and a two-digit PIN - "23-58" - which is
 * all a guest on the same home network (or the host's hotspot) needs. A full address works too,
 * "192.168.1.23-58", for networks that are not a simple /24, and for emulators ("10.0.2.2-58").
 */
export function formatRoomCode(hostAddress: string, pin: string): string {
  const last = hostAddress.split('.').at(-1) ?? hostAddress;
  return `${last}-${pin}`;
}

export function parseRoomCode(input: string): RoomCode | null {
  const cleaned = toLatinDigits(input).trim().replace(/[\s·_]+/g, '-');
  const match = /^((?:\d{1,3}\.){3}\d{1,3}|\d{1,3})-(\d{2})$/.exec(cleaned);
  if (!match) return null;
  const parts = match[1].split('.').map(Number);
  if (parts.some((p) => p > 255) || (parts.length === 1 && (parts[0] === 0 || parts[0] === 255))) return null;
  return { host: match[1], pin: match[2] };
}

/** The relay's URL for a room code, as seen from a guest with the given own address. */
export function relayUrl(code: RoomCode, ownAddress: string | null): string | null {
  if (code.host.includes('.')) return `ws://${code.host}:${RELAY_PORT}`;
  if (!ownAddress) return null;
  const prefix = ownAddress.split('.').slice(0, 3).join('.');
  return `ws://${prefix}.${code.host}:${RELAY_PORT}`;
}

export function randomPin(random: () => number = Math.random): string {
  return String(Math.floor(10 + random() * 90));
}

/** Eastern Arabic digits typed on an Arabic keyboard, read as the digits they are. */
export function toLatinDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}
