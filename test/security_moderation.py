"""Valida hierarquia de moderação sem confirmar alterações."""
import os
import psycopg
from psycopg.errors import RaiseException

with psycopg.connect(os.environ['DATABASE_URL'], connect_timeout=10) as db:
    try:
        with db.cursor() as c:
            for target_role in ('owner', 'moderator'):
                c.execute('''select a.room_id,a.user_id,b.user_id from public.room_members a
                    join public.room_members b on b.room_id=a.room_id
                    where a.base_role='member' and b.base_role=%s limit 1''', (target_role,))
                pair = c.fetchone()
                if not pair:
                    raise RuntimeError(f'Sem dados para testar membro contra {target_role}.')
                room, member, target = pair
                c.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(member),))
                c.execute('set local role authenticated')
                for label, query in (
                    ('kick', 'select public.kick_member(%s,%s)'),
                    ('ban', 'select public.ban_member(%s,%s,null)'),
                ):
                    c.execute('savepoint attempt')
                    try:
                        c.execute(query, (room,target))
                    except RaiseException:
                        c.execute('rollback to savepoint attempt')
                    else:
                        raise AssertionError(f'Membro conseguiu executar {label} contra {target_role}.')
                c.execute('reset role')
                print(f'OK: membro não expulsa nem bane {target_role}.')
    finally:
        db.rollback()
