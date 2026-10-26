import type { CharacterId, LevelResult, SceneId } from '../bridge/protocol.ts';
import { PIN_DIGITS, RELAY_PORT, ROOM_PATH } from './room.ts';

export { RELAY_PORT } from './room.ts';

/**
 * Two-phone play over the local network (the same Wi-Fi, or one phone's hotspot). No internet.
 *
 * One phone hosts: it runs the room relay (room.ts) and the authoritative game. The other joins.
 * Inside the room there are two channels:
 *
 * - `lobby`: the two native apps agreeing who plays whom, which level starts, and which levels
 *   were finished together.
 * - `game`: the two game pages. The guest sends its controls - a stick position and counted button
 *   presses - and requests (pause, restart). The host runs every rule and sends back what the
 *   guest's screen should show. Nothing the guest sends can change the world directly, and
 *   nothing it sends can claim a result.
 *
 * The relay stamps who sent what: whatever reaches the guest came from the host, and whatever
 * reaches the host from the guest carries `from: "guest"` set by the relay itself.
 */

export const NET_VERSION = 2;

export type NetRole = 'host' | 'guest';

/** What the game page needs to take part, passed to it in the session. */
export interface NetConfig {
  readonly role: NetRole;
  /** ws://address:port/bwbt of the room's relay. */
  readonly url: string;
  /** This phone's room credential: the host key, or the guest key from pairing. */
  readonly key: string;
  /** The room, for result ids that are the same on both phones. */
  readonly room: string;
  /** The character this phone controls. */
  readonly me: CharacterId;
}

// ---------------------------------------------------------------------------------------------
// Lobby

/** A level running in the room, so a partner who comes back can open it straight away. */
export interface ActiveLevel {
  readonly sceneId: SceneId;
  /** Increases with every level start in the room. */
  readonly session: number;
}

export type LobbyMessage =
  | { readonly ch: 'lobby'; readonly from: 'guest'; readonly t: 'hello'; readonly v: number; readonly name: string }
  | {
      readonly ch: 'lobby';
      readonly from: 'host';
      readonly t: 'welcome';
      readonly v: number;
      readonly guestPlays: CharacterId;
      readonly names: Readonly<Record<CharacterId, string>>;
      readonly outfits: Readonly<Record<CharacterId, number>>;
      /** The level being played right now, if any. */
      readonly level: ActiveLevel | null;
      /** Levels finished together in this room, for a partner who missed the moment. */
      readonly results: readonly LevelResult[];
    }
  | { readonly ch: 'lobby'; readonly from: 'host'; readonly t: 'reject'; readonly reason: 'version' }
  | { readonly ch: 'lobby'; readonly from: 'host'; readonly t: 'start'; readonly sceneId: SceneId; readonly session: number }
  /** The host's app saved a finished level: the partner saves the same record. */
  | { readonly ch: 'lobby'; readonly from: 'host'; readonly t: 'result'; readonly result: LevelResult }
  /** The host left the level (back to the lobby): the partner follows. */
  | { readonly ch: 'lobby'; readonly from: 'host'; readonly t: 'ended' }
  | { readonly ch: 'lobby'; readonly from: NetRole; readonly t: 'bye' }
  | { readonly ch: 'lobby'; readonly from: NetRole; readonly t: 'ping' };

// ---------------------------------------------------------------------------------------------
// Game

/** The guest's controls, sent when they change and as a heartbeat. */
export interface InputMessage {
  readonly ch: 'game';
  readonly from: 'guest';
  readonly t: 'in';
  /** The host's level run the guest is looking at; presses only count for that run. */
  readonly run: string;
  /** The guest's input epoch: a new one starts with every run seen and every page start. */
  readonly ep: string;
  /** Increases with every message of the epoch; older or repeated messages are dropped. */
  readonly seq: number;
  readonly x: number;
  readonly y: number;
  /**
   * Presses since the epoch began. Counters, not flags: a press survives a dropped message, and
   * a repeated message never presses twice.
   */
  readonly ia: number;
  readonly ro: number;
}

/** What paused the shared game: either player, or the partner's phone dropping out. */
export type PauseReason = 'host' | 'guest' | 'partner';

