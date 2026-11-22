"""Verifica isolamento entre salas com identidades reais, sem confirmar alterações."""
import os
import psycopg
from psycopg.errors import InsufficientPrivilege

with psycopg.connect(os.environ['DATABASE_URL'], connect_timeout=10) as db:
    try:
        with db.cursor() as c:
            c.execute('''select m.room_id, m.id, p.id from public.messages m
                cross join public.profiles p
                where not exists (select 1 from public.room_members x where x.room_id=m.room_id and x.user_id=p.id)
                limit 1''')
            row = c.fetchone()
            if not row:
                raise RuntimeError('Não há sala com mensagens e usuário externo para testar.')
            room, message, attacker = row
            c.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(attacker),))
            c.execute('set local role authenticated')
            for table in ('messages', 'message_reactions', 'room_members', 'room_roles'):
                c.execute(f'select count(*) from public.{table} where room_id=%s', (room,))
                if c.fetchone()[0] != 0:
                    raise AssertionError(f'Usuário externo consegue ler {table} de outra sala.')
                print(f'OK: leitura de {table} bloqueada para usuário externo.')
            for label, sql, params in (
                ('mensagem', 'insert into public.messages(room_id,user_id,content) values (%s,%s,%s)', (room, attacker, 'teste transacional')),
                ('reação', 'insert into public.message_reactions(room_id,message_id,user_id,emoji) values (%s,%s,%s,%s)', (room, message, attacker, '🧪')),
            ):
                c.execute('savepoint tentativa')
                try:
                    c.execute(sql, params)
                except InsufficientPrivilege:
                    c.execute('rollback to savepoint tentativa')
                    print(f'OK: inserção de {label} bloqueada para usuário externo.')
                else:
                    raise AssertionError(f'Usuário externo conseguiu inserir {label}.')
            c.execute('select public.call_access(%s)', (room,))
            assert not c.fetchall(), 'Usuário externo recebeu acesso à call.'
            c.execute('reset role')
            c.execute('select user_id from public.messages where id=%s', (message,))
            author = c.fetchone()[0]
            c.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(author),))
            c.execute('set local role authenticated')
            c.execute('update public.messages set content=content where id=%s returning id', (message,))
            assert not c.fetchall(), 'Usuário conseguiu alterar mensagem diretamente.'
            print('OK: call bloqueada para usuário externo e alteração direta de mensagem negada.')
    finally:
        db.rollback()
