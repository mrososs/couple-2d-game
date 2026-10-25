-- Before We Become Three: the game's server-side rules.
--
-- Every change to couples, rooms, shared puzzle state and progress happens in these functions.
-- The public ones are what the app calls (supabase.rpc); each checks the caller from auth.uid(),
-- never from an argument, runs in one transaction, and locks the row it decides on, so two phones
-- acting at once cannot both take the last seat or both advance a puzzle. They are SECURITY
-- DEFINER (the tables grant clients no writes), with an empty search_path and only `authenticated`
-- allowed to execute them. Authoritative changes are announced on the room's server-only Realtime
-- topic, `room-sync:<room id>`, which clients can receive but not send to.

-- Internal helpers -------------------------------------------------------------------------------

create function private.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  return v_user;
end;
$$;

-- Six characters from an alphabet without look-alikes (no I, O, 0 or 1): 32^6, about a billion
-- codes. The bytes come from gen_random_uuid(), whose first six bytes are fully random; 256 is a
-- multiple of 32, so taking each byte modulo 32 keeps every character equally likely.
create function private.random_room_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := uuid_send(gen_random_uuid());
  code text := '';
begin
  for i in 0..5 loop
    code := code || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return code;
end;
$$;

-- The seat the user holds in an open room, or an error if they hold none.
create function private.seat_of(p_room_id uuid, p_user_id uuid)
returns smallint
language plpgsql
stable
set search_path = ''
as $$
declare
  v_slot smallint;
begin
  select p.slot into v_slot
  from public.room_players p
  join public.game_rooms r on r.id = p.room_id
  where p.room_id = p_room_id and p.user_id = p_user_id and p.left_at is null and r.status <> 'closed';
  if v_slot is null then
    raise exception 'not_in_room' using errcode = '42501';
  end if;
  return v_slot;
end;
$$;

-- The couple the user belongs to, founding one with them in it if they have none.
create function private.ensure_couple(p_user_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_couple uuid;
begin
  select couple_id into v_couple from public.couple_members where user_id = p_user_id and status = 'active';
  if v_couple is null then
    insert into public.couples default values returning id into v_couple;
    insert into public.couple_members (couple_id, user_id) values (v_couple, p_user_id);
  end if;
  return v_couple;
end;
$$;

-- A level is open to a couple once every level in its unlock_requirements.completed is completed.
create function private.level_unlocked(p_couple_id uuid, p_level_id text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.levels where id = p_level_id)
    and not exists (
      select 1
      from public.levels l
      cross join lateral jsonb_array_elements_text(l.unlock_requirements -> 'completed') as req (level_id)
      where l.id = p_level_id
        and not exists (
          select 1 from public.level_progress lp
          where lp.couple_id = p_couple_id and lp.level_id = req.level_id and lp.status = 'completed'
        )
    )
$$;

-- The level a couple should play next: the first open level they have not completed, or, when
-- they have completed everything open, the last open level.
create function private.next_level_for(p_couple_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select l.id from public.levels l
      where private.level_unlocked(p_couple_id, l.id)
        and not exists (
          select 1 from public.level_progress lp
          where lp.couple_id = p_couple_id and lp.level_id = l.id and lp.status = 'completed'
        )
      order by l.world_number, l.level_number
      limit 1
    ),
    (
      select l.id from public.levels l
      where private.level_unlocked(p_couple_id, l.id)
      order by l.world_number desc, l.level_number desc
      limit 1
    )
  )
$$;

-- The state a level starts from: every shared puzzle open, nothing submitted, no mistakes yet.
create function private.fresh_level_state(p_level_id text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'puzzles', coalesce((
      select jsonb_object_agg(key, jsonb_build_object('status', 'open', 'parts', '{}'::jsonb, 'attempts', 0))
      from public.levels l
      cross join lateral jsonb_object_keys(l.config -> 'puzzles') as key
      where l.id = p_level_id
    ), '{}'::jsonb),
    'failed_attempts', 0,
    'completed', false
  )
