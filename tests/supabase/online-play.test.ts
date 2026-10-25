import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { CharacterId } from '../../src/game/bridge/protocol.ts';
import { createGameClient, onlineConfigFromEnv, type GameClient } from '../../src/online/client.ts';
import {
  formatOnlineCode,
  OnlineError,
  type PlayerBroadcast,
  type PresenceMeta,
  type RoomSeat,
  type Slot,
  type SyncEvent,
} from '../../src/online/protocol.ts';
import { RoomChannel } from '../../src/online/room-channel.ts';
import {
  completeLevel,
  createRoom,
  getCoupleLevels,
  getRoomSnapshot,
  joinRoom,
  leaveRoom,
  saveProfile,
  startLevel,
  submitPuzzlePart,
} from '../../src/online/rooms-api.ts';

/**
 * Two players and a stranger, each with a client of their own, against the hosted development
 * project: the same calls the app makes, through the publishable key only. The players are
 * anonymous users made for this run; scripts/test-supabase.mjs removes them afterwards.
 */

const config = onlineConfigFromEnv();
if (!config) throw new Error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local');

interface Player {
  readonly name: string;
  client: GameClient;
  readonly userId: string;
  channel: RoomChannel | null;
  readonly sync: SyncEvent[];
  readonly heard: PlayerBroadcast[];
  presence: readonly PresenceMeta[];
}

const created: string[] = [];

async function newPlayer(name: string, character: CharacterId): Promise<Player> {
  const client = createGameClient(config!, { persistSession: false });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`Anonymous sign-in failed: ${error?.message}`);
  created.push(data.user.id);
  await saveProfile(client, data.user.id, { displayName: name, character, outfit: 0 });
  return { name, client, userId: data.user.id, channel: null, sync: [], heard: [], presence: [] };
}

function connect(player: Player, roomId: string, slot: Slot): RoomChannel {
  const channel = new RoomChannel(
    player.client,
    roomId,
    { user_id: player.userId, slot, character: slot === 1 ? 'wife' : 'husband', online_at: new Date().toISOString() },
    {
      onSync: (event) => player.sync.push(event),
      onBroadcast: (message) => player.heard.push(message),
      onPresence: (players) => (player.presence = players),
    },
  );
  player.channel = channel;
  return channel;
}

/** Polls until `check` returns something truthy. */
async function eventually<T>(check: () => T | undefined | null | false, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('Timed out waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function failure(promise: Promise<unknown>): Promise<OnlineError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OnlineError) return error;
    throw error;
  }
  throw new Error('Expected the call to fail');
}

const lastPuzzleEvent = (player: Player, puzzle: string, status: string) =>
  player.sync.find((e) => e.event === 'puzzle' && e.payload.puzzle === puzzle && e.payload.status === status);

