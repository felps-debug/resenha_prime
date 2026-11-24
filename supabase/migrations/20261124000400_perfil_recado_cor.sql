-- Perfil: recado (frase curta) e cor do cartão/avatar. Aditivo.
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists accent_color text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_bio_check') then
    alter table public.profiles add constraint profiles_bio_check check (bio is null or char_length(bio) <= 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_accent_color_check') then
    alter table public.profiles add constraint profiles_accent_color_check check (accent_color is null or accent_color ~ '^#[0-9a-fA-F]{6}$');
  end if;
end $$;
