-- Uma DM fechada reaparece quando a outra pessoa envia uma nova mensagem.
-- Grupos não são reabertos: sair de um grupo continua sendo definitivo.
create or replace function public.reopen_dm_on_message()
returns trigger language plpgsql security definer set search_path = '' as $$
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

revoke all on function public.reopen_dm_on_message() from public, anon, authenticated;
drop trigger if exists messages_reopen_dm on public.messages;
create trigger messages_reopen_dm after insert on public.messages
  for each row execute function public.reopen_dm_on_message();
