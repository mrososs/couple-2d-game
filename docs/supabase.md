# Supabase backend (optional, not used by the game)

> **Not part of gameplay.** The game is local WLAN multiplayer only — same Wi‑Fi or a hotspot, no
> internet (see `docs/wlan-multiplayer-review.md`). Nothing in the app uses this backend for rooms,
> movement, puzzles or progress. It is kept, with its migrations and the hosted project's data
> untouched, as groundwork for a possible future cloud backup; it was not changed or deployed for
> the WLAN work.

The design below was written for two phones anywhere with internet, playing through the hosted Supabase
project **`tepouugfevlyrlnwhyqm`** ("2D-Couple-Game", eu-west-1, Postgres 17). There is no custom
server: Postgres functions hold the game's rules, row level security guards every table, and
Supabase Realtime carries the live traffic between the two phones.

What lives where:

| Kind of data | Where | Why |
| --- | --- | --- |
| Movement, intentions, effects | Realtime Broadcast on `room:<id>` | Ephemeral, up to 15 messages/s per player; never stored |
| Who is connected | Realtime Presence on `room:<id>` | Ephemeral |
| Shared puzzle state, level transitions | `room_state`, changed only by game functions | Must survive reconnects; decided by the server |
| Progress (stars, unlocked levels) | `level_progress`, changed only by `complete_level` | Persistent; clients cannot award it |
| Announcements of authoritative changes | Realtime Broadcast on `room-sync:<id>`, sent by the database | Clients can listen but not send there |

## Files

```
supabase/
  config.toml                       supabase init (project_id before-we-become-three)
  migrations/
    20261025221121_game_schema.sql             tables, constraints, indexes, RLS, grants
    20261025221127_game_functions.sql          the game's server-side rules (RPC)
    20261025221131_realtime_room_channels.sql  who may use a room's Realtime topics
    20261025221136_levels_reference_data.sql   the three levels (idempotent upsert)
  seed.sql                          intentionally empty (levels are reference data, above)
  functions/                        no Edge Functions needed so far
src/online/                         framework-free client layer (app, game page, tests)
  client.ts          createGameClient(), onlineConfigFromEnv()
  database.types.ts  generated from the remote schema (npm run db:types)
  protocol.ts        RPC result types, error keys + Arabic messages, Realtime event types
  rooms-api.ts       typed wrappers around the game functions
  room-channel.ts    RoomChannel: private topics, Presence, broadcasts, resync on reconnect
  motion.ts          MotionThrottle (≤15 Hz, change-only + heartbeat), MotionBuffer (interpolation)
src/app/services/
  online.ts          Online (the client), OnlineSession (anonymous sign-in, profile)
  online-room.ts     OnlineRoom (room state as signals, resync when the app returns)
  cloud-progress.ts  CloudProgress (the couple's levels from the server)
src/web-host/online-auth-storage.ts  browser session storage per ?profile= tab
tests/supabase/online-play.test.ts   two players and a stranger against the hosted project
scripts/test-supabase.mjs            runs those tests, then deletes the players they made
```

## Schema

- **profiles**: one per player (`user_id` → `auth.users`), display name, avatar character and
  outfit. The only table a client writes, and only its own row.
- **couples** / **couple_members**: a couple is two players; a player is in at most one couple
  (partial unique index), a couple holds at most two (trigger with a row lock).
- **game_rooms**: six-character code from an alphabet without look-alikes, unique among open
  rooms; owner, couple, status (`waiting`, `active`, `closed`), current level, expiry (6 h).
- **room_players**: seats 1 and 2. One player per seat and one open room per player (partial
  unique indexes), at most two seated (trigger with a row lock).
- **levels**: id, world/level number, title, description, educational objective, `config`
  (shared puzzles and their rules, which ones a level requires), `unlock_requirements`.
- **level_progress**: per couple and level: status, stars (best), best time, attempts,
  completions, first/last completion.
- **room_state**: per room: the level being played, its puzzles and their parts, failed attempts,
  completion and result, a `version` that increases with every change.

## Game functions (RPC)

All in `public`, `search_path` empty, `EXECUTE` for `authenticated` only (not `anon`, not
`public`). Each takes the caller from `auth.uid()`, never from an argument, and checks their seat
or couple itself.

| Function | Does |
| --- | --- |
| `create_room()` | Founds the caller's couple if needed, opens a room on the next level, seats them in slot 1 |
| `join_room(code)` | Locks the room row (`FOR UPDATE`), checks the code, expiry and capacity, joins the room's couple if the caller has none, seats them; joining again keeps the seat |
| `leave_room(room)` | Frees the seat; closes the room when nobody is left |
| `get_room_snapshot(room)` | Room, seated players with profiles, state and version (security invoker: RLS decides) |
| `start_level(room, level, restart)` | Only for levels the couple has unlocked; idempotent while the level is under way |
| `submit_puzzle_part(room, puzzle, value)` | One player's part; validated against the level's rule; solved when both parts are in (and match, for `agree`), mismatch counted and cleared; idempotent |
| `complete_level(room, level)` | Needs both players seated and every required puzzle solved on the server; stars = 3 − mismatches (min 1); keeps best stars and time; returns the next level and what is unlocked; idempotent |
| `get_couple_levels()` | Every level with unlocked/status/stars for the caller's couple (security invoker) |

