-- Loja: total arrecadado no mês (só o agregado; ninguém vê compras dos outros por aqui). Aditivo.
create or replace function public.shop_month_total() returns bigint
  language sql stable security definer set search_path to '' as $$
  select coalesce(sum(price_cents), 0)::bigint
  from public.purchases
  where status = 'paid' and paid_at >= date_trunc('month', now()) and (select auth.uid()) is not null;
$$;
revoke all on function public.shop_month_total() from public, anon;
grant execute on function public.shop_month_total() to authenticated;
