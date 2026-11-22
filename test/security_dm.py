"""Testes de isolamento de DM usando transação revertida."""
import os
import psycopg
from psycopg.errors import RaiseException

with psycopg.connect(os.environ['DATABASE_URL'], connect_timeout=10) as db:
    try:
        with db.cursor() as c:
            c.execute('''select a.user_id,b.user_id,p.id from public.room_members a
                join public.room_members b on b.room_id=a.room_id and b.user_id<>a.user_id
                join public.rooms r on r.id=a.room_id and r.kind='room'
                cross join public.profiles p
                where p.id<>a.user_id and p.id<>b.user_id and not public.shares_room(p.id,a.user_id)
                limit 1''')
            row = c.fetchone()
            if not row:
                raise RuntimeError('Dados insuficientes para o teste de DM.')
            first, second, attacker = row
            c.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(first),))
            c.execute('set local role authenticated')
            c.execute('select public.open_dm(%s)', (second,))
            room = c.fetchone()[0]
            c.execute('insert into public.messages(room_id,user_id,content) values (%s,%s,%s) returning id', (room, first, 'teste privado'))
            message = c.fetchone()[0]
            c.execute('insert into public.message_reactions(room_id,message_id,user_id,emoji) values (%s,%s,%s,%s)', (room, message, first, '🧪'))
            c.execute('reset role')
            c.execute('select invite_code from public.rooms where id=%s', (room,))
            code = c.fetchone()[0]
            c.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(attacker),))
            c.execute('set local role authenticated')
            for table in ('messages', 'message_reactions', 'room_members', 'room_roles'):
                c.execute(f'select count(*) from public.{table} where room_id=%s', (room,))
                if c.fetchone()[0]:
                    raise AssertionError(f'Usuário externo lê {table} de DM alheia.')
            c.execute('select count(*) from public.invite_preview(%s)', (code,))
            assert c.fetchone()[0] == 0, 'Código de DM foi exposto como convite.'
            for label, query, value in (
                ('convite de DM', 'select public.join_room(null,%s)', code),
                ('DM sem sala em comum', 'select public.open_dm(%s)', first),
            ):
                c.execute('savepoint attempt')
                try:
                    c.execute(query, (value,))
                except RaiseException:
                    c.execute('rollback to savepoint attempt')
                else:
                    raise AssertionError(f'A operação {label} foi aceita.')
            print('OK: DM privada, convites bloqueados e restrição de sala em comum.')
    finally:
        db.rollback()
