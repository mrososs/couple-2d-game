/**
 * The room protocol: how a phone gets into the host phone's room before any game message moves.
 *
 * The host phone runs a small WebSocket relay on the local network (modules/lan-relay on Android,
 * scripts/lan-relay.ts for development in a browser). The relay is not a dumb pipe: it decides who
 * is in the room, and stamps who said what, so the two apps on top never have to trust a claim
 * made inside a message.
 *
 * Every connection's first frame is an `auth` frame, answered with `authed` or `denied`:
 *
 * - The host app's own connections (its lobby and its game page) present the host key the relay
 *   was started with, and only from this phone (a loopback address).
 * - The partner pairs once with the room PIN shown on the host's screen. The PIN is single use:
 *   the relay answers with a guest key and forgets the PIN. Five wrong PINs rotate it, and PIN
 *   attempts are spaced out, so guessing one is impractical within a session.
 * - After that, every connection of the partner's phone (its lobby, its game page, a reconnection
 *   after Wi-Fi dropped) presents the guest key. A third phone has neither.
 *
 * Once in, the host's frames go to the partner's connections and the partner's frames to the
 * host's, with `from: "guest"` set by the relay. The partner can never speak as the host, and
 * nobody else hears anything. Frames from the partner are size-limited and rate-limited.
 *
 * This is protection against the other devices on a home network or hotspot - a curious phone,
 * a scan of open ports - not against someone who can read the Wi-Fi traffic itself: the frames
 * are not encrypted (see docs/wlan-multiplayer-review.md).
 */

export const ROOM_VERSION = 2;
export const RELAY_PORT = 7777;
/** The relay answers on this path only, so a stray browser or port scan gets nowhere. */
export const ROOM_PATH = '/bwbt';
export const PIN_DIGITS = 6;

export const ROOM_LIMITS = {
  /** A connection that has not authenticated by then is closed. */
  authTimeoutMs: 5000,
  /** Connections still authenticating at once; more are turned away. */
  maxPending: 4,
  /** Open connections per role: lobby + game page + one reconnecting. */
  maxPerRole: 3,
  /** Largest frame from the partner (controls and lobby messages are tiny). */
  guestMaxBytes: 4096,
  /** Largest frame from the host (a full snapshot of the world). */
  hostMaxBytes: 1 << 20,
  /** The partner's sustained frame rate, and the burst allowed on top. */
  guestRatePerSec: 120,
  guestBurst: 240,
  /** Dropped frames (too big, too many, malformed) before the connection is closed. */
  maxViolations: 40,
  /** Wrong PINs before the PIN is replaced with a new one. */
  maxPinFailures: 5,
  /** Minimum time between two PIN checks, across all connections. */
  pinSpacingMs: 400,
} as const;

/** Close codes. The terminal ones mean "do not retry with the same credentials". */
export const CLOSE = {
  /** The host closed the room. */
  roomClosed: 4000,
  authTimeout: 4001,
  badAuth: 4002,
  busy: 4003,
  /** Too many oversized, malformed or rate-limited frames. */
  abuse: 4008,
  wrongPin: 4401,
  forbidden: 4403,
  /** Another phone is already the partner in this room. */
  full: 4409,
  /** The key is not (or no longer) valid: the room was reset or restarted. */
  badKey: 4410,
  version: 4426,
  /** PIN attempts are being spaced out; try again in a moment. */
  slowDown: 4429,
} as const;

export type DenyReason = 'pin' | 'full' | 'key' | 'version' | 'forbidden' | 'malformed' | 'busy' | 'slow';

export const DENY_CLOSE: Readonly<Record<DenyReason, number>> = {
  pin: CLOSE.wrongPin,
  full: CLOSE.full,
  key: CLOSE.badKey,
  version: CLOSE.version,
  forbidden: CLOSE.forbidden,
  malformed: CLOSE.badAuth,
  busy: CLOSE.busy,
  slow: CLOSE.slowDown,
};

/** Reasons after which retrying with the same credentials cannot succeed. */
export const TERMINAL_DENIALS: ReadonlySet<DenyReason> = new Set(['pin', 'full', 'key', 'version', 'forbidden']);
export const TERMINAL_CLOSE_CODES: ReadonlySet<number> = new Set([CLOSE.roomClosed, CLOSE.wrongPin, CLOSE.forbidden, CLOSE.full, CLOSE.badKey, CLOSE.version]);

export type RoomRole = 'host' | 'guest';

/** What a connection presents in its first frame. */
export type RoomAuth = { readonly role: 'host'; readonly key: string } | { readonly role: 'guest'; readonly key: string } | { readonly role: 'guest'; readonly pin: string };

export interface AuthFrame {
  readonly t: 'auth';
  readonly v: number;
  readonly role: RoomRole;
  readonly key?: string;
  readonly pin?: string;
}

/** Relay to client: control frames, on channel `ctl`. */
export type ControlFrame =
  | { readonly ch: 'ctl'; readonly t: 'authed'; readonly role: RoomRole; readonly room: string; readonly key?: string }
  | { readonly ch: 'ctl'; readonly t: 'denied'; readonly reason: DenyReason }
  /** To the host's connections, on joining and whenever it changes. `pin` is null once paired. */
  | { readonly ch: 'ctl'; readonly t: 'room'; readonly room: string; readonly pin: string | null; readonly paired: boolean; readonly guests: number; readonly failures: number };

/** Host to relay: forget the partner (their key stops working) and show a fresh PIN. */
export interface ResetFrame {
  readonly ch: 'ctl';
  readonly t: 'reset';
}

export function authFrame(auth: RoomAuth): AuthFrame {
  return 'pin' in auth ? { t: 'auth', v: ROOM_VERSION, role: 'guest', pin: auth.pin } : { t: 'auth', v: ROOM_VERSION, role: auth.role, key: auth.key };
}

/** Reads a client's first frame; null when it is not a well-formed auth frame. */
export function parseAuth(text: string): AuthFrame | null {
  if (text.length > 512) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const f = value as Record<string, unknown>;
  if (f.t !== 'auth' || typeof f.v !== 'number' || (f.role !== 'host' && f.role !== 'guest')) return null;
  const key = typeof f.key === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(f.key) ? f.key : undefined;
  const pin = typeof f.pin === 'string' && new RegExp(`^\\d{${PIN_DIGITS}}$`).test(f.pin) ? f.pin : undefined;
  if (!key && !pin) return null;
  if (f.role === 'host' && !key) return null;
  return { t: 'auth', v: f.v, role: f.role, key, pin };
}

/**
 * Addresses a room may be reached from: this phone, and the private ranges home networks and
 * hotspots use. Anything else (a public address, which would mean the port is exposed beyond the
 * local network) is refused.
 */
export function isLocalNetworkAddress(address: string): boolean {
  const a = address.replace(/^::ffff:/i, '').toLowerCase();
  if (a === '::1' || a === 'localhost') return true;
  if (a.includes(':')) return a.startsWith('fe80:') || /^f[cd][0-9a-f]{2}:/.test(a);
  const p = a.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return (
    p[0] === 10 ||
    p[0] === 127 ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 169 && p[1] === 254) ||
    // Carrier-grade NAT space, which some phone hotspots hand out.
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
  );
}

export function isLoopbackAddress(address: string): boolean {
  const a = address.replace(/^::ffff:/i, '').toLowerCase();
  return a === '::1' || a.startsWith('127.');
}

/** Constant-time comparison of two short secrets. */
export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
