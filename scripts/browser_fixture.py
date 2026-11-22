"""Cria ou remove exclusivamente a conta temporária usada no teste de interface."""
import os
import sys
import psycopg

uid = os.environ['RESENHA_FIXTURE_ID']
email = os.environ['RESENHA_FIXTURE_EMAIL']
if not email.startswith('resenha-teste-') or not email.endswith('@example.com'):
    raise ValueError('E-mail de teste inválido.')

with psycopg.connect(os.environ['DATABASE_URL'], connect_timeout=10) as db:
    with db.cursor() as c:
        if sys.argv[1] == 'setup':
            c.execute('''insert into auth.users
              (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
               raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
               confirmation_token, recovery_token, email_change_token_new, email_change)
              values ('00000000-0000-0000-0000-000000000000', %s, 'authenticated', 'authenticated', %s,
                extensions.crypt(%s, extensions.gen_salt('bf')), now(),
                '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', %s::text), now(), now(), '', '', '', '')''',
              (uid, email, os.environ['RESENHA_FIXTURE_PASSWORD'], os.environ.get('RESENHA_FIXTURE_NAME', 'Teste Automático')))
            c.execute('''insert into auth.identities(provider_id, user_id, identity_data, provider, created_at, updated_at)
              values (%s, %s, jsonb_build_object('sub', %s::text, 'email', %s::text, 'email_verified', true), 'email', now(), now())''',
              (uid, uid, uid, email))
            c.execute('insert into public.room_members(room_id, user_id) values (%s, %s)', (os.environ['TEST_ROOM_ID'], uid))
        elif sys.argv[1] == 'banner':
            c.execute('''insert into public.purchases
              (buyer_id, recipient_id, room_id, item_id, price_cents, status, extra, paid_at, expires_at)
              values (%s, %s, %s, 'telao', 50, 'paid', '{"text":"Telão de teste automatizado"}', now(), now() + interval '24 hours')''',
              (uid, uid, os.environ['TEST_ROOM_ID']))
        elif sys.argv[1] == 'cleanup':
            c.execute('delete from public.purchases where buyer_id=%s', (uid,))
            c.execute("delete from public.rooms where kind='dm' and (split_part(dm_key, ':', 1)=%s or split_part(dm_key, ':', 2)=%s)", (uid, uid))
            c.execute("delete from public.rooms where kind='group' and owner_id=%s", (uid,))
            c.execute('delete from auth.users where id=%s and email=%s', (uid, email))
        else:
            raise ValueError('Operação desconhecida.')
