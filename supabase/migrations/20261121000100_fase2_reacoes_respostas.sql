-- Resenha v3 — fase 2: responder mensagens e reações
-- Só acrescenta coisas; não altera nem apaga dados existentes. Pode rodar de novo sem problema.

-- 1) Responder: a mensagem guarda qual mensagem ela responde
alter table public.messages
  add column if not exists reply_to bigint references public.messages(id) on delete set null;

-- A resposta precisa ser de uma mensagem da mesma sala; se não for, é ignorada
create or replace function public.check_reply_same_room()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.reply_to is not null and not exists (
    select 1 from public.messages m where m.id = new.reply_to and m.room_id = new.room_id
  ) then
    new.reply_to := null;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_reply_same_room on public.messages;
create trigger messages_reply_same_room before insert on public.messages
  for each row execute function public.check_reply_same_room();

-- 2) Reações
create table if not exists public.message_reactions (
  message_id bigint not null references public.messages(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index if not exists message_reactions_room_idx on public.message_reactions(room_id);

alter table public.message_reactions enable row level security;

drop policy if exists "membros veem reacoes" on public.message_reactions;
create policy "membros veem reacoes" on public.message_reactions
  for select to authenticated using (public.is_room_member(room_id));

drop policy if exists "membros reagem" on public.message_reactions;
create policy "membros reagem" on public.message_reactions
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and public.is_room_member(room_id)
    and exists (select 1 from public.messages m where m.id = message_id and m.room_id = room_id)
  );

drop policy if exists "tirar propria reacao" on public.message_reactions;
create policy "tirar propria reacao" on public.message_reactions
  for delete to authenticated using (user_id = (select auth.uid()));

-- Limite: no máximo 12 emojis diferentes por pessoa em cada mensagem
create or replace function public.limit_reactions()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if (select count(*) from public.message_reactions r
      where r.message_id = new.message_id and r.user_id = new.user_id) >= 12 then
    raise exception 'Calma! Reações demais nessa mensagem.';
  end if;
  return new;
end;
$$;

drop trigger if exists message_reactions_limit on public.message_reactions;
create trigger message_reactions_limit before insert on public.message_reactions
  for each row execute function public.limit_reactions();

-- Tempo real
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions') then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end $$;
