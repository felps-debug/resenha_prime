"""Verifica a privacidade do bucket de chat sem criar arquivos no Storage."""
import os
import psycopg
from psycopg.errors import InsufficientPrivilege

with psycopg.connect(os.environ['DATABASE_URL'], connect_timeout=10) as db:
    try:
        with db.cursor() as c:
            c.execute('''select m.room_id,m.user_id,p.id from public.room_members m cross join public.profiles p
                where p.id<>m.user_id and not exists
                (select 1 from public.room_members x where x.room_id=m.room_id and x.user_id=p.id) limit 1''')
            row = c.fetchone()
            if not row:
                raise RuntimeError('Dados insuficientes para testar armazenamento.')
            room, member, outsider = row
            path = f'{room}/{member}/teste-transacional.gif'
            c.execute("select public from storage.buckets where id='chat'")
            assert c.fetchone() == (False,), 'Bucket de chat está público.'
            c.execute("insert into storage.objects(bucket_id,name) values ('chat',%s)", (path,))
            c.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(member),))
            c.execute('set local role authenticated')
            c.execute("select count(*) from storage.objects where bucket_id='chat' and name=%s", (path,))
            assert c.fetchone()[0] == 1, 'Membro não consegue ler objeto da própria sala.'
            c.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(outsider),))
            c.execute("select count(*) from storage.objects where bucket_id='chat' and name=%s", (path,))
            assert c.fetchone()[0] == 0, 'Pessoa externa consegue ler objeto de outra sala.'
            c.execute('savepoint forbidden_upload')
            try:
                c.execute("insert into storage.objects(bucket_id,name) values ('chat',%s)", (f'{room}/{outsider}/teste.gif',))
            except InsufficientPrivilege:
                c.execute('rollback to savepoint forbidden_upload')
            else:
                raise AssertionError('Pessoa externa conseguiu criar objeto na sala.')
            print('OK: bucket privado e acesso a imagens restrito aos membros.')
    finally:
        db.rollback()