export type GameNetMessage =
  | InputMessage
  /** The guest asks for the whole picture: on joining, and when it missed a snapshot. */
  | { readonly ch: 'game'; readonly from: 'guest'; readonly t: 'join' }
  /** Requests the host decides on: pausing always works, restarting needs the host's yes. */
  | { readonly ch: 'game'; readonly from: 'guest'; readonly t: 'req'; readonly k: 'pause' | 'resume' | 'restart' }
  | { readonly ch: 'game'; readonly from: 'host'; readonly t: 'snap'; readonly s: Snapshot }
  | { readonly ch: 'game'; readonly from: 'host'; readonly t: 'hud'; readonly h: HudEvent }
  | { readonly ch: 'game'; readonly from: 'host'; readonly t: 'fx'; readonly fx: EffectEvent }
  | { readonly ch: 'game'; readonly from: 'host'; readonly t: 'complete'; readonly result: LevelResult }
  | { readonly ch: 'game'; readonly from: 'host'; readonly t: 'paused'; readonly reasons: readonly PauseReason[] }
  /** The host's answer to a restart request. */
  | { readonly ch: 'game'; readonly from: 'host'; readonly t: 'answer'; readonly k: 'restart'; readonly ok: boolean }
  /** The host closed the level. */
  | { readonly ch: 'game'; readonly from: 'host'; readonly t: 'bye' };

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
  /** The host's level run: a restarted level is a new run. */
  readonly run: string;
  /** Snapshot number within the run; deltas apply only on top of the one before. */
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
  /** Why the shared game is paused; empty while it runs. */
  readonly paused: readonly PauseReason[];
}

export type NetMessage = LobbyMessage | GameNetMessage;

export function parseNet(data: unknown): NetMessage | null {
  if (typeof data !== 'string') return null;
  try {
    return asNetMessage(JSON.parse(data));
  } catch {
    return null;
  }
}

/** A parsed frame as a room message: on the lobby or game channel, from a role, with a type. */
export function asNetMessage(value: unknown): NetMessage | null {
  const msg = value as Partial<NetMessage> | null;
  if (!msg || typeof msg !== 'object' || (msg.ch !== 'lobby' && msg.ch !== 'game') || (msg.from !== 'host' && msg.from !== 'guest') || typeof msg.t !== 'string') return null;
  return msg as NetMessage;
}

/** The guest's controls, checked: null for anything malformed, with the stick clamped to length 1. */
export function readInput(message: Partial<InputMessage>): { run: string; ep: string; seq: number; x: number; y: number; ia: number; ro: number } | null {
  const { run, ep, seq, ia, ro } = message;
  let { x, y } = message;
  if (typeof run !== 'string' || run.length > 32 || typeof ep !== 'string' || ep.length === 0 || ep.length > 32) return null;
  if (!isCount(seq) || !isCount(ia) || !isCount(ro)) return null;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  return { run, ep, seq, x, y, ia, ro };
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2 ** 31;
}

// ---------------------------------------------------------------------------------------------
// Room codes

export interface RoomCode {
  /** The host's address: a full IPv4 address, or only its last number on the guest's network. */
  readonly host: string;
  readonly pin: string;
}

/**
 * A room code is the last number of the host's address and the room's six-digit PIN -
 * "23-482916" - which is all a partner on the same home network (or the host's hotspot) needs when
 * the room does not show up by itself. A full address works too, "192.168.1.23-482916", for
 * networks that are not a simple /24, and for emulators ("10.0.2.2-482916"). The address only
 * finds the room; the PIN is what lets a phone in, once.
 */
export function formatRoomCode(hostAddress: string, pin: string): string {
  const last = hostAddress.split('.').at(-1) ?? hostAddress;
  return `${last}-${pin}`;
}

export function parseRoomCode(input: string): RoomCode | null {
  const cleaned = toLatinDigits(input).trim().replace(/[\s·_]+/g, '-').replace(/-+/g, '-');
  const match = new RegExp(`^((?:\\d{1,3}\\.){3}\\d{1,3}|\\d{1,3})-(\\d{${PIN_DIGITS}})$`).exec(cleaned);
  if (!match) return null;
  const parts = match[1].split('.').map(Number);
  if (parts.some((p) => p > 255) || (parts.length === 1 && (parts[0] === 0 || parts[0] === 255))) return null;
  return { host: match[1], pin: match[2] };
}

/** The relay's URL for an address, or for a short code as seen from a guest with its own address. */
export function relayUrl(code: Pick<RoomCode, 'host'>, ownAddress: string | null, port: number = RELAY_PORT): string | null {
  if (code.host.includes('.')) return `ws://${code.host}:${port}${ROOM_PATH}`;
  if (!ownAddress) return null;
  const prefix = ownAddress.split('.').slice(0, 3).join('.');
  return `ws://${prefix}.${code.host}:${port}${ROOM_PATH}`;
}

/** Eastern Arabic digits typed on an Arabic keyboard, read as the digits they are. */
export function toLatinDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** A short random id for runs and epochs (the game page has crypto; tests may not). */
export function randomId(length = 10): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}
