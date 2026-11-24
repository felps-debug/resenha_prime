-- Música e assistir junto: estado compartilhado por call (sala padrão ou canal de voz). Aditivo.
-- O estado fica no banco e todo mundo da call o recebe por realtime; o áudio/vídeo toca no player oficial do YouTube de cada navegador.

create table if not exists public.call_music (
  call_key text primary key,                         -- id da sala, ou "sala:canal" para canal de voz
  room_id uuid not null references public.rooms(id) on delete cascade,
  channel_id uuid references public.room_channels(id) on delete cascade,
  mode text not null default 'music' check (mode in ('music', 'watch')),
  current jsonb,                                     -- { id, title, author, thumb, by, byName }
  started_at timestamptz,                            -- instante em que a posição 0 teria começado
  paused_at timestamptz,                             -- preenchido enquanto pausado
  queue jsonb not null default '[]'::jsonb,
  looping boolean not null default false,
  skip_votes uuid[] not null default '{}',
  controller uuid,                                   -- quem controla (assistir junto)
  updated_at timestamptz not null default now()
);
alter table public.call_music enable row level security;

drop policy if exists "membros veem a musica" on public.call_music;
create policy "membros veem a musica" on public.call_music for select to authenticated
  using (public.is_room_member(room_id) and (channel_id is null or public.can_see_channel(channel_id)));

-- Estado atual + relógio do servidor (para sincronizar a posição entre navegadores)
create or replace function public.music_state(p_room uuid, p_channel uuid default null) returns jsonb
  language plpgsql stable security definer set search_path to '' as $$
declare v_key text := p_room::text || coalesce(':' || p_channel::text, '');
begin
  if not public.is_room_member(p_room) then raise exception 'Você não é membro desta sala.'; end if;
  if p_channel is not null and not public.can_see_channel(p_channel) then raise exception 'Canal indisponível.'; end if;
  return jsonb_build_object('state', (select to_jsonb(c) from public.call_music c where c.call_key = v_key), 'now', now());
end;
$$;

create or replace function public.music_command(p_room uuid, p_channel uuid, p_cmd text, p_arg jsonb default '{}'::jsonb) returns jsonb
  language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_key text := p_room::text || coalesce(':' || p_channel::text, '');
  v_name text;
  v_row public.call_music;
  v_item jsonb;
  v_say jsonb;                                       -- cartão do DJ no chat
  v_pos numeric;
  v_rank int;
  v_len int;
