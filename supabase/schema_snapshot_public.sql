--
-- PostgreSQL database dump
--

\restrict 2jT4HQc4ZyFgFatHZgga2SSlJzwZJkDeKAF8MGfNwwWaHOdMxQ0ynNLA6yWnU6U

-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: base_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.base_role AS ENUM (
    'owner',
    'moderator',
    'member'
);


--
-- Name: assign_role(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_role(p_room uuid, p_user uuid, p_role uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_r public.room_roles;
begin
  if not public.can_act_on(p_room, p_user, 'manage_roles') then
    raise exception 'Você não pode mudar o cargo dessa pessoa.';
  end if;
  if p_role is not null then
    select * into v_r from public.room_roles where id = p_role and room_id = p_room;
    if v_r.id is null then raise exception 'Cargo não encontrado nesta sala.'; end if;
    perform public.check_role_perms(p_room, v_r.can_kick, v_r.can_ban, v_r.can_manage_roles, v_r.can_delete_messages);
  end if;
  update public.room_members set role_id = p_role where room_id = p_room and user_id = p_user;
end;
$$;


--
-- Name: award_badges(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.award_badges(p_user uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  p public.profiles;
  s public.user_stats;
begin
  select * into p from public.profiles where id = p_user;
  if p.id is null then return; end if;
  insert into public.user_stats (user_id) values (p_user) on conflict do nothing;
  select * into s from public.user_stats where user_id = p_user;

  insert into public.user_badges (user_id, badge_id)
  select p_user, b.id from public.badges b
  where (
       (b.id = 'fundador'      and p.created_at < timestamptz '2026-12-01 00:00:00-03')
    or (b.id = 'veterano-1m'   and p.created_at <= now() - interval '1 month')
    or (b.id = 'veterano-6m'   and p.created_at <= now() - interval '6 months')
    or (b.id = 'veterano-1a'   and p.created_at <= now() - interval '1 year')
    or (b.id = 'papo-longo'    and s.call_seconds >= 36000)
    or (b.id = 'tagarela'      and s.messages_sent >= 300)
    or (b.id = 'coruja'        and s.night_messages >= 20)
    or (b.id = 'madrugador'    and s.morning_messages >= 20)
    or (b.id = 'apresentador'  and s.first_share_at is not null)
    or (b.id = 'cineasta'      and s.screen_seconds >= 18000)
    or (b.id = 'personalizado' and p.avatar_url is not null and p.banner_url is not null)
  )
  on conflict do nothing;
end;
$$;


--
-- Name: ban_member(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ban_member(p_room uuid, p_user uuid, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.can_act_on(p_room, p_user, 'ban') then
    raise exception 'Você não tem permissão para banir essa pessoa.';
  end if;
  insert into public.room_bans (room_id, user_id, banned_by, reason)
  values (p_room, p_user, (select auth.uid()), left(p_reason, 200))
  on conflict (room_id, user_id) do update set reason = excluded.reason, banned_by = excluded.banned_by, created_at = now();
  delete from public.room_members where room_id = p_room and user_id = p_user;
end;
$$;


--
-- Name: bot_draw(uuid, text, uuid[], text[], integer, integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bot_draw(p_room uuid, p_kind text, p_people uuid[] DEFAULT '{}'::uuid[], p_items text[] DEFAULT '{}'::text[], p_count integer DEFAULT 1, p_min integer DEFAULT 1, p_max integer DEFAULT 6, p_title text DEFAULT NULL::text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
  v_title text := nullif(left(trim(coalesce(p_title, '')), 60), '');
  v_people jsonb;
  v_guests jsonb;
  v_pool jsonb;
  v_arr jsonb[];
  v_n int;
  v_count int := coalesce(p_count, 1);
  v_result jsonb;
  v_text text;
  v_id bigint;
  t int;
begin
  if v_uid is null then raise exception 'Faça login primeiro.'; end if;
  if not public.is_room_member(p_room) then raise exception 'Você não é membro desta sala.'; end if;
  if p_kind not in ('teams', 'people', 'items', 'order', 'dice', 'coin', 'number') then
    raise exception 'Tipo de sorteio inválido.';
  end if;
  if coalesce(array_length(p_items, 1), 0) > 50 or coalesce(array_length(p_people, 1), 0) > 60 then
    raise exception 'Lista grande demais (máximo 50 itens e 60 pessoas).';
  end if;

  -- Monta a lista de participantes ou opções
  if p_kind in ('teams', 'people', 'items', 'order') then
    select coalesce(jsonb_agg(jsonb_build_object('id', m.user_id, 'name', p.display_name)), '[]'::jsonb) into v_people
    from public.room_members m join public.profiles p on p.id = m.user_id
    where m.room_id = p_room and m.user_id = any(coalesce(p_people, '{}'));
    select coalesce(jsonb_agg(jsonb_build_object('name', left(trim(x), 40))), '[]'::jsonb) into v_guests
    from unnest(coalesce(p_items, '{}')) x where trim(x) <> '';
    v_pool := case when p_kind = 'items' then v_guests else v_people || v_guests end;
    v_n := jsonb_array_length(v_pool);
    select array_agg(e order by random()) into v_arr from jsonb_array_elements(v_pool) e;
  end if;

  if p_kind = 'teams' then
    if v_n < 2 then raise exception 'Escolha pelo menos 2 pessoas.'; end if;
    if v_count < 2 or v_count > least(10, v_n) then raise exception 'Número de times inválido (de 2 até o número de pessoas, máximo 10).'; end if;
    v_result := '[]'::jsonb;
    for t in 1..v_count loop
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'name', 'Time ' || t,
        'players', (select coalesce(jsonb_agg(v_arr[i] order by i), '[]'::jsonb) from generate_series(t, v_n, v_count) i)
      ));
    end loop;
    v_text := '⚔️ Times sorteados';

  elsif p_kind in ('people', 'items') then
    if v_n < 1 then raise exception 'A lista está vazia.'; end if;
    if v_count < 1 or v_count > least(20, v_n) then raise exception 'Quantidade inválida para sortear.'; end if;
    v_result := (select jsonb_agg(v_arr[i] order by i) from generate_series(1, v_count) i);
    v_text := case when p_kind = 'people' then '🎉 Sorteado: ' else '🎯 Escolhido: ' end
      || (select string_agg(v_arr[i]->>'name', ', ' order by i) from generate_series(1, v_count) i);

  elsif p_kind = 'order' then
    if v_n < 2 then raise exception 'Coloque pelo menos 2 itens para embaralhar.'; end if;
    v_result := to_jsonb(v_arr);
    v_text := '🔀 Ordem sorteada: ' || (select string_agg(e->>'name', ', ') from unnest(v_arr) e);

  elsif p_kind = 'dice' then
    if v_count < 1 or v_count > 10 then raise exception 'Dá para rolar de 1 a 10 dados.'; end if;
    if p_max < 2 or p_max > 1000 then raise exception 'O dado precisa ter de 2 a 1000 lados.'; end if;
    v_result := (select jsonb_agg(floor(random() * p_max)::int + 1) from generate_series(1, v_count));
    v_text := '🎲 Dado (' || v_count || 'd' || p_max || '): '
      || (select string_agg(x::text, ' + ') from jsonb_array_elements_text(v_result) x)
      || case when v_count > 1 then ' = ' || (select sum(x::int) from jsonb_array_elements_text(v_result) x) else '' end;
    v_result := jsonb_build_object('rolls', v_result, 'sides', p_max);

  elsif p_kind = 'coin' then
    if v_count < 1 or v_count > 10 then raise exception 'Dá para jogar de 1 a 10 moedas.'; end if;
    v_result := (select jsonb_agg(case when random() < 0.5 then 'Cara' else 'Coroa' end) from generate_series(1, v_count));
    v_text := '🪙 Moeda: ' || (select string_agg(x, ', ') from jsonb_array_elements_text(v_result) x);

  elsif p_kind = 'number' then
    if p_min >= p_max then raise exception 'O mínimo precisa ser menor que o máximo.'; end if;
    if p_min < -1000000000 or p_max > 1000000000 then raise exception 'Use números entre -1 bilhão e 1 bilhão.'; end if;
    if v_count < 1 or v_count > 10 then raise exception 'Dá para sortear de 1 a 10 números.'; end if;
    v_result := (select jsonb_agg(p_min::bigint + floor(random() * (p_max::bigint - p_min + 1))::bigint) from generate_series(1, v_count));
    v_text := '🔢 Número (' || p_min || ' a ' || p_max || '): ' || (select string_agg(x, ', ') from jsonb_array_elements_text(v_result) x);
    v_result := jsonb_build_object('numbers', v_result, 'min', p_min, 'max', p_max);
  end if;

  if v_title is not null then v_text := v_title || ' — ' || v_text; end if;

  insert into public.messages (room_id, user_id, content, kind, payload)
  values (
    p_room, v_uid, left(v_text, 2000), 'bot',
    jsonb_build_object('type', p_kind, 'title', v_title, 'result', v_result, 'total', v_n)
  )
  returning id into v_id;
  return v_id;
end;
$$;


--
-- Name: call_access(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.call_access(p_room uuid) RETURNS TABLE(allowed boolean, display_name text, base_role public.base_role)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select true, p.display_name, m.base_role
  from public.room_members m join public.profiles p on p.id = m.user_id
  where m.room_id = p_room and m.user_id = (select auth.uid());
$$;


--
-- Name: call_heartbeat(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.call_heartbeat(p_sharing boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
  v_last timestamptz;
begin
  if v_uid is null then return; end if;
  insert into public.user_stats (user_id) values (v_uid) on conflict do nothing;
  select last_call_ping into v_last from public.user_stats where user_id = v_uid;
  -- no máximo 1 minuto contado a cada 55 segundos (evita contar em dobro)
  if v_last is not null and v_last > now() - interval '55 seconds' then return; end if;
  update public.user_stats set
    call_seconds = call_seconds + 60,
    screen_seconds = screen_seconds + case when p_sharing then 60 else 0 end,
    first_share_at = case when p_sharing then coalesce(first_share_at, now()) else first_share_at end,
    last_call_ping = now(),
    updated_at = now()
  where user_id = v_uid;
  perform public.award_badges(v_uid);
end;
$$;


--
-- Name: can_act_on(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_act_on(p_room uuid, p_target uuid, p_perm text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_rank int;
  v_target_rank int;
begin
  if v_actor is null or v_actor = p_target then return false; end if;
  if not public.user_has_perm(p_room, v_actor, p_perm) then return false; end if;
  v_actor_rank := public.member_rank(p_room, v_actor);
  v_target_rank := public.member_rank(p_room, p_target);
  if v_target_rank = 3 then return false; end if;
  return v_actor_rank > v_target_rank or v_target_rank <= 1;
end;
$$;


--
-- Name: check_my_badges(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_my_badges() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if (select auth.uid()) is null then return; end if;
  perform public.award_badges((select auth.uid()));
end;
$$;


--
-- Name: check_reply_same_room(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_reply_same_room() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.reply_to is not null and not exists (
    select 1 from public.messages m where m.id = new.reply_to and m.room_id = new.room_id
  ) then
    new.reply_to := null;
  end if;
  return new;
end;
$$;


--
-- Name: check_role_perms(uuid, boolean, boolean, boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_role_perms(p_room uuid, p_kick boolean, p_ban boolean, p_manage boolean, p_delete boolean) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_uid uuid := (select auth.uid());
begin
  if not public.user_has_perm(p_room, v_uid, 'manage_roles') then
    raise exception 'Você não tem permissão para gerenciar cargos.';
  end if;
  if (p_kick and not public.user_has_perm(p_room, v_uid, 'kick'))
     or (p_ban and not public.user_has_perm(p_room, v_uid, 'ban'))
     or (p_delete and not public.user_has_perm(p_room, v_uid, 'delete_messages')) then
    raise exception 'Você não pode dar permissões que não tem.';
  end if;
end;
$$;


--
-- Name: create_group_dm(uuid[], text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_group_dm(p_users uuid[], p_name text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: room_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#99aab5'::text NOT NULL,
    can_kick boolean DEFAULT false NOT NULL,
    can_ban boolean DEFAULT false NOT NULL,
    can_manage_roles boolean DEFAULT false NOT NULL,
    can_delete_messages boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT room_roles_color_check CHECK ((color ~ '^#[0-9a-fA-F]{6}$'::text)),
    CONSTRAINT room_roles_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 32)))
);


--
-- Name: create_role(uuid, text, text, boolean, boolean, boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_role(p_room uuid, p_name text, p_color text, p_kick boolean DEFAULT false, p_ban boolean DEFAULT false, p_manage boolean DEFAULT false, p_delete boolean DEFAULT false) RETURNS public.room_roles
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_role public.room_roles;
begin
  perform public.check_role_perms(p_room, p_kick, p_ban, p_manage, p_delete);
  if (select count(*) from public.room_roles where room_id = p_room) >= 30 then
    raise exception 'Limite de 30 cargos por sala.';
  end if;
  insert into public.room_roles (room_id, name, color, can_kick, can_ban, can_manage_roles, can_delete_messages)
  values (p_room, trim(p_name), lower(p_color), p_kick, p_ban, p_manage, p_delete)
  returning * into v_role;
  return v_role;
end;
$$;


--
-- Name: rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_public boolean DEFAULT false NOT NULL,
    invite_code text DEFAULT encode(extensions.gen_random_bytes(6), 'hex'::text) NOT NULL,
    owner_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text DEFAULT 'room'::text NOT NULL,
    dm_key text,
    CONSTRAINT rooms_kind_check CHECK ((kind = ANY (ARRAY['room'::text, 'dm'::text, 'group'::text]))),
    CONSTRAINT rooms_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 50)))
);


--
-- Name: create_room(text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_room(p_name text, p_public boolean DEFAULT false) RETURNS public.rooms
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_uid uuid := (select auth.uid()); v_room public.rooms;
begin
  if v_uid is null then raise exception 'Faça login primeiro.'; end if;
  if (select count(*) from public.rooms where owner_id = v_uid) >= 20 then
    raise exception 'Você já criou o máximo de 20 salas.';
  end if;
  insert into public.rooms (name, is_public, owner_id) values (trim(p_name), coalesce(p_public, false), v_uid)
  returning * into v_room;
  insert into public.room_members (room_id, user_id, base_role) values (v_room.id, v_uid, 'owner');
  return v_room;
end;
$$;


--
-- Name: delete_role(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_role(p_role uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_room uuid;
begin
  select room_id into v_room from public.room_roles where id = p_role;
  if v_room is null then raise exception 'Cargo não encontrado.'; end if;
  if not public.has_room_perm(v_room, 'manage_roles') then
    raise exception 'Você não tem permissão para gerenciar cargos.';
  end if;
  if public.member_rank(v_room, (select auth.uid())) = 1
     and exists (select 1 from public.room_members where room_id = v_room and user_id = (select auth.uid()) and role_id = p_role) then
    raise exception 'Você não pode apagar o seu próprio cargo.';
  end if;
  delete from public.room_roles where id = p_role;
end;
$$;


--
-- Name: delete_room(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_room(p_room uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if public.member_rank(p_room, (select auth.uid())) <> 3 then raise exception 'Só o dono pode excluir a sala.'; end if;
  delete from public.rooms where id = p_room;
end;
$$;


--
-- Name: fulfill_telao(uuid, text, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fulfill_telao(p_id uuid, p_session text, p_amount integer, p_currency text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare purchase public.purchases;
begin
  select * into purchase from public.purchases where id = p_id for update;
  if purchase.id is null or purchase.stripe_session is distinct from p_session
     or purchase.price_cents is distinct from p_amount or p_currency is distinct from 'brl'
     or purchase.item_id <> 'telao' then
    raise exception 'Pagamento não corresponde à compra.';
  end if;
  if purchase.status = 'paid' then return; end if;
  if purchase.status <> 'pending' then raise exception 'Compra não está pendente.'; end if;
  update public.purchases set status = 'paid', paid_at = now(), expires_at = now() + interval '24 hours'
    where id = p_id;
end;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_name text;
begin
  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    split_part(coalesce(new.email, 'usuario'), '@', 1)
  );
  insert into public.profiles (id, display_name) values (new.id, left(v_name, 32))
  on conflict (id) do nothing;
  return new;
end;
$$;


--
-- Name: has_room_perm(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_room_perm(p_room uuid, p_perm text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$ select public.user_has_perm(p_room, (select auth.uid()), p_perm); $$;


--
-- Name: invite_preview(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invite_preview(p_code text) RETURNS TABLE(room_id uuid, name text, is_public boolean, member_count bigint, already_member boolean, banned boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select r.id, r.name, r.is_public,
    (select count(*) from public.room_members m where m.room_id = r.id),
    exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = (select auth.uid())),
    exists (select 1 from public.room_bans b where b.room_id = r.id and b.user_id = (select auth.uid()))
  from public.rooms r where r.invite_code = lower(trim(p_code)) and r.kind = 'room';
$$;


--
-- Name: is_room_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_room_member(p_room uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (select 1 from public.room_members m where m.room_id = p_room and m.user_id = (select auth.uid()));
$$;


--
-- Name: join_room(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.join_room(p_room uuid DEFAULT NULL::uuid, p_code text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
$$;


--
-- Name: kick_member(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kick_member(p_room uuid, p_user uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.can_act_on(p_room, p_user, 'kick') then
    raise exception 'Você não tem permissão para expulsar essa pessoa.';
  end if;
  delete from public.room_members where room_id = p_room and user_id = p_user;
end;
$$;


--
-- Name: leave_room(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.leave_room(p_room uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if public.member_rank(p_room, (select auth.uid())) = 3 then
    raise exception 'O dono não pode sair. Exclua a sala ou passe a posse antes.';
  end if;
  delete from public.room_members where room_id = p_room and user_id = (select auth.uid());
end;
$$;


--
-- Name: limit_message_rate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.limit_message_rate() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if (select count(*) from public.messages
      where user_id = new.user_id and created_at > now() - interval '5 seconds') >= 5 then
    raise exception 'Calma! Você está mandando mensagens rápido demais.';
  end if;
  new.created_at := now();
  return new;
end;
$$;


--
-- Name: limit_reactions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.limit_reactions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if (select count(*) from public.message_reactions r
      where r.message_id = new.message_id and r.user_id = new.user_id) >= 12 then
    raise exception 'Calma! Reações demais nessa mensagem.';
  end if;
  return new;
end;
$$;


--
-- Name: list_bans(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_bans(p_room uuid) RETURNS TABLE(user_id uuid, display_name text, reason text, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select b.user_id, p.display_name, b.reason, b.created_at
  from public.room_bans b join public.profiles p on p.id = b.user_id
  where b.room_id = p_room and public.has_room_perm(p_room, 'ban')
  order by b.created_at desc;
$$;


--
-- Name: member_rank(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.member_rank(p_room uuid, p_user uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce((
    select case m.base_role when 'owner' then 3 when 'moderator' then 2 else 1 end
    from public.room_members m where m.room_id = p_room and m.user_id = p_user
  ), 0);
$$;


--
-- Name: my_dm_list(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_dm_list() RETURNS TABLE(room_id uuid, kind text, name text, members jsonb, last_content text, last_kind text, last_user uuid, last_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: on_message_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.on_message_stats() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare h int := extract(hour from (new.created_at at time zone 'America/Fortaleza'));
begin
  if new.kind = 'bot' then return null; end if;
  insert into public.user_stats (user_id) values (new.user_id) on conflict do nothing;
  update public.user_stats set
    messages_sent = messages_sent + 1,
    night_messages = night_messages + case when h < 5 then 1 else 0 end,
    morning_messages = morning_messages + case when h >= 5 and h < 8 then 1 else 0 end,
    updated_at = now()
  where user_id = new.user_id;
  perform public.award_badges(new.user_id);
  return null;
end;
$$;


--
-- Name: on_profile_badges(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.on_profile_badges() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform public.award_badges(new.id);
  return null;
end;
$$;


--
-- Name: on_profile_created(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.on_profile_created() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  insert into public.user_stats (user_id) values (new.id) on conflict do nothing;
  perform public.award_badges(new.id);
  return null;
end;
$$;


--
-- Name: open_dm(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.open_dm(p_user uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
  v_key text;
  v_room uuid;
  v_created boolean := false;
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
      on conflict (dm_key) where dm_key is not null do nothing returning id into v_room;
    if v_room is null then
      select id into v_room from public.rooms where dm_key = v_key;
    else
      v_created := true;
    end if;
  end if;
  insert into public.room_members (room_id, user_id) values (v_room, v_uid) on conflict do nothing;
  if v_created then
    insert into public.room_members (room_id, user_id) values (v_room, p_user) on conflict do nothing;
  end if;
  return v_room;
end;
$$;


--
-- Name: reopen_dm_on_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reopen_dm_on_message() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_key text;
  v_first uuid;
  v_second uuid;
begin
  select r.dm_key into v_key from public.rooms r
    where r.id = new.room_id and r.kind = 'dm';
  if v_key is null then return new; end if;
  v_first := split_part(v_key, ':', 1)::uuid;
  v_second := split_part(v_key, ':', 2)::uuid;
  if new.user_id not in (v_first, v_second) then return new; end if;
  insert into public.room_members (room_id, user_id)
    values (new.room_id, v_first), (new.room_id, v_second)
    on conflict do nothing;
  return new;
end;
$$;


--
-- Name: reset_invite(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reset_invite(p_room uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_code text;
begin
  if public.member_rank(p_room, (select auth.uid())) < 2 then
    raise exception 'Só dono ou moderador pode gerar um novo convite.';
  end if;
  update public.rooms set invite_code = encode(extensions.gen_random_bytes(6), 'hex')
  where id = p_room returning invite_code into v_code;
  return v_code;
end;
$$;


--
-- Name: set_moderator(uuid, uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_moderator(p_room uuid, p_user uuid, p_value boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if public.member_rank(p_room, (select auth.uid())) <> 3 then
    raise exception 'Só o dono pode promover ou rebaixar moderadores.';
  end if;
  if public.member_rank(p_room, p_user) not in (1, 2) then raise exception 'Membro inválido.'; end if;
  update public.room_members
  set base_role = case when p_value then 'moderator'::public.base_role else 'member'::public.base_role end
  where room_id = p_room and user_id = p_user;
end;
$$;


--
-- Name: shares_room(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.shares_room(p_a uuid, p_b uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from public.room_members m1
    join public.room_members m2 on m2.room_id = m1.room_id and m2.user_id = p_b
    join public.rooms r on r.id = m1.room_id and r.kind = 'room'
    where m1.user_id = p_a
  );
$$;


--
-- Name: transfer_ownership(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.transfer_ownership(p_room uuid, p_user uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_uid uuid := (select auth.uid());
begin
  if public.member_rank(p_room, v_uid) <> 3 then raise exception 'Só o dono pode passar a posse.'; end if;
  if public.member_rank(p_room, p_user) = 0 or p_user = v_uid then raise exception 'Escolha outro membro da sala.'; end if;
  update public.room_members set base_role = 'moderator' where room_id = p_room and user_id = v_uid;
  update public.room_members set base_role = 'owner' where room_id = p_room and user_id = p_user;
  update public.rooms set owner_id = p_user where id = p_room;
end;
$$;


--
-- Name: unban_member(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unban_member(p_room uuid, p_user uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.has_room_perm(p_room, 'ban') then raise exception 'Você não tem permissão para desbanir.'; end if;
  delete from public.room_bans where room_id = p_room and user_id = p_user;
end;
$$;


--
-- Name: update_role(uuid, text, text, boolean, boolean, boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_role(p_role uuid, p_name text, p_color text, p_kick boolean, p_ban boolean, p_manage boolean, p_delete boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_room uuid;
begin
  select room_id into v_room from public.room_roles where id = p_role;
  if v_room is null then raise exception 'Cargo não encontrado.'; end if;
  perform public.check_role_perms(v_room, p_kick, p_ban, p_manage, p_delete);
  if public.member_rank(v_room, (select auth.uid())) = 1
     and exists (select 1 from public.room_members where room_id = v_room and user_id = (select auth.uid()) and role_id = p_role) then
    raise exception 'Você não pode editar o seu próprio cargo.';
  end if;
  update public.room_roles
  set name = trim(p_name), color = lower(p_color), can_kick = p_kick, can_ban = p_ban,
      can_manage_roles = p_manage, can_delete_messages = p_delete
  where id = p_role;
end;
$$;


--
-- Name: update_room(uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_room(p_room uuid, p_name text, p_public boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if public.member_rank(p_room, (select auth.uid())) <> 3 then raise exception 'Só o dono pode alterar a sala.'; end if;
  update public.rooms set name = trim(p_name), is_public = coalesce(p_public, is_public) where id = p_room;
end;
$$;


--
-- Name: user_has_perm(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_has_perm(p_room uuid, p_user uuid, p_perm text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce((
    select case
      when m.base_role in ('owner', 'moderator') then true
      when r.id is null then false
      when p_perm = 'kick' then r.can_kick
      when p_perm = 'ban' then r.can_ban
      when p_perm = 'manage_roles' then r.can_manage_roles
      when p_perm = 'delete_messages' then r.can_delete_messages
      else false
    end
    from public.room_members m
    left join public.room_roles r on r.id = m.role_id
    where m.room_id = p_room and m.user_id = p_user
  ), false);
$$;


--
-- Name: badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.badges (
    id text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    icon text NOT NULL,
    rarity text NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    CONSTRAINT badges_rarity_check CHECK ((rarity = ANY (ARRAY['comum'::text, 'rara'::text, 'lendaria'::text])))
);


--
-- Name: message_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_reactions (
    message_id bigint NOT NULL,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT message_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 16)))
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id bigint NOT NULL,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    attachment_path text,
    attachment_type text,
    kind text DEFAULT 'user'::text NOT NULL,
    payload jsonb,
    reply_to bigint,
    CONSTRAINT messages_anexo_valido CHECK ((((attachment_path IS NULL) AND (attachment_type IS NULL)) OR ((attachment_type = ANY (ARRAY['image/png'::text, 'image/jpeg'::text, 'image/webp'::text, 'image/gif'::text])) AND (char_length(attachment_path) <= 300) AND (attachment_path ~~ ((((room_id)::text || '/'::text) || (user_id)::text) || '/%'::text))))),
    CONSTRAINT messages_conteudo_ou_anexo CHECK (((char_length(content) <= 2000) AND ((char_length(content) >= 1) OR (attachment_path IS NOT NULL)))),
    CONSTRAINT messages_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'bot'::text])))
);


--
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.messages ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    display_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    avatar_url text,
    banner_url text,
    CONSTRAINT profiles_avatar_own CHECK (((avatar_url IS NULL) OR ((char_length(avatar_url) <= 500) AND (POSITION(((('/storage/v1/object/public/perfis/'::text || (id)::text) || '/'::text)) IN (avatar_url)) > 0)))),
    CONSTRAINT profiles_banner_own CHECK (((banner_url IS NULL) OR ((char_length(banner_url) <= 500) AND (POSITION(((('/storage/v1/object/public/perfis/'::text || (id)::text) || '/'::text)) IN (banner_url)) > 0)))),
    CONSTRAINT profiles_display_name_check CHECK (((char_length(display_name) >= 1) AND (char_length(display_name) <= 32)))
);


--
-- Name: purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    buyer_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    room_id uuid NOT NULL,
    item_id text NOT NULL,
    price_cents integer NOT NULL,
    stripe_session text,
    status text DEFAULT 'pending'::text NOT NULL,
    extra jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_at timestamp with time zone,
    expires_at timestamp with time zone,
    CONSTRAINT purchases_price_cents_check CHECK ((price_cents >= 50)),
    CONSTRAINT purchases_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'refunded'::text]))),
    CONSTRAINT telao_text CHECK (((item_id <> 'telao'::text) OR COALESCE(((jsonb_typeof((extra -> 'text'::text)) = 'string'::text) AND ((char_length((extra ->> 'text'::text)) >= 1) AND (char_length((extra ->> 'text'::text)) <= 40))), false)))
);


--
-- Name: room_bans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_bans (
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    banned_by uuid,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT room_bans_reason_check CHECK (((reason IS NULL) OR (char_length(reason) <= 200)))
);


--
-- Name: room_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_members (
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    base_role public.base_role DEFAULT 'member'::public.base_role NOT NULL,
    role_id uuid,
    joined_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: room_pins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_pins (
    room_id uuid NOT NULL,
    message_id bigint NOT NULL,
    pinned_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shop_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shop_items (
    id text NOT NULL,
    name text NOT NULL,
    price_cents integer NOT NULL,
    active boolean DEFAULT true NOT NULL,
    CONSTRAINT shop_items_price_cents_check CHECK ((price_cents >= 50))
);


--
-- Name: user_badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_badges (
    user_id uuid NOT NULL,
    badge_id text NOT NULL,
    earned_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_stats (
    user_id uuid NOT NULL,
    messages_sent integer DEFAULT 0 NOT NULL,
    night_messages integer DEFAULT 0 NOT NULL,
    morning_messages integer DEFAULT 0 NOT NULL,
    call_seconds integer DEFAULT 0 NOT NULL,
    screen_seconds integer DEFAULT 0 NOT NULL,
    first_share_at timestamp with time zone,
    last_call_ping timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_status (
    user_id uuid NOT NULL,
    status text DEFAULT 'online'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_status_status_check CHECK ((status = ANY (ARRAY['online'::text, 'idle'::text, 'dnd'::text, 'invisible'::text])))
);


--
-- Name: badges badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badges
    ADD CONSTRAINT badges_pkey PRIMARY KEY (id);


--
-- Name: message_reactions message_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_pkey PRIMARY KEY (message_id, user_id, emoji);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: purchases purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_pkey PRIMARY KEY (id);


--
-- Name: purchases purchases_stripe_session_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_stripe_session_key UNIQUE (stripe_session);


--
-- Name: room_bans room_bans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_bans
    ADD CONSTRAINT room_bans_pkey PRIMARY KEY (room_id, user_id);


--
-- Name: room_members room_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_members
    ADD CONSTRAINT room_members_pkey PRIMARY KEY (room_id, user_id);


--
-- Name: room_pins room_pins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_pins
    ADD CONSTRAINT room_pins_pkey PRIMARY KEY (room_id, message_id);


--
-- Name: room_roles room_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_roles
    ADD CONSTRAINT room_roles_pkey PRIMARY KEY (id);


--
-- Name: rooms rooms_invite_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_invite_code_key UNIQUE (invite_code);


--
-- Name: rooms rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_pkey PRIMARY KEY (id);


--
-- Name: shop_items shop_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_items
    ADD CONSTRAINT shop_items_pkey PRIMARY KEY (id);


--
-- Name: user_badges user_badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_pkey PRIMARY KEY (user_id, badge_id);


--
-- Name: user_stats user_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_stats
    ADD CONSTRAINT user_stats_pkey PRIMARY KEY (user_id);


--
-- Name: user_status user_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_status
    ADD CONSTRAINT user_status_pkey PRIMARY KEY (user_id);


--
-- Name: message_reactions_room_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX message_reactions_room_idx ON public.message_reactions USING btree (room_id);


--
-- Name: messages_room_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_room_created_idx ON public.messages USING btree (room_id, created_at DESC);


--
-- Name: messages_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_user_idx ON public.messages USING btree (user_id);


--
-- Name: purchases_room_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchases_room_active ON public.purchases USING btree (room_id, expires_at) WHERE (status = 'paid'::text);


--
-- Name: room_bans_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX room_bans_by_idx ON public.room_bans USING btree (banned_by);


--
-- Name: room_bans_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX room_bans_user_idx ON public.room_bans USING btree (user_id);


--
-- Name: room_members_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX room_members_role_idx ON public.room_members USING btree (role_id);


--
-- Name: room_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX room_members_user_idx ON public.room_members USING btree (user_id);


--
-- Name: room_roles_room_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX room_roles_room_idx ON public.room_roles USING btree (room_id);


--
-- Name: rooms_dm_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rooms_dm_key_idx ON public.rooms USING btree (dm_key) WHERE (dm_key IS NOT NULL);


--
-- Name: rooms_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rooms_owner_idx ON public.rooms USING btree (owner_id);


--
-- Name: user_badges_badge_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_badges_badge_idx ON public.user_badges USING btree (badge_id);


--
-- Name: message_reactions message_reactions_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER message_reactions_limit BEFORE INSERT ON public.message_reactions FOR EACH ROW EXECUTE FUNCTION public.limit_reactions();


--
-- Name: messages messages_rate_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER messages_rate_limit BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.limit_message_rate();


--
-- Name: messages messages_reopen_dm; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER messages_reopen_dm AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.reopen_dm_on_message();


--
-- Name: messages messages_reply_same_room; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER messages_reply_same_room BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.check_reply_same_room();


--
-- Name: messages messages_stats; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER messages_stats AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.on_message_stats();


--
-- Name: profiles profiles_badges; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_badges AFTER UPDATE OF avatar_url, banner_url ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.on_profile_badges();


--
-- Name: profiles profiles_created_stats; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_created_stats AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.on_profile_created();


--
-- Name: message_reactions message_reactions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: message_reactions message_reactions_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: message_reactions message_reactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: messages messages_reply_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_reply_to_fkey FOREIGN KEY (reply_to) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: messages messages_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: messages messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: purchases purchases_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.profiles(id);


--
-- Name: purchases purchases_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.shop_items(id);


--
-- Name: purchases purchases_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.profiles(id);


--
-- Name: purchases purchases_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: room_bans room_bans_banned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_bans
    ADD CONSTRAINT room_bans_banned_by_fkey FOREIGN KEY (banned_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: room_bans room_bans_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_bans
    ADD CONSTRAINT room_bans_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: room_bans room_bans_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_bans
    ADD CONSTRAINT room_bans_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: room_members room_members_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_members
    ADD CONSTRAINT room_members_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.room_roles(id) ON DELETE SET NULL;


--
-- Name: room_members room_members_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_members
    ADD CONSTRAINT room_members_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: room_members room_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_members
    ADD CONSTRAINT room_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: room_pins room_pins_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_pins
    ADD CONSTRAINT room_pins_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: room_pins room_pins_pinned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_pins
    ADD CONSTRAINT room_pins_pinned_by_fkey FOREIGN KEY (pinned_by) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: room_pins room_pins_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_pins
    ADD CONSTRAINT room_pins_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: room_roles room_roles_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_roles
    ADD CONSTRAINT room_roles_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: rooms rooms_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: user_badges user_badges_badge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_badge_id_fkey FOREIGN KEY (badge_id) REFERENCES public.badges(id) ON DELETE CASCADE;


--
-- Name: user_badges user_badges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: user_stats user_stats_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_stats
    ADD CONSTRAINT user_stats_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: user_status user_status_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_status
    ADD CONSTRAINT user_status_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: messages apagar propria mensagem ou com permissao; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "apagar propria mensagem ou com permissao" ON public.messages FOR DELETE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR public.has_room_perm(room_id, 'delete_messages'::text)));


--
-- Name: badges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;

--
-- Name: shop_items catalogo ativo; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "catalogo ativo" ON public.shop_items FOR SELECT TO authenticated USING (active);


--
-- Name: purchases compras proprias e efeitos da sala; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "compras proprias e efeitos da sala" ON public.purchases FOR SELECT TO authenticated USING (((buyer_id = ( SELECT auth.uid() AS uid)) OR ((status = 'paid'::text) AND (expires_at > now()) AND public.is_room_member(room_id))));


--
-- Name: user_status criar o proprio status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "criar o proprio status" ON public.user_status FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: profiles editar o proprio perfil; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "editar o proprio perfil" ON public.profiles FOR UPDATE TO authenticated USING ((id = ( SELECT auth.uid() AS uid))) WITH CHECK ((id = ( SELECT auth.uid() AS uid)));


--
-- Name: user_badges insignias conquistadas visiveis; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "insignias conquistadas visiveis" ON public.user_badges FOR SELECT TO authenticated USING (true);


--
-- Name: badges insignias visiveis; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "insignias visiveis" ON public.badges FOR SELECT TO authenticated USING (true);


--
-- Name: room_pins membros desafixam mensagens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "membros desafixam mensagens" ON public.room_pins FOR DELETE TO authenticated USING (public.is_room_member(room_id));


--
-- Name: messages membros enviam mensagens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "membros enviam mensagens" ON public.messages FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND public.is_room_member(room_id) AND (kind = 'user'::text) AND (payload IS NULL)));


--
-- Name: room_pins membros fixam mensagens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "membros fixam mensagens" ON public.room_pins FOR INSERT TO authenticated WITH CHECK (((pinned_by = ( SELECT auth.uid() AS uid)) AND public.is_room_member(room_id) AND (EXISTS ( SELECT 1
   FROM public.messages m
  WHERE ((m.id = room_pins.message_id) AND (m.room_id = room_pins.room_id))))));


--
-- Name: messages membros leem mensagens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "membros leem mensagens" ON public.messages FOR SELECT TO authenticated USING (public.is_room_member(room_id));


--
-- Name: message_reactions membros reagem; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "membros reagem" ON public.message_reactions FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND public.is_room_member(room_id) AND (EXISTS ( SELECT 1
   FROM public.messages m
  WHERE ((m.id = message_reactions.message_id) AND (m.room_id = message_reactions.room_id))))));


--
-- Name: room_roles membros veem cargos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "membros veem cargos" ON public.room_roles FOR SELECT TO authenticated USING (public.is_room_member(room_id));


--
-- Name: room_pins membros veem fixadas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "membros veem fixadas" ON public.room_pins FOR SELECT TO authenticated USING (public.is_room_member(room_id));


--
-- Name: room_members membros veem membros; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "membros veem membros" ON public.room_members FOR SELECT TO authenticated USING (public.is_room_member(room_id));


--
-- Name: message_reactions membros veem reacoes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "membros veem reacoes" ON public.message_reactions FOR SELECT TO authenticated USING (public.is_room_member(room_id));


--
-- Name: message_reactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: room_bans moderacao ve banidos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "moderacao ve banidos" ON public.room_bans FOR SELECT TO authenticated USING (public.has_room_perm(room_id, 'ban'::text));


--
-- Name: user_status mudar o proprio status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "mudar o proprio status" ON public.user_status FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: profiles perfis visiveis para logados; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "perfis visiveis para logados" ON public.profiles FOR SELECT TO authenticated USING (true);


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: purchases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

--
-- Name: room_bans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.room_bans ENABLE ROW LEVEL SECURITY;

--
-- Name: room_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;

--
-- Name: room_pins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.room_pins ENABLE ROW LEVEL SECURITY;

--
-- Name: room_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.room_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: rooms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

--
-- Name: shop_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shop_items ENABLE ROW LEVEL SECURITY;

--
-- Name: message_reactions tirar propria reacao; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tirar propria reacao" ON public.message_reactions FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: user_badges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;

--
-- Name: user_stats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;

--
-- Name: user_status; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_status ENABLE ROW LEVEL SECURITY;

--
-- Name: user_stats ver as proprias estatisticas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ver as proprias estatisticas" ON public.user_stats FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: user_status ver o proprio status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ver o proprio status" ON public.user_status FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: rooms ver salas publicas ou onde sou membro; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ver salas publicas ou onde sou membro" ON public.rooms FOR SELECT TO authenticated USING ((is_public OR public.is_room_member(id)));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION assign_role(p_room uuid, p_user uuid, p_role uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.assign_role(p_room uuid, p_user uuid, p_role uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.assign_role(p_room uuid, p_user uuid, p_role uuid) TO authenticated;
GRANT ALL ON FUNCTION public.assign_role(p_room uuid, p_user uuid, p_role uuid) TO service_role;


--
-- Name: FUNCTION award_badges(p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.award_badges(p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.award_badges(p_user uuid) TO service_role;


--
-- Name: FUNCTION ban_member(p_room uuid, p_user uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ban_member(p_room uuid, p_user uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ban_member(p_room uuid, p_user uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.ban_member(p_room uuid, p_user uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION bot_draw(p_room uuid, p_kind text, p_people uuid[], p_items text[], p_count integer, p_min integer, p_max integer, p_title text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.bot_draw(p_room uuid, p_kind text, p_people uuid[], p_items text[], p_count integer, p_min integer, p_max integer, p_title text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.bot_draw(p_room uuid, p_kind text, p_people uuid[], p_items text[], p_count integer, p_min integer, p_max integer, p_title text) TO authenticated;
GRANT ALL ON FUNCTION public.bot_draw(p_room uuid, p_kind text, p_people uuid[], p_items text[], p_count integer, p_min integer, p_max integer, p_title text) TO service_role;


--
-- Name: FUNCTION call_access(p_room uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.call_access(p_room uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.call_access(p_room uuid) TO authenticated;
GRANT ALL ON FUNCTION public.call_access(p_room uuid) TO service_role;


--
-- Name: FUNCTION call_heartbeat(p_sharing boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.call_heartbeat(p_sharing boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.call_heartbeat(p_sharing boolean) TO authenticated;
GRANT ALL ON FUNCTION public.call_heartbeat(p_sharing boolean) TO service_role;


--
-- Name: FUNCTION can_act_on(p_room uuid, p_target uuid, p_perm text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_act_on(p_room uuid, p_target uuid, p_perm text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_act_on(p_room uuid, p_target uuid, p_perm text) TO service_role;


--
-- Name: FUNCTION check_my_badges(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_my_badges() FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_my_badges() TO authenticated;
GRANT ALL ON FUNCTION public.check_my_badges() TO service_role;


--
-- Name: FUNCTION check_reply_same_room(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.check_reply_same_room() TO anon;
GRANT ALL ON FUNCTION public.check_reply_same_room() TO authenticated;
GRANT ALL ON FUNCTION public.check_reply_same_room() TO service_role;


--
-- Name: FUNCTION check_role_perms(p_room uuid, p_kick boolean, p_ban boolean, p_manage boolean, p_delete boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_role_perms(p_room uuid, p_kick boolean, p_ban boolean, p_manage boolean, p_delete boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_role_perms(p_room uuid, p_kick boolean, p_ban boolean, p_manage boolean, p_delete boolean) TO service_role;


--
-- Name: FUNCTION create_group_dm(p_users uuid[], p_name text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.create_group_dm(p_users uuid[], p_name text) TO authenticated;
GRANT ALL ON FUNCTION public.create_group_dm(p_users uuid[], p_name text) TO service_role;


--
-- Name: TABLE room_roles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.room_roles TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.room_roles TO authenticated;
GRANT ALL ON TABLE public.room_roles TO service_role;


--
-- Name: FUNCTION create_role(p_room uuid, p_name text, p_color text, p_kick boolean, p_ban boolean, p_manage boolean, p_delete boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_role(p_room uuid, p_name text, p_color text, p_kick boolean, p_ban boolean, p_manage boolean, p_delete boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_role(p_room uuid, p_name text, p_color text, p_kick boolean, p_ban boolean, p_manage boolean, p_delete boolean) TO authenticated;
GRANT ALL ON FUNCTION public.create_role(p_room uuid, p_name text, p_color text, p_kick boolean, p_ban boolean, p_manage boolean, p_delete boolean) TO service_role;


--
-- Name: TABLE rooms; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.rooms TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.rooms TO authenticated;
GRANT ALL ON TABLE public.rooms TO service_role;


--
-- Name: FUNCTION create_room(p_name text, p_public boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_room(p_name text, p_public boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_room(p_name text, p_public boolean) TO authenticated;
GRANT ALL ON FUNCTION public.create_room(p_name text, p_public boolean) TO service_role;


--
-- Name: FUNCTION delete_role(p_role uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_role(p_role uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_role(p_role uuid) TO authenticated;
GRANT ALL ON FUNCTION public.delete_role(p_role uuid) TO service_role;


--
-- Name: FUNCTION delete_room(p_room uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_room(p_room uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_room(p_room uuid) TO authenticated;
GRANT ALL ON FUNCTION public.delete_room(p_room uuid) TO service_role;


--
-- Name: FUNCTION fulfill_telao(p_id uuid, p_session text, p_amount integer, p_currency text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fulfill_telao(p_id uuid, p_session text, p_amount integer, p_currency text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fulfill_telao(p_id uuid, p_session text, p_amount integer, p_currency text) TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION has_room_perm(p_room uuid, p_perm text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.has_room_perm(p_room uuid, p_perm text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.has_room_perm(p_room uuid, p_perm text) TO authenticated;
GRANT ALL ON FUNCTION public.has_room_perm(p_room uuid, p_perm text) TO service_role;


--
-- Name: FUNCTION invite_preview(p_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.invite_preview(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.invite_preview(p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.invite_preview(p_code text) TO service_role;


--
-- Name: FUNCTION is_room_member(p_room uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_room_member(p_room uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_room_member(p_room uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_room_member(p_room uuid) TO service_role;


--
-- Name: FUNCTION join_room(p_room uuid, p_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.join_room(p_room uuid, p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.join_room(p_room uuid, p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.join_room(p_room uuid, p_code text) TO service_role;


--
-- Name: FUNCTION kick_member(p_room uuid, p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.kick_member(p_room uuid, p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.kick_member(p_room uuid, p_user uuid) TO authenticated;
GRANT ALL ON FUNCTION public.kick_member(p_room uuid, p_user uuid) TO service_role;


--
-- Name: FUNCTION leave_room(p_room uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.leave_room(p_room uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.leave_room(p_room uuid) TO authenticated;
GRANT ALL ON FUNCTION public.leave_room(p_room uuid) TO service_role;


--
-- Name: FUNCTION limit_message_rate(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.limit_message_rate() FROM PUBLIC;
GRANT ALL ON FUNCTION public.limit_message_rate() TO service_role;


--
-- Name: FUNCTION limit_reactions(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.limit_reactions() TO anon;
GRANT ALL ON FUNCTION public.limit_reactions() TO authenticated;
GRANT ALL ON FUNCTION public.limit_reactions() TO service_role;


--
-- Name: FUNCTION list_bans(p_room uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_bans(p_room uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_bans(p_room uuid) TO authenticated;
GRANT ALL ON FUNCTION public.list_bans(p_room uuid) TO service_role;


--
-- Name: FUNCTION member_rank(p_room uuid, p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.member_rank(p_room uuid, p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.member_rank(p_room uuid, p_user uuid) TO service_role;


--
-- Name: FUNCTION my_dm_list(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.my_dm_list() TO authenticated;
GRANT ALL ON FUNCTION public.my_dm_list() TO service_role;


--
-- Name: FUNCTION on_message_stats(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.on_message_stats() FROM PUBLIC;
GRANT ALL ON FUNCTION public.on_message_stats() TO service_role;


--
-- Name: FUNCTION on_profile_badges(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.on_profile_badges() FROM PUBLIC;
GRANT ALL ON FUNCTION public.on_profile_badges() TO service_role;


--
-- Name: FUNCTION on_profile_created(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.on_profile_created() FROM PUBLIC;
GRANT ALL ON FUNCTION public.on_profile_created() TO service_role;


--
-- Name: FUNCTION open_dm(p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.open_dm(p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.open_dm(p_user uuid) TO authenticated;
GRANT ALL ON FUNCTION public.open_dm(p_user uuid) TO service_role;


--
-- Name: FUNCTION reopen_dm_on_message(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reopen_dm_on_message() FROM PUBLIC;
GRANT ALL ON FUNCTION public.reopen_dm_on_message() TO service_role;


--
-- Name: FUNCTION reset_invite(p_room uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reset_invite(p_room uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reset_invite(p_room uuid) TO authenticated;
GRANT ALL ON FUNCTION public.reset_invite(p_room uuid) TO service_role;


--
-- Name: FUNCTION set_moderator(p_room uuid, p_user uuid, p_value boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_moderator(p_room uuid, p_user uuid, p_value boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_moderator(p_room uuid, p_user uuid, p_value boolean) TO authenticated;
GRANT ALL ON FUNCTION public.set_moderator(p_room uuid, p_user uuid, p_value boolean) TO service_role;


--
-- Name: FUNCTION shares_room(p_a uuid, p_b uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.shares_room(p_a uuid, p_b uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.shares_room(p_a uuid, p_b uuid) TO authenticated;
GRANT ALL ON FUNCTION public.shares_room(p_a uuid, p_b uuid) TO service_role;


--
-- Name: FUNCTION transfer_ownership(p_room uuid, p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.transfer_ownership(p_room uuid, p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.transfer_ownership(p_room uuid, p_user uuid) TO authenticated;
GRANT ALL ON FUNCTION public.transfer_ownership(p_room uuid, p_user uuid) TO service_role;


--
-- Name: FUNCTION unban_member(p_room uuid, p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.unban_member(p_room uuid, p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.unban_member(p_room uuid, p_user uuid) TO authenticated;
GRANT ALL ON FUNCTION public.unban_member(p_room uuid, p_user uuid) TO service_role;


--
-- Name: FUNCTION update_role(p_role uuid, p_name text, p_color text, p_kick boolean, p_ban boolean, p_manage boolean, p_delete boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_role(p_role uuid, p_name text, p_color text, p_kick boolean, p_ban boolean, p_manage boolean, p_delete boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_role(p_role uuid, p_name text, p_color text, p_kick boolean, p_ban boolean, p_manage boolean, p_delete boolean) TO authenticated;
GRANT ALL ON FUNCTION public.update_role(p_role uuid, p_name text, p_color text, p_kick boolean, p_ban boolean, p_manage boolean, p_delete boolean) TO service_role;


--
-- Name: FUNCTION update_room(p_room uuid, p_name text, p_public boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_room(p_room uuid, p_name text, p_public boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_room(p_room uuid, p_name text, p_public boolean) TO authenticated;
GRANT ALL ON FUNCTION public.update_room(p_room uuid, p_name text, p_public boolean) TO service_role;


--
-- Name: FUNCTION user_has_perm(p_room uuid, p_user uuid, p_perm text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.user_has_perm(p_room uuid, p_user uuid, p_perm text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.user_has_perm(p_room uuid, p_user uuid, p_perm text) TO service_role;


--
-- Name: TABLE badges; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.badges TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.badges TO authenticated;
GRANT ALL ON TABLE public.badges TO service_role;


--
-- Name: TABLE message_reactions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.message_reactions TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.message_reactions TO authenticated;
GRANT ALL ON TABLE public.message_reactions TO service_role;


--
-- Name: TABLE messages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.messages TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;


--
-- Name: SEQUENCE messages_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.messages_id_seq TO anon;
GRANT ALL ON SEQUENCE public.messages_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.messages_id_seq TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.profiles TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE purchases; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.purchases TO service_role;
GRANT SELECT ON TABLE public.purchases TO authenticated;


--
-- Name: TABLE room_bans; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.room_bans TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.room_bans TO authenticated;
GRANT ALL ON TABLE public.room_bans TO service_role;


--
-- Name: TABLE room_members; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.room_members TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.room_members TO authenticated;
GRANT ALL ON TABLE public.room_members TO service_role;


--
-- Name: TABLE room_pins; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.room_pins TO service_role;
GRANT SELECT,INSERT,DELETE ON TABLE public.room_pins TO authenticated;


--
-- Name: TABLE shop_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.shop_items TO service_role;
GRANT SELECT ON TABLE public.shop_items TO authenticated;


--
-- Name: TABLE user_badges; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.user_badges TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.user_badges TO authenticated;
GRANT ALL ON TABLE public.user_badges TO service_role;


--
-- Name: TABLE user_stats; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.user_stats TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.user_stats TO authenticated;
GRANT ALL ON TABLE public.user_stats TO service_role;


--
-- Name: TABLE user_status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.user_status TO anon;
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE public.user_status TO authenticated;
GRANT ALL ON TABLE public.user_status TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict 2jT4HQc4ZyFgFatHZgga2SSlJzwZJkDeKAF8MGfNwwWaHOdMxQ0ynNLA6yWnU6U
