-- Before We Become Three: the game's persistent data.
--
-- Only what must outlive a play session is kept here: who the players are, which two of them form
-- a couple, the rooms they meet in, the levels and each couple's progress, and the shared puzzle
-- state of a room. Movement and other moment-to-moment play travel over Realtime and never touch a
-- table. Clients read through row level security; every change except a player's own profile goes
-- through the functions in the next migration, so no client can award itself progress or move
-- itself into another couple.

create schema if not exists private;
revoke all on schema private from public;
-- Row level security policies call a few helpers in this schema as the querying role. The schema
-- is not exposed through the Data API, so this grants nothing an API caller can reach directly.
grant usage on schema private to authenticated;

-- Levels ---------------------------------------------------------------------------------------

-- Published reference data: what each level is, the shared puzzles the server checks, and which
-- levels open it. The educational content itself (text, sources) stays in the game's code.
create table public.levels (
  id text primary key check (id ~ '^level[0-9]{2}$'),
  world_number smallint not null check (world_number > 0),
  level_number smallint not null check (level_number > 0),
  title text not null check (char_length(title) between 1 and 80),
  description text not null default '',
  educational_objective text not null,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  unlock_requirements jsonb not null default '{"completed": []}'::jsonb check (
    jsonb_typeof(unlock_requirements) = 'object'
    and jsonb_typeof(unlock_requirements -> 'completed') = 'array'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (world_number, level_number)
);

comment on table public.levels is
  'Level metadata and server-side puzzle rules. config.puzzles maps a puzzle key to its rule; config.required lists the puzzles a level needs solved.';

-- Players and couples ----------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  avatar_character text check (avatar_character in ('wife', 'husband')),
  avatar_outfit smallint not null default 0 check (avatar_outfit between 0 and 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.couples (
  id uuid primary key default gen_random_uuid(),
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 60),
  created_at timestamptz not null default now()
);

create table public.couple_members (
  couple_id uuid not null references public.couples (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'left')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (couple_id, user_id),
  constraint couple_members_left_at check ((status = 'left') = (left_at is not null))
);

-- A player belongs to one couple at a time.
create unique index couple_members_one_active_couple on public.couple_members (user_id) where status = 'active';
create index couple_members_user_idx on public.couple_members (user_id);

-- Rooms ------------------------------------------------------------------------------------------

create table public.game_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  couple_id uuid not null references public.couples (id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'active', 'closed')),
  current_level_id text not null references public.levels (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '6 hours',
  closed_at timestamptz,
  constraint game_rooms_closed_at check ((status = 'closed') = (closed_at is not null)),
  constraint game_rooms_expiry check (expires_at > created_at)
);

-- Codes are unique among open rooms, so a code can come round again once its room has closed.
create unique index game_rooms_open_code on public.game_rooms (code) where status <> 'closed';
create index game_rooms_owner_idx on public.game_rooms (owner_id);
create index game_rooms_couple_idx on public.game_rooms (couple_id);
create index game_rooms_level_idx on public.game_rooms (current_level_id);

create table public.room_players (
  room_id uuid not null references public.game_rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  slot smallint not null check (slot in (1, 2)),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (room_id, user_id)
);

-- Two seats per room, one player in each; a player sits in one room at a time.
create unique index room_players_active_slot on public.room_players (room_id, slot) where left_at is null;
create unique index room_players_one_active_room on public.room_players (user_id) where left_at is null;
create index room_players_user_idx on public.room_players (user_id);

-- The authoritative shared state of the level a room is playing: each shared puzzle, the parts
-- the players have submitted, and whether the level is complete. Changed only by the server.
create table public.room_state (
  room_id uuid primary key references public.game_rooms (id) on delete cascade,
  level_id text not null references public.levels (id),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  version bigint not null default 1 check (version > 0),
  level_started_at timestamptz,
  updated_at timestamptz not null default now()
);

create index room_state_level_idx on public.room_state (level_id);

-- Progress ---------------------------------------------------------------------------------------

create table public.level_progress (
  couple_id uuid not null references public.couples (id) on delete cascade,
  level_id text not null references public.levels (id),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  stars smallint check (stars between 1 and 3),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  best_duration_seconds integer check (best_duration_seconds >= 0),
  attempts integer not null default 0 check (attempts >= 0),
  completions integer not null default 0 check (completions >= 0),
  first_completed_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (couple_id, level_id),
  constraint level_progress_completed check ((status = 'completed') = (completed_at is not null and stars is not null))
);

create index level_progress_level_idx on public.level_progress (level_id);

-- Housekeeping triggers --------------------------------------------------------------------------

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger levels_touch before update on public.levels
  for each row execute function private.touch_updated_at();
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger level_progress_touch before update on public.level_progress
  for each row execute function private.touch_updated_at();
create trigger room_state_touch before update on public.room_state
  for each row execute function private.touch_updated_at();

