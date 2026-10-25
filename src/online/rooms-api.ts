import type { CharacterId, LevelId } from '../game/bridge/protocol.ts';
import type { GameClient } from './client.ts';
import type { Json } from './database.types.ts';
import {
  normalizeRoomCode,
  OnlineError,
  toOnlineError,
  type CoupleLevel,
  type LevelCompletion,
  type LevelStart,
  type PuzzleResult,
  type RoomSeat,
  type RoomSnapshot,
} from './protocol.ts';

/**
 * The game's server-side operations, typed. Each is one Postgres function (supabase/migrations/
 * *_game_functions.sql) that checks the caller and their seat itself; a failure arrives as an
 * OnlineError whose key says what went wrong.
 */

interface Reply {
  readonly data: unknown;
  readonly error: { message?: string; code?: string; details?: string | null } | null;
}

async function call<T>(request: PromiseLike<Reply>): Promise<T> {
  let reply: Reply;
  try {
    reply = await request;
  } catch (error) {
    throw toOnlineError({ message: (error as Error)?.message });
  }
  if (reply.error) throw toOnlineError(reply.error);
  return reply.data as T;
}

/** Opens a room for the player's couple (founding it on their first room), seated in slot 1. */
export function createRoom(client: GameClient): Promise<RoomSeat> {
  return call(client.rpc('create_room'));
}

/** Takes a seat in the room with this code; a code that cannot exist fails without a request. */
export function joinRoom(client: GameClient, code: string): Promise<RoomSeat> {
  const normalized = normalizeRoomCode(code);
  if (!normalized) return Promise.reject(new OnlineError('room_not_found'));
  return call(client.rpc('join_room', { p_code: normalized }));
}

export function leaveRoom(client: GameClient, roomId: string): Promise<{ room_id: string; left: boolean; status: string }> {
  return call(client.rpc('leave_room', { p_room_id: roomId }));
}

/** The room as the server has it now, or null when the player may not see it. */
export function getRoomSnapshot(client: GameClient, roomId: string): Promise<RoomSnapshot | null> {
  return call(client.rpc('get_room_snapshot', { p_room_id: roomId }));
}

export function startLevel(client: GameClient, roomId: string, levelId: LevelId, restart = false): Promise<LevelStart> {
  return call(client.rpc('start_level', { p_room_id: roomId, p_level_id: levelId, p_restart: restart }));
}

/** This player's part of a shared puzzle: `true` for a joint action, or the value both must agree on. */
export function submitPuzzlePart(client: GameClient, roomId: string, puzzle: string, value: Json = true): Promise<PuzzleResult> {
  return call(client.rpc('submit_puzzle_part', { p_room_id: roomId, p_puzzle: puzzle, p_value: value }));
}

/** Asks the server to complete the room's level; it checks the puzzles and awards the stars. */
export function completeLevel(client: GameClient, roomId: string, levelId: LevelId): Promise<LevelCompletion> {
  return call(client.rpc('complete_level', { p_room_id: roomId, p_level_id: levelId }));
}

/** Every level, with whether the player's couple has opened it and how they did. */
export function getCoupleLevels(client: GameClient): Promise<CoupleLevel[]> {
  return call(client.rpc('get_couple_levels'));
}

export interface ProfileFields {
  readonly displayName: string;
  readonly character: CharacterId | null;
  readonly outfit: number;
}

/** Creates or updates the signed-in player's own profile (the only table a client writes). */
export async function saveProfile(client: GameClient, userId: string, profile: ProfileFields): Promise<void> {
  await call(
    client.from('profiles').upsert(
      {
        user_id: userId,
        display_name: profile.displayName.trim().slice(0, 40) || '؟',
        avatar_character: profile.character,
        avatar_outfit: profile.outfit,
      },
      { onConflict: 'user_id' },
    ),
  );
}