Errors are raised by message (`room_not_found`, `room_full`, `couple_full`, `not_in_room`,
`level_locked`, `puzzles_unsolved`, ...); `src/online/protocol.ts` maps them to `OnlineError` keys
and Arabic text. Every failure that could reveal whether a code exists reads `room_not_found`.

## Row level security

RLS is on for all eight tables. Reads go through helpers in a `private` schema that the Data API
does not expose (`is_couple_member`, `can_see_room`, `can_see_profile`), so policies never
recurse:

- a player sees their own profile, their partner's, and whoever sits in a room with them;
- couples, members and progress are visible to that couple's members only;
- rooms, seats and room state are visible to players who sat in the room and to its couple;
- levels are readable by everyone.

Clients hold no `INSERT`/`UPDATE`/`DELETE` on anything but their own profile (column grants) and
their couple's name. Realtime: `realtime.messages` policies admit only players seated in the room
right now; `room:<id>` allows receive and send (Broadcast and Presence), `room-sync:<id>` receive
only, so everything on it came from the database (`realtime.send` inside the game functions).

## Environment

`.env.local` (git-ignored), see `.env.example`:

```
EXPO_PUBLIC_SUPABASE_URL=https://tepouugfevlyrlnwhyqm.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Only the URL and the publishable key, which are meant to ship in the app. Expo inlines them on a
phone; Vite injects them with `define` in the browser host; the tests read them from the file. No
secret or service-role key is used by the app or the tests. In the dashboard, **Authentication →
Sign In / Providers → Allow anonymous sign-ins** must be on: players never make an account.

## Commands

```bash
npx supabase login
```

```bash
npx supabase link --project-ref tepouugfevlyrlnwhyqm
```

```bash
npx supabase migration new <name>
```

```bash
npx supabase db push --linked --dry-run
```

```bash
npx supabase db push --linked
```

```bash
npx supabase migration list --linked
```

```bash
npm run db:types
```

```bash
npx supabase db advisors --linked --type all
```

```bash
npm run test:supabase
```

No Docker and no local database: migrations are written here, checked with a dry run and pushed
to the hosted development project.

## Verification (2026-10-26)

- Before any write: the project was empty (no tables, functions, policies or migration history in
  `public`, no users), so the migrations are purely additive.
- `db push` applied the four migrations; `migration list` shows local and remote in step.
- Remote check: RLS on all 8 tables, 13 policies (11 on tables, 2 on `realtime.messages`), all 8
  functions with an empty `search_path` and no `anon` execute, no client table-level writes,
  column writes only on `profiles` and `couples.display_name`, no private function executable by
  `anon`.
- `npm run test:supabase`: **21/21 passed** (twice in a row), then 0 users, couples, rooms or
  progress rows left:
  - rooms: A opens a room and gets a code; wrong, malformed and injection-like codes fail as
    `room_not_found`; B joins with the code typed as `abc-def`; a third player gets `room_full`;
  - privacy and authority: the stranger reads nothing from any table, profile or snapshot; cannot
    start, submit, complete or leave; direct writes to progress, membership, seats, rooms and room
    state fail with `42501`; a player cannot edit the partner's profile;
  - Realtime: both players join the private channel and see each other in Presence; the private
    channel refuses the stranger; A's movement and intention reach B (and not A);
  - puzzle: the level start reaches both; invalid values and unknown puzzles are refused; two
    different clinic days are a mismatch heard by both; the same day solves it, announced to both
    with the version;
  - progression: completion is refused while a puzzle is open, for the wrong level, and level 2
    cannot start early; completing level 1 gives 2 stars (one mismatch) and unlocks level 2 only;
    the stranger's own levels stay untouched; B drops, restarts with the kept session, gets the
    latest state and progress, rejoins, and both receive the next level transition;
  - leaving: a free seat does not let the stranger into the couple (`couple_full`); B returns to
    the same seat; the room closes when both leave and its code stops working.
- Advisors: no errors. Warnings kept on purpose: the six game functions are SECURITY DEFINER and
  executable by signed-in players (they are the API, each checks the caller itself), and eight
  policies apply to anonymous users (anonymous players are the game's players; every policy still
  checks membership). Unused-index notes are for indexes on foreign keys that real traffic will use.

## Not done yet

- **Supabase MCP**: added to `.mcp.json` but still pending approval in Claude Code, and the session
  that did this work could not load it, so everything above was inspected and verified through the
  Supabase CLI (`db query`, `db advisors`, `migration list`). Run `claude` in this folder, approve
  the server, then `/mcp` → supabase → Authenticate.
- **Not wired into the game yet**: no screen offers online rooms, and the Phaser levels do not yet
  report their joint actions through `submit_puzzle_part` / `complete_level`. The services and
  `RoomChannel` are ready for that; the LAN two-phone mode is unchanged.
- **On a phone**: the native app's use of `EXPO_PUBLIC_*` (inlined by Expo) and AsyncStorage for
  the session is typed and built, but online play has not been run on a device.
- The first private channel join on a new project can fail once with Realtime's
  `MissingPartition`; `RoomChannel` now waits for Realtime's own retry instead of giving up.
- Anonymous users accumulate; a scheduled cleanup of long-unused anonymous players is a later step.
