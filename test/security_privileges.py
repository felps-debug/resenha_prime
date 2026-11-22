"""Confere privilégios perigosos; opção proposed executa a migração sem confirmar."""
import os
from pathlib import Path
import psycopg

with psycopg.connect(os.environ['DATABASE_URL'], connect_timeout=10) as db:
    try:
        with db.cursor() as c:
            if os.environ.get('RESENHA_TEST_POLICY') == 'proposed':
                c.execute((Path(__file__).resolve().parents[1] / 'supabase/migrations/20261121000400_limitar_privilegios.sql').read_text(encoding='utf-8'))
            c.execute('''select c.relname, r.role_name, p.privilege
                from pg_class c join pg_namespace n on n.oid=c.relnamespace
                cross join (values ('anon'), ('authenticated')) r(role_name)
                cross join (values ('TRUNCATE'), ('TRIGGER'), ('REFERENCES'), ('INSERT'), ('UPDATE'), ('DELETE')) p(privilege)
                where n.nspname='public' and c.relkind in ('r','p')
                  and (r.role_name='anon' or p.privilege in ('TRUNCATE','TRIGGER','REFERENCES'))
                  and has_table_privilege(r.role_name,c.oid,p.privilege)''')
            bad = c.fetchall()
            if bad:
                raise AssertionError(f'Privilégios indevidos encontrados: {len(bad)}')
            print('OK: anon sem escrita e papéis comuns sem TRUNCATE, TRIGGER ou REFERENCES.')
    finally:
        db.rollback()