-- A couple is two people. Writes come only from the game functions, which check this themselves;
-- the trigger is the last line, and it locks the couple so two joins cannot both slip under it.
create function private.enforce_couple_capacity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'active' then
    perform 1 from public.couples where id = new.couple_id for update;
    if (
      select count(*) from public.couple_members m
      where m.couple_id = new.couple_id and m.status = 'active' and m.user_id <> new.user_id
    ) >= 2 then
      raise exception 'couple_full' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger couple_members_capacity before insert or update of status on public.couple_members
  for each row execute function private.enforce_couple_capacity();

-- A room seats two, enforced the same way.
create function private.enforce_room_capacity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.left_at is null then
    perform 1 from public.game_rooms where id = new.room_id for update;
    if (
      select count(*) from public.room_players p
      where p.room_id = new.room_id and p.left_at is null and p.user_id <> new.user_id
    ) >= 2 then
      raise exception 'room_full' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger room_players_capacity before insert or update of left_at on public.room_players
  for each row execute function private.enforce_room_capacity();

revoke all on function private.touch_updated_at(), private.enforce_couple_capacity(), private.enforce_room_capacity() from public;

-- Access helpers for row level security -----------------------------------------------------------
-- SECURITY DEFINER so a policy on one table can look at another without recursing through that
-- table's own policies. Each answers a yes/no question about the calling user only.

create function private.my_couple_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.couple_id
  from public.couple_members m
  where m.user_id = (select auth.uid()) and m.status = 'active'
$$;

create function private.is_couple_member(p_couple_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.couple_members m
    where m.couple_id = p_couple_id and m.user_id = (select auth.uid()) and m.status = 'active'
  )
$$;

-- A room is visible to the players who have sat in it and to the couple it belongs to.
create function private.can_see_room(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_players p
    where p.room_id = p_room_id and p.user_id = (select auth.uid())
  ) or exists (
    select 1 from public.game_rooms r
    join public.couple_members m on m.couple_id = r.couple_id
    where r.id = p_room_id and m.user_id = (select auth.uid()) and m.status = 'active'
  )
$$;

-- A profile is visible to its owner, to their partner, and to whoever sits in a room with them.
create function private.can_see_profile(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id = (select auth.uid())
    or exists (
      select 1 from public.couple_members mine
      join public.couple_members theirs on theirs.couple_id = mine.couple_id
      where mine.user_id = (select auth.uid()) and mine.status = 'active'
        and theirs.user_id = p_user_id and theirs.status = 'active'
    )
    or exists (
      select 1 from public.room_players mine
      join public.room_players theirs on theirs.room_id = mine.room_id
      where mine.user_id = (select auth.uid()) and mine.left_at is null
        and theirs.user_id = p_user_id and theirs.left_at is null
    )
$$;

revoke all on function private.my_couple_id(), private.is_couple_member(uuid), private.can_see_room(uuid), private.can_see_profile(uuid) from public;
grant execute on function private.my_couple_id(), private.is_couple_member(uuid), private.can_see_room(uuid), private.can_see_profile(uuid) to authenticated;

-- Row level security -----------------------------------------------------------------------------

alter table public.levels enable row level security;
alter table public.profiles enable row level security;
alter table public.couples enable row level security;
alter table public.couple_members enable row level security;
alter table public.game_rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.room_state enable row level security;
alter table public.level_progress enable row level security;

create policy "levels are readable by everyone" on public.levels
  for select to anon, authenticated using (true);

create policy "players read profiles they may see" on public.profiles
  for select to authenticated using (private.can_see_profile(user_id));
create policy "players create their own profile" on public.profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "players edit their own profile" on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "members read their couple" on public.couples
  for select to authenticated using (private.is_couple_member(id));
create policy "members rename their couple" on public.couples
  for update to authenticated
  using (private.is_couple_member(id))
  with check (private.is_couple_member(id));

create policy "members read their couple's members" on public.couple_members
  for select to authenticated using (private.is_couple_member(couple_id));

create policy "players read rooms they may see" on public.game_rooms
  for select to authenticated using (private.can_see_room(id));

create policy "players read who sits in rooms they may see" on public.room_players
  for select to authenticated using (private.can_see_room(room_id));

create policy "players read the state of rooms they may see" on public.room_state
  for select to authenticated using (private.can_see_room(room_id));

create policy "members read their couple's progress" on public.level_progress
  for select to authenticated using (private.is_couple_member(couple_id));

-- Table privileges: read through the policies above; write only a player's own profile and their
-- couple's name. Everything else changes through the game functions.
revoke all on table
  public.levels, public.profiles, public.couples, public.couple_members,
  public.game_rooms, public.room_players, public.room_state, public.level_progress
  from anon, authenticated;

grant select on table public.levels to anon, authenticated;
grant select on table
  public.profiles, public.couples, public.couple_members,
  public.game_rooms, public.room_players, public.room_state, public.level_progress
  to authenticated;
grant insert (user_id, display_name, avatar_character, avatar_outfit) on table public.profiles to authenticated;
grant update (user_id, display_name, avatar_character, avatar_outfit) on table public.profiles to authenticated;
grant update (display_name) on table public.couples to authenticated;
