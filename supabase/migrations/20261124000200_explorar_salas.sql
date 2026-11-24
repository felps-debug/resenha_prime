-- Explorar salas: descrição e categoria da sala, e a lista pública com a contagem de membros. Aditivo.

alter table public.rooms add column if not exists description text;
alter table public.rooms add column if not exists category text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rooms_description_check') then
    alter table public.rooms add constraint rooms_description_check check (description is null or char_length(description) <= 140);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rooms_category_check') then
    alter table public.rooms add constraint rooms_category_check check (category is null or category in ('jogos', 'estudo', 'musica', 'papo'));
  end if;
end $$;

-- Só o dono muda a descrição e a categoria.
create or replace function public.set_room_profile(p_room uuid, p_description text, p_category text) returns void
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
     set description = nullif(left(trim(coalesce(p_description, '')), 140), ''), category = p_category
   where id = p_room;
end;
$$;

-- Salas públicas para a tela Explorar (qualquer pessoa logada vê; só as marcadas como públicas).
create or replace function public.explore_rooms() returns table (
  id uuid, name text, description text, category text, member_count bigint, created_at timestamptz
) language sql stable security definer set search_path to '' as $$
  select r.id, r.name, r.description, r.category,
         (select count(*) from public.room_members m where m.room_id = r.id) as member_count,
         r.created_at
  from public.rooms r
  where r.is_public and r.kind = 'room' and (select auth.uid()) is not null
  order by member_count desc, r.created_at desc
  limit 100;
$$;

revoke all on function public.set_room_profile(uuid, text, text), public.explore_rooms() from public, anon;
grant execute on function public.set_room_profile(uuid, text, text), public.explore_rooms() to authenticated;
