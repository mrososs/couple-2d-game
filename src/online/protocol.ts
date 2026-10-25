import type { CharacterId, LevelId } from '../game/bridge/protocol.ts';

/**
 * Online play through Supabase: the shapes the server's game functions return, the errors they
 * raise, and the Realtime messages of a room. Shared by the native app, the game page and the
 * integration tests. Framework-free on purpose.
 *
 * A room has two private Realtime topics, both open only to the two players seated in it:
 * - `room:<id>`: the players' own traffic (movement, intentions, effects) and Presence. Ephemeral
 *   and never proof of anything; a client could send whatever it likes here.
 * - `room-sync:<id>`: announcements from the database when the authoritative state changes. The
 *   realtime.messages policies let players listen here but not send, so whatever arrives on it
 *   came from the server.
 */

export const roomTopic = (roomId: string): string => `room:${roomId}`;
export const syncTopic = (roomId: string): string => `room-sync:${roomId}`;

export type Slot = 1 | 2;
export type RoomStatus = 'waiting' | 'active' | 'closed';

// Room codes ----------------------------------------------------------------------------------------

/** The alphabet the server draws codes from: no I, O, 0 or 1 to misread. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE = /^[A-HJ-NP-Z2-9]{6}$/;

/**
 * A code as typed (any case, spaces or dashes, Eastern Arabic digits) in the server's form, or null
 * when it cannot be one. The server normalises the same way; this only saves a round trip.
 */
export function normalizeRoomCode(input: string): string | null {
  const latin = input.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  const code = latin.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return ROOM_CODE.test(code) ? code : null;
}

/** How a code is shown to people: two groups of three, `ABC-DEF`. */
export function formatOnlineCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

// What the game functions return --------------------------------------------------------------------

/** create_room and join_room: the caller's seat. */
export interface RoomSeat {
  readonly room_id: string;
  readonly code: string;
  readonly slot: Slot;
  readonly couple_id: string;
  readonly level_id: LevelId;
  readonly status: RoomStatus;
  readonly expires_at: string;
}

export interface LevelStart {
  readonly room_id: string;
  readonly level_id: LevelId;
  readonly version: number;
  readonly started_at: string;
  /** False when the level was already under way and nothing was reset. */
  readonly changed: boolean;
}

export type PuzzleOutcome = 'waiting' | 'solved' | 'mismatch';

export interface PuzzleResult {
  readonly puzzle: string;
  readonly status: PuzzleOutcome;
  readonly version: number;
  readonly changed: boolean;
  /** Both submitted values, when an `agree` puzzle's two parts differed. */
  readonly mismatch?: Readonly<Partial<Record<'1' | '2', unknown>>> | null;
}

export interface LevelCompletion {
  readonly level_id: LevelId;
  /** Stars for this play, from the mistakes the server counted. */
  readonly stars: number;
  /** The couple's best for the level. */
  readonly best_stars: number;
  readonly duration_seconds: number;
  readonly failed_attempts: number;
  readonly next_level_id: LevelId | null;
  readonly unlocked: readonly LevelId[];
  readonly version: number;
  readonly changed?: boolean;
}

export interface PuzzleState {
  readonly status: 'open' | 'solved';
  readonly parts: Readonly<Partial<Record<'1' | '2', unknown>>>;
  readonly attempts: number;
  readonly value?: unknown;
  readonly last_mismatch?: Readonly<Partial<Record<'1' | '2', unknown>>>;
}

export interface SharedLevelState {
  readonly puzzles: Readonly<Record<string, PuzzleState>>;
  readonly failed_attempts: number;
  readonly completed: boolean;
  readonly result?: LevelCompletion;
}

export interface RoomPlayer {
  readonly user_id: string;
  readonly slot: Slot;
  readonly joined_at: string;
  readonly display_name: string | null;
  readonly avatar_character: CharacterId | null;
  readonly avatar_outfit: number | null;
}

/** get_room_snapshot: everything a (re)connecting player needs to catch up. */
export interface RoomSnapshot {
  readonly room: {
    readonly id: string;
    readonly code: string;
    readonly owner_id: string;
    readonly couple_id: string;
    readonly status: RoomStatus;
    readonly current_level_id: LevelId;
    readonly created_at: string;
    readonly expires_at: string;
  };
  readonly players: readonly RoomPlayer[];
  readonly state: {
    readonly level_id: LevelId;
    readonly state: SharedLevelState;
    readonly version: number;
    readonly level_started_at: string | null;
    readonly updated_at: string;
  } | null;
}

/** A row of get_couple_levels. */
export interface CoupleLevel {
  readonly level_id: LevelId;
  readonly world_number: number;
  readonly level_number: number;
  readonly title: string;
  readonly description: string;
  readonly educational_objective: string;
  readonly unlocked: boolean;
  readonly status: 'not_started' | 'in_progress' | 'completed';
  readonly stars: number | null;
  readonly best_duration_seconds: number | null;
  readonly completed_at: string | null;
}

// Errors --------------------------------------------------------------------------------------------

/** The messages the game functions raise, plus what a call can fail with on its way there. */
export type OnlineErrorKey =
  | 'not_authenticated'
  | 'room_not_found'
  | 'room_full'
  | 'different_couple'
  | 'couple_full'
  | 'not_in_room'
  | 'level_locked'
  | 'level_not_active'
  | 'level_already_completed'
  | 'unknown_puzzle'
  | 'invalid_value'
  | 'partner_missing'
  | 'puzzles_unsolved'
  | 'room_code_exhausted'
  | 'permission_denied'
  | 'network'
  | 'unknown';

