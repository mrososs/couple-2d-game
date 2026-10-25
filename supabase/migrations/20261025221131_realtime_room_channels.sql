-- Before We Become Three: who may use a room's Realtime channels.
--
-- Two private topics per room, both open only to the players seated in it right now:
--   room:<room id>       players send and receive here: movement snapshots, intentions, effects,
--                        and Presence (who is connected).
--   room-sync:<room id>  the server announces authoritative changes here (puzzle solved, level
--                        started or completed, who sits in the room). Players may only listen,
--                        so nothing on this topic can have come from a client.
-- Clients must join with `private: true`; Realtime then checks these policies on
-- realtime.messages when a player subscribes, tracks Presence or sends.

create function private.can_use_room_topic(p_topic text, p_send boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prefix text := split_part(p_topic, ':', 1);
  v_id text := substr(p_topic, char_length(v_prefix) + 2);
begin
  if not (v_prefix = 'room' or (v_prefix = 'room-sync' and not p_send)) then
    return false;
  end if;
  if v_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (
    select 1
    from public.room_players p
    join public.game_rooms r on r.id = p.room_id
    where p.room_id = v_id::uuid
      and p.user_id = (select auth.uid())
      and p.left_at is null
      and r.status <> 'closed'
  );
end;
$$;

revoke all on function private.can_use_room_topic(text, boolean) from public;
grant execute on function private.can_use_room_topic(text, boolean) to authenticated;

create policy "room players receive their room's messages" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and private.can_use_room_topic((select realtime.topic()), false)
  );

create policy "room players send to their room" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and private.can_use_room_topic((select realtime.topic()), true)
  );
