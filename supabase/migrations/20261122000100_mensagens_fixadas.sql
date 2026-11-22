-- Qualquer membro pode fixar ou desafixar uma mensagem da própria sala.
create table if not exists public.room_pins (
  room_id uuid not null references public.rooms(id) on delete cascade,
  message_id bigint not null references public.messages(id) on delete cascade,
  pinned_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, message_id)
);
alter table public.room_pins enable row level security;
revoke all on public.room_pins from public, anon, authenticated;
grant select, insert, delete on public.room_pins to authenticated;
grant all on public.room_pins to service_role;
drop policy if exists "membros veem fixadas" on public.room_pins;
create policy "membros veem fixadas" on public.room_pins for select to authenticated
  using (public.is_room_member(room_id));
drop policy if exists "membros fixam mensagens" on public.room_pins;
create policy "membros fixam mensagens" on public.room_pins for insert to authenticated
  with check (
    pinned_by = (select auth.uid()) and public.is_room_member(room_id)
    and exists (select 1 from public.messages m where m.id=room_pins.message_id and m.room_id=room_pins.room_id)
  );
drop policy if exists "membros desafixam mensagens" on public.room_pins;
create policy "membros desafixam mensagens" on public.room_pins for delete to authenticated
  using (public.is_room_member(room_id));
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='room_pins') then
    alter publication supabase_realtime add table public.room_pins;
  end if;
end $$;