const KNOWN_KEYS = new Set<string>([
  'not_authenticated', 'room_not_found', 'room_full', 'different_couple', 'couple_full', 'not_in_room',
  'level_locked', 'level_not_active', 'level_already_completed', 'unknown_puzzle', 'invalid_value',
  'partner_missing', 'puzzles_unsolved', 'room_code_exhausted',
]);

export class OnlineError extends Error {
  constructor(
    readonly key: OnlineErrorKey,
    message: string = key,
    /** For puzzles_unsolved: the puzzles still open, comma-separated. */
    readonly detail: string | null = null,
  ) {
    super(message);
    this.name = 'OnlineError';
  }
}

/** A PostgREST or fetch error as an OnlineError with a key the app can act on. */
export function toOnlineError(error: { message?: string; code?: string; details?: string | null } | null | undefined): OnlineError {
  const message = error?.message ?? 'unknown';
  if (KNOWN_KEYS.has(message)) return new OnlineError(message as OnlineErrorKey, message, error?.details ?? null);
  if (error?.code === '42501') return new OnlineError('permission_denied', message);
  if (/fetch|network|Failed to fetch|NetworkError/i.test(message)) return new OnlineError('network', message);
  return new OnlineError('unknown', message);
}

/** What to tell the players, in the game's Egyptian Arabic. */
export const ONLINE_ERROR_TEXT: Readonly<Record<OnlineErrorKey, string>> = {
  not_authenticated: 'لازم ندخل الأول — جرّبوا تاني',
  room_not_found: 'مفيش غرفة بالكود ده — اتأكدوا منه',
  room_full: 'الغرفة مليانة: فيها اتنين خلاص',
  different_couple: 'الموبايل ده بيلعب مع شريك تاني',
  couple_full: 'الغرفة دي لزوجين تانيين',
  not_in_room: 'إنتوا مش في الغرفة دي',
  level_locked: 'المرحلة دي لسه مقفولة',
  level_not_active: 'المرحلة دي مش اللي شغالة دلوقتي',
  level_already_completed: 'المرحلة خلصت خلاص',
  unknown_puzzle: 'حاجة غلط في المرحلة — جرّبوا تعيدوها',
  invalid_value: 'القيمة دي مش مقبولة',
  partner_missing: 'مستنيين شريككم يرجع',
  puzzles_unsolved: 'لسه فيه حاجات لازم تعملوها سوا',
  room_code_exhausted: 'مقدرناش نعمل غرفة — جرّبوا تاني',
  permission_denied: 'مش مسموح',
  network: 'النت فاصل — بنحاول نوصل تاني',
  unknown: 'حصلت مشكلة — جرّبوا تاني',
};

// Realtime -------------------------------------------------------------------------------------------

export type Facing = 'up' | 'down' | 'left' | 'right';

/** One player's movement at a moment, sent at most 15 times a second. */
export interface MoveSnapshot {
  readonly slot: Slot;
  /** Increases with every snapshot from the same player, to drop ones that arrive late. */
  readonly seq: number;
  /** The sender's clock, in ms; only differences between a sender's own snapshots are used. */
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly facing: Facing;
  readonly carrying: string | null;
}

export type IntentKind = 'interact' | 'ask_help' | 'rotate' | 'pause' | 'resume';

/** What players send each other on `room:<id>`. Nothing here counts until the server agrees. */
export type PlayerBroadcast =
  | { readonly event: 'move'; readonly payload: MoveSnapshot }
  | { readonly event: 'intent'; readonly payload: { readonly slot: Slot; readonly kind: IntentKind; readonly target: string | null } }
  | { readonly event: 'fx'; readonly payload: { readonly slot: Slot; readonly kind: 'emote' | 'sfx' | 'burst'; readonly name: string; readonly x?: number; readonly y?: number } };

export type PlayerBroadcastEvent = PlayerBroadcast['event'];
export const PLAYER_BROADCAST_EVENTS: readonly PlayerBroadcastEvent[] = ['move', 'intent', 'fx'];

/** What the server announces on `room-sync:<id>` when the authoritative state changes. */
export type SyncEvent =
  | { readonly event: 'members'; readonly payload: { readonly room_id: string; readonly status: RoomStatus; readonly players: readonly { readonly user_id: string; readonly slot: Slot }[] } }
  | { readonly event: 'level'; readonly payload: { readonly version: number; readonly level_id: LevelId; readonly started_at: string } }
  | {
      readonly event: 'puzzle';
      readonly payload: {
        readonly version: number;
        readonly puzzle: string;
        readonly status: PuzzleOutcome;
        readonly by_slot: Slot;
        readonly value: unknown;
        readonly mismatch: Readonly<Partial<Record<'1' | '2', unknown>>> | null;
      };
    }
  | { readonly event: 'complete'; readonly payload: LevelCompletion };

export type SyncEventName = SyncEvent['event'];
export const SYNC_EVENTS: readonly SyncEventName[] = ['members', 'level', 'puzzle', 'complete'];

/** What each player publishes through Presence on `room:<id>`. */
export interface PresenceMeta {
  readonly user_id: string;
  readonly slot: Slot;
  readonly character: CharacterId | null;
  readonly online_at: string;
}
