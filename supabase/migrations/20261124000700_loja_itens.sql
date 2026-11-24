-- Loja: todos os itens do catálogo. Aditivo. Nenhuma compra nasce no navegador: tudo passa pelo pagamento e pelo webhook.
-- Zoeiras em amigos (chapéu, nome rosa, apelido, fantasma) e Espelho; efeitos de tela e pacote; entrada triunfal, voz e soundboard; mascote (vaquinha); moldura.

alter table public.shop_items add column if not exists category text;
alter table public.shop_items add column if not exists target text;                -- member | self | room
alter table public.shop_items add column if not exists duration_minutes integer;   -- nulo = não expira (fica seu até usar/sempre)
alter table public.shop_items drop constraint if exists shop_items_target_check;
alter table public.shop_items add constraint shop_items_target_check check (target is null or target in ('member', 'self', 'room'));

insert into public.shop_items (id, name, price_cents, category, target, duration_minutes) values
  ('chapeu',         'Chapéu de palhaço',  99, 'Zoeira',          'member', 1440),
  ('nome-rosa',      'Nome rosa-chiclete', 50, 'Zoeira',          'member', 1440),
  ('apelido',        'Apelido forçado',    99, 'Zoeira',          'member', 60),
  ('fantasma',       'Modo fantasma',      50, 'Zoeira',          'member', 60),
  ('espelho',        'Espelho',            99, 'Zoeira',          'self',   null),
  ('gol',            '/gol',               99, 'Efeitos de tela', 'room',   null),
  ('parabens',       '/parabéns',          99, 'Efeitos de tela', 'room',   null),
  ('f',              '/F',                 99, 'Efeitos de tela', 'room',   null),
  ('terremoto',      '/terremoto',         99, 'Efeitos de tela', 'room',   null),
  ('pacote-efeitos', 'Pacote de efeitos', 249, 'Efeitos de tela', 'room',   null),
  ('entrada',        'Entrada triunfal',  199, 'Call',            'self',   null),
  ('voz',            'Voz zoada',         149, 'Call',            'self',   null),
  ('soundboard',     'Soundboard',        199, 'Call',            'self',   null),
  ('mascote',        'Mascote da sala',    50, 'Sala · vaquinha', 'room',   null),
  ('estilo',         'Moldura brilhante',  99, 'Estilo',          'self',   null)
on conflict (id) do update set name = excluded.name, price_cents = excluded.price_cents, category = excluded.category,
  target = excluded.target, duration_minutes = excluded.duration_minutes;
update public.shop_items set category = 'Telão', target = 'room', duration_minutes = 1440 where id = 'telao';

alter table public.purchases drop constraint if exists apelido_text;
alter table public.purchases add constraint apelido_text check (
  item_id <> 'apelido' or coalesce(jsonb_typeof(extra->'text') = 'string' and char_length(extra->>'text') between 1 and 20, false)
);

-- Compras pagas ficam visíveis aos membros da sala enquanto valem (itens sem validade valem sempre)
drop policy if exists "compras proprias e efeitos da sala" on public.purchases;
create policy "compras proprias e efeitos da sala" on public.purchases for select to authenticated using (
  buyer_id = (select auth.uid())
  or (status = 'paid' and (expires_at is null or expires_at > now()) and public.is_room_member(room_id))
);

