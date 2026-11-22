"""Testa a migração da loja sem manter alterações no banco."""
import os
from pathlib import Path
import psycopg
from psycopg.errors import RaiseException, InsufficientPrivilege

with psycopg.connect(os.environ['DATABASE_URL'], connect_timeout=10) as db:
    try:
        with db.cursor() as c:
            c.execute((Path(__file__).resolve().parents[1] / 'supabase/migrations/20261121000600_loja_telao.sql').read_text(encoding='utf-8'))
            c.execute('select room_id,user_id from public.room_members limit 1')
            room, user = c.fetchone()
            c.execute('''insert into public.purchases (buyer_id,recipient_id,room_id,item_id,price_cents,stripe_session,extra)
                         values (%s,%s,%s,'telao',50,'cs_test_temp','{"text":"Teste"}') returning id''', (user,user,room))
            purchase = c.fetchone()[0]
            c.execute('savepoint wrong_value')
            try:
                c.execute('select public.fulfill_telao(%s,%s,%s,%s)', (purchase, 'cs_test_temp', 1, 'brl'))
            except RaiseException:
                c.execute('rollback to savepoint wrong_value')
            else:
                raise AssertionError('Valor adulterado foi aceito.')
            c.execute('set local role service_role')
            c.execute('select public.fulfill_telao(%s,%s,%s,%s)', (purchase, 'cs_test_temp', 50, 'brl'))
            c.execute('select expires_at from public.purchases where id=%s', (purchase,))
            expiry = c.fetchone()[0]
            c.execute('select public.fulfill_telao(%s,%s,%s,%s)', (purchase, 'cs_test_temp', 50, 'brl'))
            c.execute('select status,expires_at from public.purchases where id=%s', (purchase,))
            assert c.fetchone() == ('paid', expiry), 'Repetição modificou a compra.'
            c.execute('reset role')
            c.execute('''select id from public.profiles p where p.id<>%s
                and not exists(select 1 from public.room_members m where m.room_id=%s and m.user_id=p.id) limit 1''', (user,room))
            outsider = c.fetchone()
            if outsider:
                c.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(outsider[0]),))
                c.execute('set local role authenticated')
                c.execute('select count(*) from public.purchases where id=%s', (purchase,))
                assert c.fetchone()[0] == 0, 'Uma pessoa de fora da sala leu a compra.'
                c.execute('reset role')
            c.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(user),))
            c.execute('set local role authenticated')
            c.execute('savepoint forgery')
            try:
                c.execute("update public.purchases set status='paid' where id=%s", (purchase,))
            except InsufficientPrivilege:
                c.execute('rollback to savepoint forgery')
            else:
                raise AssertionError('Usuário comum pôde alterar compra.')
            print('OK: valor, idempotência, privacidade e proteção de escrita da loja.')
    finally:
        db.rollback()
