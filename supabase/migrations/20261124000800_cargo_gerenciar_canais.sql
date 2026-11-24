-- Permissão "Gerenciar canais" para cargos. Aditivo: dono e moderadores continuam podendo sempre.

alter table public.room_roles add column if not exists can_manage_channels boolean not null default false;

-- Quem gerencia canais: dono, moderadores ou quem tem um cargo com a permissão
create or replace function public.can_manage_channels(p_room uuid) returns boolean
  language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.room_members m
    left join public.room_roles r on r.id = m.role_id
    where m.room_id = p_room and m.user_id = (select auth.uid())
      and (m.base_role in ('owner', 'moderator') or coalesce(r.can_manage_channels, false))
  );
$$;
revoke all on function public.can_manage_channels(uuid) from public, anon;
grant execute on function public.can_manage_channels(uuid) to authenticated;

-- Liga ou desliga a permissão de um cargo (dono ou quem gerencia cargos)
create or replace function public.set_role_channels(p_role uuid, p_value boolean) returns void
  language plpgsql security definer set search_path to '' as $$
declare v_room uuid;
begin
  select room_id into v_room from public.room_roles where id = p_role;
  if v_room is null then raise exception 'Cargo inexistente.'; end if;
  if public.member_rank(v_room, (select auth.uid())) < 2 then raise exception 'Só o dono e os moderadores mudam isso.'; end if;
  update public.room_roles set can_manage_channels = coalesce(p_value, false) where id = p_role;
end;
$$;
revoke all on function public.set_role_channels(uuid, boolean) from public, anon;
grant execute on function public.set_role_channels(uuid, boolean) to authenticated;

-- create_channel e delete_channel passam a usar a nova checagem
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
  if not exists (select 1 from public.rooms r where r.id = p_room and r.kind = 'room') or not public.can_manage_channels(p_room) then
    raise exception 'Você não tem permissão para criar canais. Peça ao dono da sala.';
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
declare v_room uuid;
begin
  select room_id into v_room from public.room_channels where id = p_channel;
  if v_room is null or not public.can_manage_channels(v_room) then
    raise exception 'Você não tem permissão para apagar canais.';
  end if;
  delete from public.room_channels where id = p_channel;
end;
$$;