$$;

-- Whether a submitted value fits a puzzle's rule: one of its options, a whole number in its range,
-- or, for puzzles the two simply do together, `true`.
create function private.puzzle_value_ok(p_rule jsonb, p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_number numeric;
begin
  if p_value is null then
    return false;
  elsif p_rule ? 'options' then
    return (p_rule -> 'options') @> jsonb_build_array(p_value);
  elsif p_rule ? 'range' then
    if jsonb_typeof(p_value) <> 'number' then
      return false;
    end if;
    v_number := (p_value #>> '{}')::numeric;
    return v_number = trunc(v_number)
      and v_number between (p_rule -> 'range' ->> 0)::numeric and (p_rule -> 'range' ->> 1)::numeric;
  else
    return p_value = 'true'::jsonb;
  end if;
end;
$$;

-- Announces an authoritative change on the room's server-only topic.
create function private.notify_room(p_room_id uuid, p_event text, p_payload jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform realtime.send(p_payload, p_event, 'room-sync:' || p_room_id::text, true);
end;
$$;

-- Sets a room's status from how many players sit in it, and tells the room who is there.
create function private.settle_room(p_room_id uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
  v_status text;
begin
  select count(*) into v_count from public.room_players where room_id = p_room_id and left_at is null;
  v_status := case v_count when 0 then 'closed' when 1 then 'waiting' else 'active' end;
  update public.game_rooms
  set status = v_status,
      closed_at = case when v_status = 'closed' then now() end
  where id = p_room_id and status <> 'closed';
  perform private.notify_room(p_room_id, 'members', jsonb_build_object(
    'room_id', p_room_id,
    'status', v_status,
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object('user_id', p.user_id, 'slot', p.slot) order by p.slot), '[]'::jsonb)
      from public.room_players p
      where p.room_id = p_room_id and p.left_at is null
    )
  ));
  return v_status;
end;
$$;

-- Takes the user out of every room they still sit in except p_keep, closing rooms left empty.
create function private.vacate_rooms(p_user_id uuid, p_keep uuid default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_room uuid;
begin
  for v_room in
    update public.room_players set left_at = now()
    where user_id = p_user_id and left_at is null and room_id is distinct from p_keep
    returning room_id
  loop
    perform private.settle_room(v_room);
  end loop;
end;
$$;

revoke all on function
  private.require_user(), private.random_room_code(), private.seat_of(uuid, uuid),
  private.ensure_couple(uuid), private.level_unlocked(uuid, text), private.next_level_for(uuid),
  private.fresh_level_state(text), private.puzzle_value_ok(jsonb, jsonb),
  private.notify_room(uuid, text, jsonb), private.settle_room(uuid), private.vacate_rooms(uuid, uuid)
  from public;
-- get_couple_levels runs as the caller and asks this one question about the caller's own couple.
grant execute on function private.level_unlocked(uuid, text) to authenticated;

-- Rooms ------------------------------------------------------------------------------------------

-- Opens a room for the caller's couple (founding the couple if this is their first room) on the
-- level they should play next, and seats the caller in slot 1. Leaves any room they were in.
create function public.create_room()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_user();
  v_couple uuid;
  v_level text;
  v_room public.game_rooms;
begin
  perform private.vacate_rooms(v_user);
  v_couple := private.ensure_couple(v_user);
  v_level := private.next_level_for(v_couple);
  for attempt in 1..8 loop
    begin
      insert into public.game_rooms (code, owner_id, couple_id, current_level_id)
      values (private.random_room_code(), v_user, v_couple, v_level)
      returning * into v_room;
      exit;
    exception when unique_violation then
      if attempt = 8 then
        raise exception 'room_code_exhausted' using errcode = 'P0001';
      end if;
    end;
  end loop;
  insert into public.room_players (room_id, user_id, slot) values (v_room.id, v_user, 1);
  insert into public.room_state (room_id, level_id, state) values (v_room.id, v_level, private.fresh_level_state(v_level));
  return jsonb_build_object(
    'room_id', v_room.id, 'code', v_room.code, 'slot', 1, 'couple_id', v_couple,
    'level_id', v_level, 'status', v_room.status, 'expires_at', v_room.expires_at
  );
end;
$$;

-- Seats the caller in the open room with this code. The partner who joins a room for the first
-- time becomes the other half of its couple; someone already in a different couple, or a third
-- person, is turned away. Joining again (after a dropped connection) keeps the same seat. Every
-- failure that could reveal whether a code exists reads `room_not_found`.
create function public.join_room(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_user();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_room public.game_rooms;
  v_my_couple uuid;
  v_slot smallint;
  v_status text;
begin
  if v_code !~ '^[A-HJ-NP-Z2-9]{6}$' then
    raise exception 'room_not_found' using errcode = 'P0002';
  end if;
  -- Locking the room serialises joins: two players racing for its last seat cannot both get it.
  select * into v_room from public.game_rooms where code = v_code and status <> 'closed' for update;
  if not found or v_room.expires_at <= now() then
    raise exception 'room_not_found' using errcode = 'P0002';
  end if;

  select slot into v_slot from public.room_players
  where room_id = v_room.id and user_id = v_user and left_at is null;

  if v_slot is null then
    if (select count(*) from public.room_players where room_id = v_room.id and left_at is null) >= 2 then
      raise exception 'room_full' using errcode = 'P0001';
    end if;
    select couple_id into v_my_couple from public.couple_members where user_id = v_user and status = 'active';
    if v_my_couple is null then
      insert into public.couple_members (couple_id, user_id) values (v_room.couple_id, v_user)
      on conflict (couple_id, user_id) do update set status = 'active', left_at = null, joined_at = now();
    elsif v_my_couple <> v_room.couple_id then
      raise exception 'different_couple' using errcode = 'P0001';
    end if;
    perform private.vacate_rooms(v_user, v_room.id);
    v_slot := case
      when exists (select 1 from public.room_players where room_id = v_room.id and slot = 1 and left_at is null) then 2
      else 1
    end;
    insert into public.room_players (room_id, user_id, slot) values (v_room.id, v_user, v_slot)
    on conflict (room_id, user_id) do update set slot = excluded.slot, left_at = null, joined_at = now();
  end if;

  v_status := private.settle_room(v_room.id);
  return jsonb_build_object(
    'room_id', v_room.id, 'code', v_room.code, 'slot', v_slot, 'couple_id', v_room.couple_id,
    'level_id', v_room.current_level_id, 'status', v_status, 'expires_at', v_room.expires_at
  );
end;
$$;

-- Gets the caller up from their seat. The room closes when nobody is left in it. Leaving twice is
-- harmless; a room the caller never sat in reads as not found.
create function public.leave_room(p_room_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_user();
  v_status text;
begin
  if not exists (select 1 from public.room_players where room_id = p_room_id and user_id = v_user) then
    raise exception 'room_not_found' using errcode = 'P0002';
  end if;
  perform 1 from public.game_rooms where id = p_room_id for update;
  update public.room_players set left_at = now()
  where room_id = p_room_id and user_id = v_user and left_at is null;
  if found then
    v_status := private.settle_room(p_room_id);
  else
    select status into v_status from public.game_rooms where id = p_room_id;
  end if;
  return jsonb_build_object('room_id', p_room_id, 'left', true, 'status', v_status);
end;
$$;

-- What a player who (re)connects needs to catch up: the room, who sits in it, and the shared
-- state with its version. Runs as the caller, so row level security decides what it can see; a
-- room the caller may not see comes back as null.
create function public.get_room_snapshot(p_room_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'room', jsonb_build_object(
      'id', r.id, 'code', r.code, 'owner_id', r.owner_id, 'couple_id', r.couple_id, 'status', r.status,
      'current_level_id', r.current_level_id, 'created_at', r.created_at, 'expires_at', r.expires_at
    ),
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', p.user_id, 'slot', p.slot, 'joined_at', p.joined_at,
        'display_name', pr.display_name, 'avatar_character', pr.avatar_character, 'avatar_outfit', pr.avatar_outfit
      ) order by p.slot), '[]'::jsonb)
      from public.room_players p
      left join public.profiles pr on pr.user_id = p.user_id
      where p.room_id = r.id and p.left_at is null
    ),
    'state', (
      select jsonb_build_object(
        'level_id', s.level_id, 'state', s.state, 'version', s.version,
        'level_started_at', s.level_started_at, 'updated_at', s.updated_at
      )
      from public.room_state s
      where s.room_id = r.id
    )
  )
  from public.game_rooms r
  where r.id = p_room_id
