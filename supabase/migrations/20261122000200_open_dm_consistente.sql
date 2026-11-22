-- Reabrir uma DM restaura só quem a abriu; a outra pessoa volta ao receber mensagem.
-- A chave única também impede duas DMs quando ambos iniciam simultaneamente.
create or replace function public.open_dm(p_user uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
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
revoke all on function public.open_dm(uuid) from public, anon;
grant execute on function public.open_dm(uuid) to authenticated;
