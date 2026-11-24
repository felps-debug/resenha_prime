-- Perfil da sala: cor e ícone. Aditivo. set_room_profile e explore_rooms (criadas há pouco, ainda sem uso em produção) ganham os campos novos.

alter table public.rooms add column if not exists color text;
alter table public.rooms add column if not exists icon_url text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rooms_color_check') then
    alter table public.rooms add constraint rooms_color_check check (color is null or color ~ '^#[0-9a-fA-F]{6}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rooms_icon_url_check') then
    alter table public.rooms add constraint rooms_icon_url_check check (icon_url is null or (char_length(icon_url) <= 500 and icon_url ~ '^https://'));
  end if;
end $$;

drop function if exists public.set_room_profile(uuid, text, text);
create or replace function public.set_room_profile(
  p_room uuid, p_description text, p_category text, p_color text default null, p_icon text default null
) returns void
  language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if not exists (select 1 from public.rooms where id = p_room and owner_id = v_uid and kind = 'room') then
    raise exception 'Só o dono muda isso.';
  end if;
  if p_category is not null and p_category not in ('jogos', 'estudo', 'musica', 'papo') then
    raise exception 'Categoria inválida.';
  end if;
  update public.rooms
     set description = nullif(left(trim(coalesce(p_description, '')), 140), ''),
         category = p_category,
         color = case when p_color ~ '^#[0-9a-fA-F]{6}$' then lower(p_color) else null end,
         icon_url = case when p_icon ~ '^https://' then left(p_icon, 500) else null end
   where id = p_room;
end;
$$;

drop function if exists public.explore_rooms();
create or replace function public.explore_rooms() returns table (
  id uuid, name text, description text, category text, color text, icon_url text, member_count bigint, created_at timestamptz
) language sql stable security definer set search_path to '' as $$
  select r.id, r.name, r.description, r.category, r.color, r.icon_url,
         (select count(*) from public.room_members m where m.room_id = r.id) as member_count,
         r.created_at
  from public.rooms r
  where r.is_public and r.kind = 'room' and (select auth.uid()) is not null
  order by member_count desc, r.created_at desc
  limit 100;
$$;

revoke all on function public.set_room_profile(uuid, text, text, text, text), public.explore_rooms() from public, anon;
grant execute on function public.set_room_profile(uuid, text, text, text, text), public.explore_rooms() to authenticated;
