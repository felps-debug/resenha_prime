"""Testa a reabertura de DM dentro de uma transação sempre revertida."""
import os
from pathlib import Path
import psycopg

with psycopg.connect(os.environ['DATABASE_URL'], connect_timeout=10) as db:
    try:
        with db.cursor() as c:
            c.execute('''select a.user_id, b.user_id from public.room_members a
                join public.room_members b on b.room_id = a.room_id and b.user_id <> a.user_id
                join public.rooms r on r.id = a.room_id and r.kind = 'room' limit 1''')
            pair = c.fetchone()
            if not pair:
                raise RuntimeError('São necessárias duas pessoas na mesma sala para o teste.')
            sender, recipient = pair
            if os.environ.get('RESENHA_TEST_POLICY') == 'proposed':
                migration = Path(__file__).resolve().parents[1] / 'supabase/migrations/20261121000500_dm_reabrir.sql'
                c.execute(migration.read_text(encoding='utf-8'))
                migration = Path(__file__).resolve().parents[1] / 'supabase/migrations/20261122000200_open_dm_consistente.sql'
                c.execute(migration.read_text(encoding='utf-8'))
            c.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(sender),))
            c.execute('set local role authenticated')
            c.execute('select public.open_dm(%s)', (recipient,))
            room = c.fetchone()[0]
            c.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(recipient),))
            c.execute('select public.leave_room(%s)', (room,))
            c.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(sender),))
            c.execute('select public.open_dm(%s)', (recipient,))
            assert c.fetchone()[0] == room, 'Reabertura criou outra conversa.'
            c.execute('reset role')
            c.execute('select exists(select 1 from public.room_members where room_id=%s and user_id=%s)', (room, recipient))
            assert not c.fetchone()[0], 'Abrir a conversa reativou o destinatário antes de uma mensagem.'
            c.execute('set local role authenticated')
            c.execute('insert into public.messages(room_id, user_id, content) values (%s, %s, %s)', (room, sender, 'teste transacional'))
            c.execute('reset role')
            c.execute('select exists(select 1 from public.room_members where room_id=%s and user_id=%s)', (room, recipient))
            if not c.fetchone()[0]:
                raise AssertionError('A DM não reabriu para a pessoa ao receber mensagem.')
            print('OK: mensagem reabriu a DM para o destinatário.')
            c.execute('''select a.user_id, b.user_id, d.user_id from public.room_members a
                join public.room_members b on b.room_id=a.room_id and b.user_id<>a.user_id
                join public.room_members d on d.room_id=a.room_id and d.user_id<>a.user_id and d.user_id<>b.user_id
                join public.rooms r on r.id=a.room_id and r.kind='room' limit 1''')
            group = c.fetchone()
            if not group:
                raise RuntimeError('São necessárias três pessoas na mesma sala para testar grupos.')
            owner, leaving, remaining = group
            c.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(owner),))
            c.execute('set local role authenticated')
            c.execute('select public.create_group_dm(%s::uuid[], %s)', ([leaving, remaining], 'teste transacional'))
            group_id = c.fetchone()[0]
            c.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(leaving),))
            c.execute('select public.leave_room(%s)', (group_id,))
            c.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(owner),))
            c.execute('insert into public.messages(room_id, user_id, content) values (%s, %s, %s)', (group_id, owner, 'teste transacional'))
            c.execute('reset role')
            c.execute('select exists(select 1 from public.room_members where room_id=%s and user_id=%s)', (group_id, leaving))
            if c.fetchone()[0]:
                raise AssertionError('A pessoa que saiu de um grupo foi adicionada novamente.')
            print('OK: saída de grupo continua definitiva.')
    finally:
        db.rollback()
