-- Canais de texto e voz por sala. Aditivo: o chat e a call que já existem continuam sendo o canal padrão
-- (messages.channel_id nulo = chat padrão da sala; call da sala = LiveKit room com o id da sala).
--
-- Políticas anteriores de messages (guardadas aqui para voltar atrás se precisar):
--   "membros leem mensagens"  FOR SELECT  USING (public.is_room_member(room_id))
--   "membros enviam mensagens" FOR INSERT WITH CHECK (user_id = (select auth.uid()) AND public.is_room_member(room_id) AND kind = 'user' AND payload IS NULL)

create table if not exists public.room_channels (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  kind text not null check (kind in ('text', 'voice')),
  name text not null check (char_length(name) between 1 and 40),
  is_private boolean not null default false,
  role_ids uuid[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists room_channels_nome_unico on public.room_channels (room_id, kind, lower(name));
create index if not exists room_channels_sala on public.room_channels (room_id, created_at);
alter table public.room_channels enable row level security;

-- Quem vê o canal: membro da sala; se for privado, só dono, moderadores e quem tem um dos cargos escolhidos.
create or replace function public.can_see_channel(p_channel uuid) returns boolean
  language sql stable security definer set search_path to '' as $$
  select exists (
    select 1
    from public.room_channels c
    join public.room_members m on m.room_id = c.room_id and m.user_id = (select auth.uid())
    where c.id = p_channel
      and (not c.is_private or m.base_role in ('owner', 'moderator') or m.role_id = any (c.role_ids))
  );
$$;

-- A mensagem só vale num canal de texto da mesma sala que a pessoa pode ver (ou sem canal = chat padrão).
create or replace function public.channel_ok(p_room uuid, p_channel uuid) returns boolean
  language sql stable security definer set search_path to '' as $$
  select p_channel is null or exists (
    select 1 from public.room_channels c
    where c.id = p_channel and c.room_id = p_room and c.kind = 'text' and public.can_see_channel(c.id)
  );
$$;

drop policy if exists "membros veem canais" on public.room_channels;
create policy "membros veem canais" on public.room_channels for select to authenticated
  using (public.can_see_channel(id));

alter table public.messages add column if not exists channel_id uuid references public.room_channels(id) on delete cascade;
create index if not exists messages_canal on public.messages (room_id, channel_id, id desc);

drop policy if exists "membros leem mensagens" on public.messages;
create policy "membros leem mensagens" on public.messages for select to authenticated
  using (public.is_room_member(room_id) and public.channel_ok(room_id, channel_id));

drop policy if exists "membros enviam mensagens" on public.messages;
create policy "membros enviam mensagens" on public.messages for insert to authenticated
  with check (
    user_id = (select auth.uid()) and public.is_room_member(room_id) and kind = 'user' and payload is null
    and public.channel_ok(room_id, channel_id)
  );

-- Criar canal: só dono e moderadores. O nome do canal de texto vira minúsculo com hífen.
create or replace function public.create_channel(
  p_room uuid, p_kind text, p_name text, p_private boolean default false, p_roles uuid[] default '{}'
) returns public.room_channels
  language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_roles uuid[];
  v_row public.room_channels;
begin
  if v_uid is null then raise exception 'Faça login de novo.'; end if;
  if p_kind not in ('text', 'voice') then raise exception 'Tipo de canal inválido.'; end if;
  if not exists (select 1 from public.room_members m join public.rooms r on r.id = m.room_id
                 where m.room_id = p_room and m.user_id = v_uid and m.base_role in ('owner', 'moderator') and r.kind = 'room') then
    raise exception 'Só o dono e os moderadores criam canais.';
  end if;
  if p_kind = 'text' then
    v_name := regexp_replace(lower(trim(p_name)), '[\s_]+', '-', 'g');
    v_name := regexp_replace(v_name, '[^a-z0-9à-ÿ-]', '', 'g');
    v_name := regexp_replace(v_name, '-{2,}', '-', 'g');
    v_name := trim(both '-' from v_name);
  else
    v_name := regexp_replace(trim(p_name), '\s+', ' ', 'g');
  end if;
  v_name := left(coalesce(v_name, ''), 40);
  if char_length(v_name) < 1 then raise exception 'Dê um nome ao canal.'; end if;
  if (select count(*) from public.room_channels where room_id = p_room) >= 50 then
    raise exception 'Limite de 50 canais por sala.';
  end if;
  select coalesce(array_agg(id), '{}') into v_roles from public.room_roles where room_id = p_room and id = any (coalesce(p_roles, '{}'));
  begin
    insert into public.room_channels (room_id, kind, name, is_private, role_ids, created_by)
    values (p_room, p_kind, v_name, coalesce(p_private, false), case when coalesce(p_private, false) then v_roles else '{}' end, v_uid)
    returning * into v_row;
  exception when unique_violation then
    raise exception 'Já existe um canal com esse nome.';
  end;
  return v_row;
end;
$$;

create or replace function public.delete_channel(p_channel uuid) returns void
  language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if not exists (select 1 from public.room_channels c join public.room_members m on m.room_id = c.room_id
                 where c.id = p_channel and m.user_id = v_uid and m.base_role in ('owner', 'moderator')) then
    raise exception 'Só o dono e os moderadores apagam canais.';
  end if;
  delete from public.room_channels where id = p_channel;
end;
$$;

revoke all on public.room_channels from public, anon;
grant select on public.room_channels to authenticated;
revoke all on function public.can_see_channel(uuid), public.channel_ok(uuid, uuid), public.create_channel(uuid, text, text, boolean, uuid[]), public.delete_channel(uuid) from public, anon;
grant execute on function public.can_see_channel(uuid), public.channel_ok(uuid, uuid), public.create_channel(uuid, text, text, boolean, uuid[]), public.delete_channel(uuid) to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_channels') then
    alter publication supabase_realtime add table public.room_channels;
  end if;
end $$;