// The tests in a file run in order, one at a time: each step builds on the one before.
describe('online play on Supabase Cloud', () => {
  let a: Player;
  let b: Player;
  let c: Player;
  let seat: RoomSeat;

  beforeAll(async () => {
    a = await newPlayer('منى', 'wife');
    b = await newPlayer('كريم', 'husband');
    c = await newPlayer('غريب', 'husband');
  });

  afterAll(async () => {
    for (const p of [a, b, c]) await p?.channel?.close();
    mkdirSync('supabase/.temp', { recursive: true });
    writeFileSync('supabase/.temp/integration-users.json', JSON.stringify(created));
  });

  describe('rooms', () => {
    test('player A opens a room and gets a code to share', async () => {
      seat = await createRoom(a.client);
      expect(seat.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      expect(seat).toMatchObject({ slot: 1, level_id: 'level01', status: 'waiting' });
    });

    test('a wrong or malformed code fails safely, the same way as a missing one', async () => {
      const wrong = seat.code === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ';
      expect((await failure(joinRoom(b.client, wrong))).key).toBe('room_not_found');
      expect((await failure(joinRoom(b.client, '12'))).key).toBe('room_not_found');
      const raw = await b.client.rpc('join_room', { p_code: "'; drop table public.levels; --" });
      expect(raw.error?.message).toBe('room_not_found');
    });

    test('player B joins with the code, as people type it, and becomes the partner', async () => {
      const joined = await joinRoom(b.client, formatOnlineCode(seat.code).toLowerCase());
      expect(joined).toMatchObject({ room_id: seat.room_id, slot: 2, couple_id: seat.couple_id, status: 'active' });
      const snapshot = await getRoomSnapshot(b.client, seat.room_id);
      expect(snapshot!.players.map((p) => [p.slot, p.display_name])).toEqual([[1, 'منى'], [2, 'كريم']]);
    });

    test('a third player cannot take a seat in a full room', async () => {
      expect((await failure(joinRoom(c.client, seat.code))).key).toBe('room_full');
    });
  });

  describe('privacy and authority', () => {
    test("a third player can read nothing of the couple's room, state or progress", async () => {
      for (const table of ['game_rooms', 'room_players', 'room_state', 'couples', 'couple_members', 'level_progress'] as const) {
        const { data, error } = await c.client.from(table).select('*');
        expect(error, table).toBeNull();
        expect(data, table).toEqual([]);
      }
      const profiles = await c.client.from('profiles').select('user_id').in('user_id', [a.userId, b.userId]);
      expect(profiles.data).toEqual([]);
      expect(await getRoomSnapshot(c.client, seat.room_id)).toBeNull();
    });

    test('a third player cannot act in the room', async () => {
      expect((await failure(startLevel(c.client, seat.room_id, 'level01'))).key).toBe('not_in_room');
      expect((await failure(submitPuzzlePart(c.client, seat.room_id, 'l1.plan_review'))).key).toBe('not_in_room');
      expect((await failure(completeLevel(c.client, seat.room_id, 'level01'))).key).toBe('not_in_room');
      expect((await failure(leaveRoom(c.client, seat.room_id))).key).toBe('room_not_found');
    });

    test('nobody can write progress, membership or room state directly', async () => {
      const writes = [
        a.client.from('level_progress').insert({ couple_id: seat.couple_id, level_id: 'level03', status: 'completed', stars: 3, completed_at: new Date().toISOString() }),
        a.client.from('couple_members').update({ status: 'left' }).eq('user_id', a.userId),
        a.client.from('couple_members').insert({ couple_id: seat.couple_id, user_id: c.userId }),
        a.client.from('room_state').update({ version: 999 }).eq('room_id', seat.room_id),
        a.client.from('room_players').update({ slot: 2 }).eq('user_id', a.userId),
        a.client.from('game_rooms').update({ status: 'closed' }).eq('id', seat.room_id),
        c.client.from('room_players').insert({ room_id: seat.room_id, user_id: c.userId, slot: 2 }),
      ];
      for (const write of writes) {
        const { error } = await write;
        expect(error?.code).toBe('42501');
      }
      // Profiles are writable, but only one's own: an update of the partner's touches no row.
      const other = await a.client.from('profiles').update({ display_name: 'x' }).eq('user_id', b.userId).select();
      expect(other.data).toEqual([]);
      const progress = await a.client.from('level_progress').select('level_id, status');
      expect(progress.data).toEqual([]);
    });
  });

  describe('realtime', () => {
    test('both players join the private room channel and see each other through Presence', async () => {
      const [snapA, snapB] = await Promise.all([connect(a, seat.room_id, 1).open(), connect(b, seat.room_id, 2).open()]);
      expect(snapA.room.id).toBe(seat.room_id);
      expect(snapB.state!.level_id).toBe('level01');
      await eventually(() => a.presence.length === 2 && b.presence.length === 2);
      expect(a.presence.map((p) => [p.slot, p.user_id])).toEqual([[1, a.userId], [2, b.userId]]);
    });

    test('the private channel turns a third player away', async () => {
      const error = await failure(connect(c, seat.room_id, 2).open(8000));
      expect(error.key).toBe('not_in_room');
      await c.channel!.close();
      c.channel = null;
    });

    test("player A's movement reaches player B", async () => {
      const move = { slot: 1 as const, seq: 1, t: Date.now(), x: 320, y: 410, vx: 140, vy: 0, facing: 'right' as const, carrying: null };
      expect(await a.channel!.send({ event: 'move', payload: move })).toBe('ok');
      expect(await a.channel!.send({ event: 'intent', payload: { slot: 1, kind: 'ask_help', target: 'cot' } })).toBe('ok');
      const heard = await eventually(() => b.heard.find((m) => m.event === 'move'));
      expect(heard.payload).toMatchObject({ x: 320, y: 410, facing: 'right' });
      await eventually(() => b.heard.find((m) => m.event === 'intent' && m.payload.kind === 'ask_help'));
      expect(a.heard).toEqual([]); // nobody hears their own messages back
    });
  });

  describe('a cooperative puzzle, decided by the server', () => {
    test('starting the level is announced to both players', async () => {
      const started = await startLevel(a.client, seat.room_id, 'level01');
      expect(started.changed).toBe(true);
      // Both phones may call it when the level opens; the second call changes nothing.
      expect((await startLevel(b.client, seat.room_id, 'level01')).changed).toBe(false);
      for (const p of [a, b]) await eventually(() => p.sync.find((e) => e.event === 'level' && e.payload.version === started.version));
    });

    test('values outside the rule and unknown puzzles are refused', async () => {
      expect((await failure(submitPuzzlePart(a.client, seat.room_id, 'l1.clinic_day', 9))).key).toBe('invalid_value');
      expect((await failure(submitPuzzlePart(a.client, seat.room_id, 'l1.clinic_day', 'tuesday'))).key).toBe('invalid_value');
      expect((await failure(submitPuzzlePart(a.client, seat.room_id, 'l9.nothing'))).key).toBe('unknown_puzzle');
    });

    test('two different days are a mismatch: counted, cleared, and heard by both', async () => {
      expect((await submitPuzzlePart(a.client, seat.room_id, 'l1.clinic_day', 2)).status).toBe('waiting');
      await eventually(() => b.sync.find((e) => e.event === 'puzzle' && e.payload.status === 'waiting' && e.payload.by_slot === 1));
      const mismatch = await submitPuzzlePart(b.client, seat.room_id, 'l1.clinic_day', 4);
      expect(mismatch).toMatchObject({ status: 'mismatch', mismatch: { '1': 2, '2': 4 } });
      for (const p of [a, b]) await eventually(() => lastPuzzleEvent(p, 'l1.clinic_day', 'mismatch'));
    });

    test('the same day from both solves it, and both players receive the result', async () => {
      await submitPuzzlePart(a.client, seat.room_id, 'l1.clinic_day', 4);
      const solved = await submitPuzzlePart(b.client, seat.room_id, 'l1.clinic_day', 4);
      expect(solved.status).toBe('solved');
      for (const p of [a, b]) {
        const event = await eventually(() => lastPuzzleEvent(p, 'l1.clinic_day', 'solved'));
        expect(event.payload).toMatchObject({ value: 4, version: solved.version });
      }
      // Submitting again changes nothing.
      expect((await submitPuzzlePart(a.client, seat.room_id, 'l1.clinic_day', 4)).changed).toBe(false);
    });
  });

  describe('progression', () => {
    test('the level cannot be completed while a shared puzzle is still open', async () => {
      const error = await failure(completeLevel(a.client, seat.room_id, 'level01'));
      expect(error.key).toBe('puzzles_unsolved');
      expect(error.detail).toBe('l1.plan_review');
      expect((await failure(completeLevel(a.client, seat.room_id, 'level02'))).key).toBe('level_not_active');
      expect((await failure(startLevel(a.client, seat.room_id, 'level02'))).key).toBe('level_locked');
    });

    test('completing level 1 legitimately awards stars from the server and unlocks level 2', async () => {
      await submitPuzzlePart(a.client, seat.room_id, 'l1.plan_review');
      expect((await submitPuzzlePart(b.client, seat.room_id, 'l1.plan_review')).status).toBe('solved');
      const done = await completeLevel(b.client, seat.room_id, 'level01');
      // One mismatch on the clinic day: two stars, decided by the server.
      expect(done).toMatchObject({ level_id: 'level01', stars: 2, best_stars: 2, failed_attempts: 1, next_level_id: 'level02' });
      expect(done.unlocked).toEqual(['level01', 'level02']);
      for (const p of [a, b]) await eventually(() => p.sync.find((e) => e.event === 'complete' && e.payload.level_id === 'level01'));
      // Completing again returns the same result.
      expect(await completeLevel(a.client, seat.room_id, 'level01')).toMatchObject({ stars: 2, changed: false });

      const levels = await getCoupleLevels(a.client);
      expect(levels.map((l) => [l.level_id, l.unlocked, l.status, l.stars])).toEqual([
        ['level01', true, 'completed', 2],
        ['level02', true, 'not_started', null],
        ['level03', false, 'not_started', null],
      ]);
    });

    test("a third player's levels are their own: nothing completed, only level 1 open", async () => {
      const levels = await getCoupleLevels(c.client);
      expect(levels.map((l) => [l.level_id, l.unlocked, l.status])).toEqual([
        ['level01', true, 'not_started'],
        ['level02', false, 'not_started'],
        ['level03', false, 'not_started'],
      ]);
    });

    test('a player who drops and comes back gets the latest state and their progress', async () => {
      const { data } = await b.client.auth.getSession();
      await b.channel!.close();
      b.client.auth.stopAutoRefresh();
      await eventually(() => a.presence.length === 1);

      // A new client: the app after a restart, with the session it kept.
      b.client = createGameClient(config!, { persistSession: false });
      const restored = await b.client.auth.setSession({ access_token: data.session!.access_token, refresh_token: data.session!.refresh_token });
      expect(restored.data.user?.id).toBe(b.userId);

      const snapshot = await getRoomSnapshot(b.client, seat.room_id);
      expect(snapshot!.state).toMatchObject({ level_id: 'level01', version: a.channel!.version });
      expect(snapshot!.state!.state.completed).toBe(true);
      const levels = await getCoupleLevels(b.client);
      expect(levels.find((l) => l.level_id === 'level01')).toMatchObject({ status: 'completed', stars: 2 });

      b.sync.length = 0;
      await connect(b, seat.room_id, 2).open();
      await eventually(() => a.presence.length === 2 && b.presence.length === 2);
      // The level transition goes through the server and reaches both, the returning player too.
      const next = await startLevel(b.client, seat.room_id, 'level02');
      for (const p of [a, b]) await eventually(() => p.sync.find((e) => e.event === 'level' && e.payload.version === next.version));
    });
  });

  describe('leaving', () => {
    test("an empty seat is still no way into someone else's couple", async () => {
      expect((await leaveRoom(b.client, seat.room_id)).status).toBe('waiting');
      expect((await failure(joinRoom(c.client, seat.code))).key).toBe('couple_full');
    });

    test('the partner can come back to the same seat', async () => {
      expect(await joinRoom(b.client, seat.code)).toMatchObject({ slot: 2, couple_id: seat.couple_id, status: 'active' });
    });

    test('the room closes when both have left, and its code no longer works', async () => {
      await leaveRoom(b.client, seat.room_id);
      expect((await leaveRoom(a.client, seat.room_id)).status).toBe('closed');
      expect((await failure(joinRoom(c.client, seat.code))).key).toBe('room_not_found');
      // Leaving twice is harmless.
      expect((await leaveRoom(a.client, seat.room_id)).left).toBe(true);
    });
  });
});