$$;

-- Levels and puzzles -----------------------------------------------------------------------------

-- Starts (or, with p_restart, restarts) a level in the room, if the room's couple has opened it.
-- Calling it for the level already under way returns that level as it stands, so both phones may
-- call it when the level opens.
create function public.start_level(p_room_id uuid, p_level_id text, p_restart boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_user();
  v_room public.game_rooms;
  v_state public.room_state;
begin
  perform private.seat_of(p_room_id, v_user);
  select * into v_room from public.game_rooms where id = p_room_id for update;
  if not private.level_unlocked(v_room.couple_id, p_level_id) then
    raise exception 'level_locked' using errcode = '42501';
  end if;
  select * into v_state from public.room_state where room_id = p_room_id for update;
  if not p_restart and v_state.level_id = p_level_id and v_state.level_started_at is not null
     and not coalesce((v_state.state ->> 'completed')::boolean, false) then
    return jsonb_build_object('room_id', p_room_id, 'level_id', p_level_id, 'version', v_state.version,
      'started_at', v_state.level_started_at, 'changed', false);
  end if;
  update public.game_rooms set current_level_id = p_level_id where id = p_room_id;
  update public.room_state
  set level_id = p_level_id, state = private.fresh_level_state(p_level_id),
      version = version + 1, level_started_at = now()
  where room_id = p_room_id
  returning * into v_state;
  insert into public.level_progress as lp (couple_id, level_id, attempts)
  values (v_room.couple_id, p_level_id, 1)
  on conflict (couple_id, level_id) do update set attempts = lp.attempts + 1;
  perform private.notify_room(p_room_id, 'level', jsonb_build_object(
    'version', v_state.version, 'level_id', p_level_id, 'started_at', v_state.level_started_at));
  return jsonb_build_object('room_id', p_room_id, 'level_id', p_level_id, 'version', v_state.version,
    'started_at', v_state.level_started_at, 'changed', true);
end;
$$;

-- One player's part of a shared puzzle. A puzzle is solved when both seats have submitted: for an
-- `agree` puzzle (both pin the same clinic day, both work out the same change) the two values must
-- match, and a mismatch clears both parts and counts as a failed attempt; a `together` puzzle (both
-- lift the cot) needs both parts and nothing more. The values are checked against the level's
-- rule, and nothing is revealed about the partner's part until both are in. Submitting the same
-- part again, or a part of a puzzle already solved, changes nothing.
create function public.submit_puzzle_part(p_room_id uuid, p_puzzle text, p_value jsonb default 'true'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_user();
  v_slot smallint;
  v_state public.room_state;
  v_rule jsonb;
  v_puzzle jsonb;
  v_parts jsonb;
  v_attempts integer;
  v_result text := 'waiting';
begin
  v_slot := private.seat_of(p_room_id, v_user);
  select * into v_state from public.room_state where room_id = p_room_id for update;
  select l.config -> 'puzzles' -> p_puzzle into v_rule from public.levels l where l.id = v_state.level_id;
  if v_rule is null then
    raise exception 'unknown_puzzle' using errcode = 'P0001';
  end if;
  if not private.puzzle_value_ok(v_rule, p_value) then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  if coalesce((v_state.state ->> 'completed')::boolean, false) then
    raise exception 'level_already_completed' using errcode = 'P0001';
  end if;

  v_puzzle := v_state.state -> 'puzzles' -> p_puzzle;
  if v_puzzle ->> 'status' = 'solved' then
    return jsonb_build_object('puzzle', p_puzzle, 'status', 'solved', 'version', v_state.version, 'changed', false);
  end if;
  if v_puzzle -> 'parts' -> v_slot::text = p_value then
    return jsonb_build_object('puzzle', p_puzzle, 'status', 'waiting', 'version', v_state.version, 'changed', false);
  end if;

  v_parts := coalesce(v_puzzle -> 'parts', '{}'::jsonb) || jsonb_build_object(v_slot::text, p_value);
  v_attempts := coalesce((v_puzzle ->> 'attempts')::integer, 0);
  if v_parts ? '1' and v_parts ? '2' then
    v_attempts := v_attempts + 1;
    v_result := case
      when v_rule ->> 'rule' = 'agree' and v_parts -> '1' <> v_parts -> '2' then 'mismatch'
      else 'solved'
    end;
  end if;

  v_puzzle := case v_result
    when 'solved' then jsonb_build_object('status', 'solved', 'parts', v_parts, 'attempts', v_attempts,
      'value', v_parts -> '1', 'solved_at', now())
    when 'mismatch' then jsonb_build_object('status', 'open', 'parts', '{}'::jsonb, 'attempts', v_attempts,
      'last_mismatch', v_parts)
    else jsonb_build_object('status', 'open', 'parts', v_parts, 'attempts', v_attempts)
  end;

  update public.room_state
  set state = jsonb_set(state, array['puzzles', p_puzzle], v_puzzle)
        || case when v_result = 'mismatch'
             then jsonb_build_object('failed_attempts', coalesce((state ->> 'failed_attempts')::integer, 0) + 1)
             else '{}'::jsonb end,
      version = version + 1
  where room_id = p_room_id
  returning * into v_state;

  perform private.notify_room(p_room_id, 'puzzle', jsonb_build_object(
    'version', v_state.version, 'puzzle', p_puzzle, 'status', v_result, 'by_slot', v_slot,
    'value', case when v_result = 'solved' then v_puzzle -> 'value' end,
    'mismatch', case when v_result = 'mismatch' then v_parts end
  ));
  return jsonb_build_object('puzzle', p_puzzle, 'status', v_result, 'version', v_state.version, 'changed', true,
    'mismatch', case when v_result = 'mismatch' then v_parts end);
end;
$$;

-- Completes the room's level for its couple: only with both players seated and every required
-- puzzle solved on the server. Stars come from the mistakes the server counted, not from the
-- client. The couple keeps its best stars and best time; the next level opens through its unlock
-- requirements. Completing again returns the same result.
create function public.complete_level(p_room_id uuid, p_level_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_user();
  v_room public.game_rooms;
  v_state public.room_state;
  v_missing text[];
  v_failed integer;
  v_stars smallint;
  v_duration integer;
  v_progress public.level_progress;
  v_result jsonb;
begin
  perform private.seat_of(p_room_id, v_user);
  select * into v_room from public.game_rooms where id = p_room_id;
  select * into v_state from public.room_state where room_id = p_room_id for update;
  if v_state.level_id <> p_level_id then
    raise exception 'level_not_active' using errcode = 'P0001';
  end if;
  if coalesce((v_state.state ->> 'completed')::boolean, false) then
    return (v_state.state -> 'result') || jsonb_build_object('version', v_state.version, 'changed', false);
  end if;
  if (select count(*) from public.room_players where room_id = p_room_id and left_at is null) < 2 then
    raise exception 'partner_missing' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(req.key), '{}') into v_missing
  from public.levels l
  cross join lateral jsonb_array_elements_text(l.config -> 'required') as req (key)
  where l.id = p_level_id
    and coalesce(v_state.state -> 'puzzles' -> req.key ->> 'status', 'open') <> 'solved';
  if cardinality(v_missing) > 0 then
    raise exception 'puzzles_unsolved' using errcode = 'P0001', detail = array_to_string(v_missing, ',');
  end if;

  v_failed := coalesce((v_state.state ->> 'failed_attempts')::integer, 0);
  v_stars := greatest(1, 3 - v_failed);
  v_duration := greatest(0, floor(extract(epoch from now() - coalesce(v_state.level_started_at, v_room.created_at))))::integer;

  insert into public.level_progress as lp (
    couple_id, level_id, status, stars, best_duration_seconds, attempts, completions,
    first_completed_at, completed_at, result
  )
  values (
    v_room.couple_id, p_level_id, 'completed', v_stars, v_duration, 1, 1, now(), now(),
    jsonb_build_object('stars', v_stars, 'failed_attempts', v_failed, 'duration_seconds', v_duration)
  )
  on conflict (couple_id, level_id) do update set
    status = 'completed',
    stars = greatest(coalesce(lp.stars, 0), excluded.stars),
    best_duration_seconds = least(coalesce(lp.best_duration_seconds, excluded.best_duration_seconds), excluded.best_duration_seconds),
    completions = lp.completions + 1,
    first_completed_at = coalesce(lp.first_completed_at, now()),
    completed_at = now(),
    result = excluded.result
  returning * into v_progress;

  v_result := jsonb_build_object(
    'level_id', p_level_id,
    'stars', v_stars,
    'best_stars', v_progress.stars,
    'duration_seconds', v_duration,
    'failed_attempts', v_failed,
    'next_level_id', private.next_level_for(v_room.couple_id),
    'unlocked', (
      select coalesce(jsonb_agg(l.id order by l.world_number, l.level_number), '[]'::jsonb)
      from public.levels l
      where private.level_unlocked(v_room.couple_id, l.id)
    )
  );

  update public.room_state
  set state = state || jsonb_build_object('completed', true, 'result', v_result),
      version = version + 1
  where room_id = p_room_id
  returning * into v_state;

  perform private.notify_room(p_room_id, 'complete', v_result || jsonb_build_object('version', v_state.version));
  return v_result || jsonb_build_object('version', v_state.version, 'changed', true);
end;
$$;

-- Every level with whether the caller's couple has opened it and how they did. Runs as the caller,
-- so it can only ever read the caller's own couple's progress. A player with no couple yet sees the
-- levels that need nothing to open.
create function public.get_couple_levels()
returns table (
  level_id text,
  world_number smallint,
  level_number smallint,
  title text,
  description text,
  educational_objective text,
  config jsonb,
  unlocked boolean,
  status text,
  stars smallint,
  best_duration_seconds integer,
  completed_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with mine as (select private.my_couple_id() as couple_id)
  select
    l.id, l.world_number, l.level_number, l.title, l.description, l.educational_objective, l.config,
    case
      when mine.couple_id is null then jsonb_array_length(l.unlock_requirements -> 'completed') = 0
      else private.level_unlocked(mine.couple_id, l.id)
    end,
    coalesce(lp.status, 'not_started'),
    lp.stars,
    lp.best_duration_seconds,
    lp.completed_at
  from public.levels l
  cross join mine
  left join public.level_progress lp on lp.level_id = l.id and lp.couple_id = mine.couple_id
  order by l.world_number, l.level_number
$$;

revoke all on function
  public.create_room(), public.join_room(text), public.leave_room(uuid), public.get_room_snapshot(uuid),
  public.start_level(uuid, text, boolean), public.submit_puzzle_part(uuid, text, jsonb),
  public.complete_level(uuid, text), public.get_couple_levels()
  from public, anon;
grant execute on function
  public.create_room(), public.join_room(text), public.leave_room(uuid), public.get_room_snapshot(uuid),
  public.start_level(uuid, text, boolean), public.submit_puzzle_part(uuid, text, jsonb),
  public.complete_level(uuid, text), public.get_couple_levels()
  to authenticated;
