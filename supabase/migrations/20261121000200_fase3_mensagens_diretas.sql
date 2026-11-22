-- Resenha v3 — fase 3: mensagens diretas (1:1 e grupo)
-- Uma conversa direta é uma "sala" com kind = 'dm' (duas pessoas) ou 'group' (até 10).
-- Assim chat, reações, respostas, "digitando" e ligação funcionam igual às salas.
-- Pode rodar de novo sem problema.

alter table public.rooms add column if not exists kind text not null default 'room';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rooms_kind_check') then
    alter table public.rooms add constraint rooms_kind_check check (kind in ('room', 'dm', 'group'));
  end if;
end $$;
alter table public.rooms add column if not exists dm_key text;
create unique index if not exists rooms_dm_key_idx on public.rooms(dm_key) where dm_key is not null;

-- Convites só valem para salas (nunca para conversas diretas)
create or replace function public.join_room(p_room uuid default null::uuid, p_code text default null::text)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare v_uid uuid := (select auth.uid()); v_room public.rooms;
begin
  if v_uid is null then raise exception 'Faça login primeiro.'; end if;
  if p_code is not null then
    select * into v_room from public.rooms where invite_code = lower(trim(p_code)) and kind = 'room';
  else
    select * into v_room from public.rooms where id = p_room and is_public and kind = 'room';
  end if;
  if v_room.id is null then raise exception 'Convite inválido ou sala privada.'; end if;
  if exists (select 1 from public.room_bans where room_id = v_room.id and user_id = v_uid) then
    raise exception 'Você foi banido desta sala.';
  end if;
  insert into public.room_members (room_id, user_id) values (v_room.id, v_uid) on conflict do nothing;
  return v_room.id;
end;
$function$;

create or replace function public.invite_preview(p_code text)
returns table(room_id uuid, name text, is_public boolean, member_count bigint, already_member boolean, banned boolean)
language sql stable security definer set search_path to '' as $function$
  select r.id, r.name, r.is_public,
    (select count(*) from public.room_members m where m.room_id = r.id),
    exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = (select auth.uid())),
    exists (select 1 from public.room_bans b where b.room_id = r.id and b.user_id = (select auth.uid()))
  from public.rooms r where r.invite_code = lower(trim(p_code)) and r.kind = 'room';
$function$;

-- Só dá pra chamar no privado quem está em alguma sala com você
create or replace function public.shares_room(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.room_members m1
    join public.room_members m2 on m2.room_id = m1.room_id and m2.user_id = p_b
    join public.rooms r on r.id = m1.room_id and r.kind = 'room'
    where m1.user_id = p_a
  );
$$;

-- Abre (ou reabre) a conversa 1:1 com alguém
create or replace function public.open_dm(p_user uuid)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_key text;
  v_room uuid;
begin
  if v_uid is null then raise exception 'Faça login primeiro.'; end if;
  if p_user is null or p_user = v_uid then raise exception 'Escolha outra pessoa.'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Pessoa não encontrada.'; end if;
  v_key := least(v_uid::text, p_user::text) || ':' || greatest(v_uid::text, p_user::text);
  select id into v_room from public.rooms where dm_key = v_key;
  if v_room is null then
    if not public.shares_room(v_uid, p_user) then
      raise exception 'Vocês precisam estar em alguma sala juntos pra conversar no privado.';
    end if;
    insert into public.rooms (name, is_public, invite_code, owner_id, kind, dm_key)
    values ('Conversa', false, encode(extensions.gen_random_bytes(16), 'hex'), v_uid, 'dm', v_key)
    returning id into v_room;
  end if;
  insert into public.room_members (room_id, user_id) values (v_room, v_uid), (v_room, p_user) on conflict do nothing;
  return v_room;
end;
$$;

-- Cria um grupo privado (você + 2 a 9 pessoas)
create or replace function public.create_group_dm(p_users uuid[], p_name text default null)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_users uuid[];
  v_room uuid;
  v_name text := nullif(left(trim(coalesce(p_name, '')), 50), '');
  u uuid;
begin
  if v_uid is null then raise exception 'Faça login primeiro.'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_users from unnest(coalesce(p_users, '{}')) x where x <> v_uid;
  if array_length(v_users, 1) is null or array_length(v_users, 1) < 2 then raise exception 'Escolha pelo menos 2 pessoas.'; end if;
  if array_length(v_users, 1) > 9 then raise exception 'Um grupo tem no máximo 10 pessoas.'; end if;
  foreach u in array v_users loop
    if not public.shares_room(v_uid, u) then raise exception 'Só dá pra chamar pro grupo quem está em alguma sala com você.'; end if;
  end loop;
  insert into public.rooms (name, is_public, invite_code, owner_id, kind)
  values (coalesce(v_name, 'Grupo'), false, encode(extensions.gen_random_bytes(16), 'hex'), v_uid, 'group')
  returning id into v_room;
  insert into public.room_members (room_id, user_id, base_role) values (v_room, v_uid, 'owner');
  insert into public.room_members (room_id, user_id) select v_room, x from unnest(v_users) x on conflict do nothing;
  return v_room;
end;
$$;

-- Lista das minhas conversas diretas, com participantes e a última mensagem
create or replace function public.my_dm_list()
returns table(room_id uuid, kind text, name text, members jsonb, last_content text, last_kind text, last_user uuid, last_at timestamptz)
language sql stable security definer set search_path to '' as $$
  select r.id, r.kind, r.name,
    (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar', p.avatar_url)), '[]'::jsonb)
       from public.room_members m join public.profiles p on p.id = m.user_id where m.room_id = r.id),
    lm.content, lm.kind, lm.user_id, coalesce(lm.created_at, r.created_at)
  from public.rooms r
  join public.room_members me on me.room_id = r.id and me.user_id = (select auth.uid())
  left join lateral (
    select x.content, x.kind, x.user_id, x.created_at from public.messages x
    where x.room_id = r.id order by x.id desc limit 1
  ) lm on true
  where r.kind in ('dm', 'group')
  order by 8 desc
  limit 100;
$$;

revoke all on function public.shares_room(uuid, uuid) from public, anon;
grant execute on function public.open_dm(uuid) to authenticated;
grant execute on function public.create_group_dm(uuid[], text) to authenticated;
grant execute on function public.my_dm_list() to authenticated;
revoke execute on function public.open_dm(uuid) from anon;
revoke execute on function public.create_group_dm(uuid[], text) from anon;
revoke execute on function public.my_dm_list() from anon;
