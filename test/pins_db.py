"""Valida mensagens fixadas em uma transação que sempre é revertida."""
import os
from pathlib import Path
import psycopg
from psycopg.errors import InsufficientPrivilege

with psycopg.connect(os.environ['DATABASE_URL'], connect_timeout=10) as db:
    try:
        with db.cursor() as c:
            if os.environ.get('RESENHA_TEST_POLICY') == 'proposed':
                c.execute((Path(__file__).resolve().parents[1] / 'supabase/migrations/20261122000100_mensagens_fixadas.sql').read_text(encoding='utf-8'))
            c.execute('''select m.id, m.room_id, a.user_id, b.room_id
                from public.messages m join public.room_members a on a.room_id=m.room_id
                join public.room_members b on b.user_id=a.user_id and b.room_id<>m.room_id
                limit 1''')
            row = c.fetchone()
            if not row:
                raise RuntimeError('Dados insuficientes para testar mensagens fixadas.')
            message, room, member, other_room = row
            c.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(member),))
            c.execute('set local role authenticated')
            c.execute('savepoint cross_room')
            try:
                c.execute('insert into public.room_pins(room_id,message_id,pinned_by) values (%s,%s,%s)', (other_room,message,member))
            except InsufficientPrivilege:
                c.execute('rollback to savepoint cross_room')
            else:
                raise AssertionError('Uma mensagem foi fixada em outra sala.')
            c.execute('insert into public.room_pins(room_id,message_id,pinned_by) values (%s,%s,%s)', (room,message,member))
            c.execute('select count(*) from public.room_pins where room_id=%s and message_id=%s', (room,message))
            assert c.fetchone()[0] == 1, 'Membro não conseguiu ler a mensagem fixada.'
            c.execute('reset role')
            c.execute('''select id from public.profiles p where not exists
                (select 1 from public.room_members rm where rm.room_id=%s and rm.user_id=p.id) limit 1''', (room,))
            outsider = c.fetchone()
            if not outsider:
                raise RuntimeError('Nenhum usuário externo para testar.')
            c.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(outsider[0]),))
            c.execute('set local role authenticated')
            c.execute('select count(*) from public.room_pins where room_id=%s', (room,))
            assert c.fetchone()[0] == 0, 'Usuário externo leu mensagens fixadas.'
            c.execute('savepoint outsider_insert')
            try:
                c.execute('insert into public.room_pins(room_id,message_id,pinned_by) values (%s,%s,%s)', (room,message,outsider[0]))
            except InsufficientPrivilege:
                c.execute('rollback to savepoint outsider_insert')
            else:
                raise AssertionError('Usuário externo fixou mensagem.')
            print('OK: fixação autorizada, isolamento por sala e privacidade.')
    finally:
        db.rollback()