begin
  if v_uid is null then raise exception 'Faça login de novo.'; end if;
  if not public.is_room_member(p_room) then raise exception 'Você não é membro desta sala.'; end if;
  if p_channel is not null and not exists (select 1 from public.room_channels c where c.id = p_channel and c.room_id = p_room and c.kind = 'voice') then
    raise exception 'Canal de voz inválido.';
  end if;
  if p_channel is not null and not public.can_see_channel(p_channel) then raise exception 'Canal indisponível.'; end if;
  select display_name into v_name from public.profiles where id = v_uid;
  v_rank := public.member_rank(p_room, v_uid);

  insert into public.call_music (call_key, room_id, channel_id) values (v_key, p_room, p_channel) on conflict (call_key) do nothing;
  select * into v_row from public.call_music where call_key = v_key for update;

  if p_cmd = 'play' then
    v_item := jsonb_build_object(
      'id', left(coalesce(p_arg->>'id', ''), 20), 'title', left(coalesce(p_arg->>'title', 'Sem título'), 120),
      'author', left(coalesce(p_arg->>'author', ''), 80), 'thumb', left(coalesce(p_arg->>'thumb', ''), 300),
      'by', v_uid, 'byName', v_name);
    if (v_item->>'id') !~ '^[A-Za-z0-9_-]{6,20}$' then raise exception 'Vídeo inválido.'; end if;
    if v_row.current is null then
      update public.call_music set mode = case when p_arg->>'mode' = 'watch' then 'watch' else 'music' end, current = v_item,
        started_at = now(), paused_at = null, skip_votes = '{}', controller = v_uid, updated_at = now() where call_key = v_key;
      v_say := jsonb_build_object('type', 'music_now', 'title', 'TOCANDO AGORA', 'track', v_item);
    else
      if jsonb_array_length(v_row.queue) >= 50 then raise exception 'A fila está cheia (50).'; end if;
      update public.call_music set queue = queue || v_item, updated_at = now() where call_key = v_key;
      v_say := jsonb_build_object('type', 'music_queue', 'title', 'NA FILA · #' || (jsonb_array_length(v_row.queue) + 1), 'track', v_item);
    end if;

  elsif p_cmd in ('next', 'skip') then
    if v_row.current is null then raise exception 'Não tem nada tocando.'; end if;
    if p_cmd = 'skip' and v_rank < 2 and (v_row.current->>'by')::uuid <> v_uid then
      -- voto: 3 votos pulam
      if not (v_uid = any (v_row.skip_votes)) then
        update public.call_music set skip_votes = skip_votes || v_uid, updated_at = now() where call_key = v_key;
        v_row.skip_votes := v_row.skip_votes || v_uid;
      end if;
      if coalesce(array_length(v_row.skip_votes, 1), 0) < 3 then
        select * into v_row from public.call_music where call_key = v_key;
        return jsonb_build_object('state', to_jsonb(v_row), 'now', now(), 'votes', array_length(v_row.skip_votes, 1));
      end if;
    end if;
    v_say := jsonb_build_object('type', 'music_skip', 'title', 'PULEI', 'track', v_row.current);
    if jsonb_array_length(v_row.queue) > 0 then
      update public.call_music set current = queue->0, queue = queue - 0, started_at = now(), paused_at = null, skip_votes = '{}', updated_at = now() where call_key = v_key;
    else
      update public.call_music set current = null, started_at = null, paused_at = null, skip_votes = '{}', updated_at = now() where call_key = v_key;
    end if;

  elsif p_cmd = 'ended' then
    if v_row.current is null or v_row.current->>'id' <> coalesce(p_arg->>'id', '') or v_row.paused_at is not null
       or now() - v_row.started_at < interval '5 seconds' then
      return jsonb_build_object('state', to_jsonb(v_row), 'now', now());
    end if;
    if v_row.looping then
      update public.call_music set started_at = now(), skip_votes = '{}', updated_at = now() where call_key = v_key;
    elsif jsonb_array_length(v_row.queue) > 0 then
      update public.call_music set current = queue->0, queue = queue - 0, started_at = now(), skip_votes = '{}', updated_at = now() where call_key = v_key;
    else
      update public.call_music set current = null, started_at = null, skip_votes = '{}', updated_at = now() where call_key = v_key;
    end if;

  elsif p_cmd in ('pause', 'resume') then
    if v_row.current is null then raise exception 'Não tem nada tocando.'; end if;
    if v_row.mode = 'watch' and v_row.controller is not null and v_row.controller <> v_uid and v_rank < 2 then
      raise exception 'Só quem controla pode fazer isso.';
    end if;
    if p_cmd = 'pause' and v_row.paused_at is null then
      update public.call_music set paused_at = now(), updated_at = now() where call_key = v_key;
      v_say := jsonb_build_object('type', 'music_pause', 'title', 'PAUSADO', 'track', v_row.current);
    elsif p_cmd = 'resume' and v_row.paused_at is not null then
      update public.call_music set started_at = started_at + (now() - paused_at), paused_at = null, updated_at = now() where call_key = v_key;
      v_say := jsonb_build_object('type', 'music_resume', 'title', 'VOLTEI', 'track', v_row.current);
    end if;

  elsif p_cmd = 'seek' then
    if v_row.current is null then raise exception 'Não tem nada tocando.'; end if;
    if v_row.mode = 'watch' and v_row.controller is not null and v_row.controller <> v_uid and v_rank < 2 then
      raise exception 'Só quem controla pode fazer isso.';
    end if;
    v_pos := greatest(0, least(coalesce((p_arg->>'pos')::numeric, 0), 86400));
    update public.call_music
       set started_at = coalesce(paused_at, now()) - (v_pos || ' seconds')::interval, updated_at = now() where call_key = v_key;

  elsif p_cmd = 'loop' then
    update public.call_music set looping = not looping, updated_at = now() where call_key = v_key;
    v_say := jsonb_build_object('type', 'music_loop', 'title', 'LOOP', 'text', case when v_row.looping then 'Desligado' else 'Ligado' end);

  elsif p_cmd = 'remove' then
    v_len := jsonb_array_length(v_row.queue);
    v_pos := coalesce((p_arg->>'index')::int, -1);
    if v_pos < 0 or v_pos >= v_len then raise exception 'Esse item não está na fila.'; end if;
    if (v_row.queue->(v_pos::int)->>'by')::uuid <> v_uid and v_rank < 2 then raise exception 'Você só tira o que você pediu.'; end if;
    update public.call_music set queue = queue - (v_pos::int), updated_at = now() where call_key = v_key;

  elsif p_cmd = 'control' then
    if v_row.controller is not null and v_row.controller <> v_uid and v_rank < 2 then raise exception 'Só quem controla passa o controle.'; end if;
    if not exists (select 1 from public.room_members where room_id = p_room and user_id = (p_arg->>'to')::uuid) then raise exception 'Pessoa inválida.'; end if;
    update public.call_music set controller = (p_arg->>'to')::uuid, updated_at = now() where call_key = v_key;

  elsif p_cmd = 'stop' then
    update public.call_music set current = null, started_at = null, paused_at = null, queue = '[]'::jsonb, skip_votes = '{}', looping = false, updated_at = now() where call_key = v_key;
    v_say := jsonb_build_object('type', 'music_stop', 'title', 'TCHAU', 'text', 'Parei a música e limpei a fila.');

  elsif p_cmd = 'say' then
    v_say := jsonb_build_object('type', coalesce(p_arg->>'type', 'music_text'), 'title', left(coalesce(p_arg->>'title', ''), 40), 'text', left(coalesce(p_arg->>'text', ''), 800));
  else
    raise exception 'Comando desconhecido.';
  end if;

  if v_say is not null and coalesce((p_arg->>'quiet')::boolean, false) = false then
    -- Cartão do DJ no chat da sala (o bot não passa pelo cliente)
    begin
      insert into public.messages (room_id, user_id, content, kind, payload)
      values (p_room, v_uid, left(coalesce(v_say->>'title', 'DJ'), 40), 'bot', v_say);
    exception when others then
      null; -- limite de mensagens por segundo: o comando vale mesmo sem o cartão no chat
    end;
  end if;

  select * into v_row from public.call_music where call_key = v_key;
  return jsonb_build_object('state', to_jsonb(v_row), 'now', now());
end;
$$;

revoke all on public.call_music from public, anon;
grant select on public.call_music to authenticated;
revoke all on function public.music_state(uuid, uuid), public.music_command(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.music_state(uuid, uuid), public.music_command(uuid, uuid, text, jsonb) to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'call_music') then
    alter publication supabase_realtime add table public.call_music;
  end if;
end $$;
