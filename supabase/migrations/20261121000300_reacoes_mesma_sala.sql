-- A sala da reação precisa ser a sala da mensagem, inclusive em chamadas diretas à API.
drop policy if exists "membros reagem" on public.message_reactions;
create policy "membros reagem" on public.message_reactions
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and public.is_room_member(room_id)
    and exists (
      select 1 from public.messages m
      where m.id = message_reactions.message_id
        and m.room_id = message_reactions.room_id
    )
  );
