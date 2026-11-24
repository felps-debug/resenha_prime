"""Monitor dos usuários do Resenha (só leitura). Mostra quem se cadastrou, se confirmou o e-mail, se já entrou,
em quais salas está, quantas mensagens mandou e quando foi a última atividade.

Uso:  python scripts/monitor_usuarios.py            (todos, mais novos primeiro)
      python scripts/monitor_usuarios.py --dias 2   (só quem se cadastrou nos últimos 2 dias)
Lê DATABASE_URL do .env do projeto. Não altera nada no banco.
"""
import re, sys
from pathlib import Path
import psycopg

ROOT = Path(__file__).resolve().parent.parent
env = {}
for linha in (ROOT / '.env').read_text(encoding='utf-8').splitlines():
    m = re.match(r'\s*([A-Z_]+)\s*=\s*(.*)\s*$', linha)
    if m: env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
dias = None
if '--dias' in sys.argv:
    dias = int(sys.argv[sys.argv.index('--dias') + 1])

SQL = """
select u.created_at, coalesce(p.display_name, '(sem perfil)') as nome, u.email,
       u.email_confirmed_at is not null as confirmou, u.last_sign_in_at,
       coalesce((select string_agg(r.name, ', ' order by m.joined_at) from public.room_members m join public.rooms r on r.id = m.room_id where m.user_id = u.id and r.kind = 'room'), '') as salas,
       (select count(*) from public.messages x where x.user_id = u.id and x.kind = 'user') as mensagens,
       (select max(x.created_at) from public.messages x where x.user_id = u.id) as ultima_msg
from auth.users u left join public.profiles p on p.id = u.id
where (%s::int is null or u.created_at > now() - make_interval(days => %s::int))
order by u.created_at desc
"""
def fmt(d): return d.astimezone().strftime('%d/%m %H:%M') if d else '-'
with psycopg.connect(env['DATABASE_URL']) as c:
    rows = c.execute(SQL, (dias, dias)).fetchall()
    total = c.execute('select count(*) from auth.users').fetchone()[0]
    sem_conf = sum(1 for r in rows if not r[3])
    nunca = sum(1 for r in rows if r[3] and not r[4])
    print(f"{total} contas no total | {len(rows)} no filtro | {sem_conf} sem confirmar e-mail | {nunca} confirmaram e nunca entraram\n")
    print(f"{'cadastro':11} {'nome':20} {'e-mail':32} {'conf':4} {'último login':12} {'msgs':4} {'última msg':11} salas")
    for cad, nome, email, conf, login, salas, msgs, ult in rows:
        print(f"{fmt(cad):11} {nome[:20]:20} {(email or '')[:32]:32} {'sim' if conf else 'NÃO':4} {fmt(login):12} {msgs:<4} {fmt(ult):11} {salas}")
