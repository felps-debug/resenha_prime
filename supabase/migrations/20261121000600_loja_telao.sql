-- Primeiro item da loja. Nenhuma compra é gravada pelo navegador.
create table if not exists public.shop_items (
  id text primary key,
  name text not null,
  price_cents integer not null check (price_cents >= 50),
  active boolean not null default true
);
insert into public.shop_items (id, name, price_cents) values ('telao', 'Telão da sala', 50)
  on conflict (id) do nothing;

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id),
  recipient_id uuid not null references public.profiles(id),
  room_id uuid not null references public.rooms(id) on delete cascade,
  item_id text not null references public.shop_items(id),
  price_cents integer not null check (price_cents >= 50),
  stripe_session text unique,
  status text not null default 'pending' check (status in ('pending', 'paid', 'refunded')),
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  expires_at timestamptz,
  constraint telao_text check (item_id <> 'telao' or coalesce(jsonb_typeof(extra->'text') = 'string' and char_length(extra->>'text') between 1 and 40, false))
);
create index if not exists purchases_room_active on public.purchases(room_id, expires_at) where status='paid';
alter table public.shop_items enable row level security;
alter table public.purchases enable row level security;
revoke all on public.shop_items, public.purchases from public, anon, authenticated;
grant select on public.shop_items, public.purchases to authenticated;
grant all on public.shop_items, public.purchases to service_role;
drop policy if exists "catalogo ativo" on public.shop_items;
create policy "catalogo ativo" on public.shop_items for select to authenticated using (active);
drop policy if exists "compras proprias e efeitos da sala" on public.purchases;
create policy "compras proprias e efeitos da sala" on public.purchases for select to authenticated using (
  buyer_id = (select auth.uid()) or (status = 'paid' and expires_at > now() and public.is_room_member(room_id))
);

-- O bloqueio da linha garante que webhooks repetidos não renovem a duração.
create or replace function public.fulfill_telao(p_id uuid, p_session text, p_amount integer, p_currency text)
returns void language plpgsql security definer set search_path = '' as $$
declare purchase public.purchases;
begin
  select * into purchase from public.purchases where id = p_id for update;
  if purchase.id is null or purchase.stripe_session is distinct from p_session
     or purchase.price_cents is distinct from p_amount or p_currency is distinct from 'brl'
     or purchase.item_id <> 'telao' then
    raise exception 'Pagamento não corresponde à compra.';
  end if;
  if purchase.status = 'paid' then return; end if;
  if purchase.status <> 'pending' then raise exception 'Compra não está pendente.'; end if;
  update public.purchases set status = 'paid', paid_at = now(), expires_at = now() + interval '24 hours'
    where id = p_id;
end;
$$;
revoke all on function public.fulfill_telao(uuid,text,integer,text) from public, anon, authenticated;
grant execute on function public.fulfill_telao(uuid,text,integer,text) to service_role;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='purchases') then
    alter publication supabase_realtime add table public.purchases;
  end if;
end $$;
