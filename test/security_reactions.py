"""Teste transacional opcional: requer psycopg e DATABASE_URL no ambiente.

RESENHA_TEST_POLICY=proposed aplica a migração dentro da transação de teste.
Nenhuma alteração é confirmada no banco.
"""
import os
from pathlib import Path
import psycopg
from psycopg.errors import InsufficientPrivilege

with psycopg.connect(os.environ['DATABASE_URL'], connect_timeout=10) as db:
    try:
        with db.cursor() as cursor:
            cursor.execute('''
                select msg.id, other.room_id, visible.user_id, msg.room_id
                from public.messages msg
                join public.room_members visible on visible.room_id = msg.room_id
                join public.room_members other on other.user_id = visible.user_id and other.room_id <> msg.room_id
                where (select count(*) from public.message_reactions r
                       where r.message_id = msg.id and r.user_id = visible.user_id) < 12
                limit 1
            ''')
            candidate = cursor.fetchone()
            if not candidate:
                raise RuntimeError('Não há dados adequados para testar a política.')
            if os.environ.get('RESENHA_TEST_POLICY') == 'proposed':
                migration = Path(__file__).resolve().parents[1] / 'supabase/migrations/20261121000300_reacoes_mesma_sala.sql'
                cursor.execute(migration.read_text(encoding='utf-8'))
            message_id, room_id, user_id, actual_room_id = candidate
            cursor.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(user_id),))
            cursor.execute('set local role authenticated')
            cursor.execute('savepoint invalid_reaction')
            try:
                cursor.execute('insert into public.message_reactions(message_id, room_id, user_id, emoji) values (%s, %s, %s, %s)',
                               (message_id, room_id, user_id, '🧪'))
            except InsufficientPrivilege:
                cursor.execute('rollback to savepoint invalid_reaction')
                print('OK: reação em sala diferente foi bloqueada.')
            else:
                raise AssertionError('A política aceitou uma reação em sala diferente da mensagem.')
            cursor.execute('insert into public.message_reactions(message_id, room_id, user_id, emoji) values (%s, %s, %s, %s)',
                           (message_id, actual_room_id, user_id, '🧪'))
            print('OK: reação na sala correta foi aceita.')
    finally:
        db.rollback()