-- Cumpre a compra depois do pagamento confirmado: calcula a validade pelo item e aplica o Espelho
create or replace function public.fulfill_purchase(p_id uuid, p_session text, p_amount integer, p_currency text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  purchase public.purchases;
  item public.shop_items;
  mirror public.purchases;
begin
  select * into purchase from public.purchases where id = p_id for update;
  if purchase.id is null or purchase.stripe_session is distinct from p_session
     or purchase.price_cents is distinct from p_amount or p_currency is distinct from 'brl' then
    raise exception 'Pagamento não corresponde à compra.';
  end if;
  if purchase.status = 'paid' then return; end if;
  if purchase.status <> 'pending' then raise exception 'Compra não está pendente.'; end if;
  select * into item from public.shop_items where id = purchase.item_id;
  if item.id is null then raise exception 'Item inexistente.'; end if;

  -- Espelho: a zoeira volta para quem mandou, e o Espelho é gasto
  if item.target = 'member' then
    select * into mirror from public.purchases
     where item_id = 'espelho' and status = 'paid' and buyer_id = purchase.recipient_id and (expires_at is null or expires_at > now())
     order by paid_at limit 1 for update;
    if mirror.id is not null then
      update public.purchases set expires_at = now() where id = mirror.id;
      purchase.recipient_id := purchase.buyer_id;
      purchase.extra := purchase.extra || jsonb_build_object('mirrored', true);
    end if;
  end if;

  update public.purchases
     set status = 'paid', paid_at = now(), recipient_id = purchase.recipient_id, extra = purchase.extra,
         expires_at = case when item.duration_minutes is null then null else now() + (item.duration_minutes || ' minutes')::interval end
   where id = p_id;
end;
$$;
revoke all on function public.fulfill_purchase(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.fulfill_purchase(uuid, text, integer, text) to service_role;

-- Efeitos que todo mundo da sala vê (tela, entrada, soundboard)
create table if not exists public.room_effects (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists room_effects_sala on public.room_effects (room_id, id desc);
alter table public.room_effects enable row level security;
revoke all on public.room_effects from public, anon;
grant select on public.room_effects to authenticated;
drop policy if exists "membros veem efeitos" on public.room_effects;
create policy "membros veem efeitos" on public.room_effects for select to authenticated using (public.is_room_member(room_id));

-- Quem pode usar: dono do item (ou do pacote, para os quatro efeitos). Espera entre usos.
create or replace function public.shop_fire_effect(p_room uuid, p_item text, p_payload jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id bigint;
  v_last timestamptz;
  v_name text;
  v_gap interval;
begin
  if v_uid is null then raise exception 'Faça login de novo.'; end if;
  if not public.is_room_member(p_room) then raise exception 'Você não é membro desta sala.'; end if;
  if p_item not in ('gol', 'parabens', 'f', 'terremoto', 'entrada', 'soundboard') then raise exception 'Efeito inválido.'; end if;
  if not exists (
    select 1 from public.purchases pu
     where pu.buyer_id = v_uid and pu.status = 'paid' and (pu.expires_at is null or pu.expires_at > now())
       and (pu.item_id = p_item or (pu.item_id = 'pacote-efeitos' and p_item in ('gol', 'parabens', 'f', 'terremoto')))
  ) then
    raise exception 'Você ainda não tem esse item. Ele está na Loja.';
  end if;
  select max(created_at) into v_last from public.room_effects
   where room_id = p_room and (user_id = v_uid or p_item in ('gol', 'parabens', 'f', 'terremoto')) and item_id = p_item;
  v_gap := case when p_item = 'soundboard' then interval '2 seconds' else interval '15 seconds' end;
  if v_last is not null and now() - v_last < v_gap then
    raise exception 'Calma, espere um pouco para usar de novo.';
  end if;
  select display_name into v_name from public.profiles where id = v_uid;
  insert into public.room_effects (room_id, user_id, item_id, payload)
  values (p_room, v_uid, p_item, jsonb_build_object('name', v_name) || coalesce(p_payload, '{}'::jsonb)) returning id into v_id;
  delete from public.room_effects where created_at < now() - interval '1 day';
  return v_id;
end;
$$;
revoke all on function public.shop_fire_effect(uuid, text, jsonb) from public, anon;
grant execute on function public.shop_fire_effect(uuid, text, jsonb) to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_effects') then
    alter publication supabase_realtime add table public.room_effects;
  end if;
end $$;

-- Vaquinha da sala: meta e andamento
alter table public.rooms add column if not exists vaquinha_goal_cents integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rooms_vaquinha_goal_check') then
    alter table public.rooms add constraint rooms_vaquinha_goal_check check (vaquinha_goal_cents is null or vaquinha_goal_cents between 500 and 1000000);
  end if;
end $$;
create or replace function public.set_vaquinha_goal(p_room uuid, p_goal integer) returns void
  language plpgsql security definer set search_path to '' as $$
begin
  if not exists (select 1 from public.rooms where id = p_room and owner_id = (select auth.uid()) and kind = 'room') then raise exception 'Só o dono muda a meta.'; end if;
  update public.rooms set vaquinha_goal_cents = p_goal where id = p_room;
end;
$$;
create or replace function public.vaquinha_status(p_room uuid) returns jsonb
  language plpgsql stable security definer set search_path to '' as $$
declare v_goal integer; v_total bigint; v_top jsonb;
begin
  if not public.is_room_member(p_room) then raise exception 'Você não é membro desta sala.'; end if;
  select coalesce(vaquinha_goal_cents, 2000) into v_goal from public.rooms where id = p_room;
  select coalesce(sum(price_cents), 0) into v_total from public.purchases where room_id = p_room and item_id = 'mascote' and status = 'paid';
  select coalesce(jsonb_agg(jsonb_build_object('id', t.buyer_id, 'name', t.name, 'cents', t.cents) order by t.cents desc), '[]'::jsonb) into v_top
    from (select p.buyer_id, pr.display_name as name, sum(p.price_cents) as cents from public.purchases p join public.profiles pr on pr.id = p.buyer_id
           where p.room_id = p_room and p.item_id = 'mascote' and p.status = 'paid' group by p.buyer_id, pr.display_name order by sum(p.price_cents) desc limit 5) t;
  return jsonb_build_object('goal', v_goal, 'total', v_total, 'level', v_total / v_goal, 'progress', v_total % v_goal, 'top', v_top);
end;
$$;
revoke all on function public.set_vaquinha_goal(uuid, integer), public.vaquinha_status(uuid) from public, anon;
grant execute on function public.set_vaquinha_goal(uuid, integer), public.vaquinha_status(uuid) to authenticated;
