"""Testa abertura simultânea com duas contas temporárias, removidas ao final."""
import concurrent.futures
import os
import secrets
import subprocess
import sys
import threading
import uuid
from pathlib import Path
import psycopg

root = Path(__file__).resolve().parent
fixtures = []

def fixture():
    env = os.environ.copy()
    env['RESENHA_FIXTURE_ID'] = str(uuid.uuid4())
    env['RESENHA_FIXTURE_EMAIL'] = f'resenha-teste-{uuid.uuid4()}@example.com'
    env['RESENHA_FIXTURE_PASSWORD'] = secrets.token_hex(20)
    return env

def run_fixture(action, env):
    subprocess.run([sys.executable, str(root / 'browser_fixture.py'), action], env=env, check=True, capture_output=True)

try:
    for _ in range(2):
        user = fixture()
        run_fixture('setup', user)
        fixtures.append(user)
    barrier = threading.Barrier(2, timeout=10)
    def open_dm(source, target):
        with psycopg.connect(os.environ['DATABASE_URL'], connect_timeout=10) as conn:
            with conn.cursor() as cursor:
                cursor.execute("set local statement_timeout = '15s'")
                cursor.execute("select set_config('request.jwt.claim.sub', %s, true)", (source['RESENHA_FIXTURE_ID'],))
                cursor.execute('set local role authenticated')
                barrier.wait()
                cursor.execute('select public.open_dm(%s)', (target['RESENHA_FIXTURE_ID'],))
                return cursor.fetchone()[0]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(open_dm, fixtures[0], fixtures[1]), pool.submit(open_dm, fixtures[1], fixtures[0])]
        first, second = [future.result(timeout=30) for future in futures]
    assert first == second, 'A abertura simultânea criou conversas diferentes.'
    with psycopg.connect(os.environ['DATABASE_URL'], connect_timeout=10) as conn:
        with conn.cursor() as cursor:
            cursor.execute('select count(*) from public.room_members where room_id=%s', (first,))
            assert cursor.fetchone()[0] == 2, 'A conversa não tem os dois participantes.'
    print('OK: abertura simultânea criou uma única DM com duas pessoas.')
finally:
    errors = []
    for user in reversed(fixtures):
        try:
            run_fixture('cleanup', user)
        except Exception as exc:
            errors.append(str(exc))
    if errors:
        raise RuntimeError('Falha ao remover contas temporárias: ' + '; '.join(errors))
