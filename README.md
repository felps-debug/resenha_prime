# Resenha v2

Salas estilo Discord com login, chat salvo, cargos e call com voz, câmera e tela.

- **Call (LiveKit Cloud):** servidor de mídia SFU com TURN embutido. Aguenta 7 a 10 pessoas sem pesar no PC de ninguém.
- **Banco e login (Supabase):** contas, salas, cargos, banimentos e histórico do chat. Projeto `resenha`, região São Paulo, já criado e configurado.
- **Vercel:** entrega os arquivos do app pela CDN e executa as rotas Express em uma Function. O servidor gera as "chaves de entrada" da call só para membros da sala.

## O que tem nesta versão (Fase 1)

| Área | Recursos |
| --- | --- |
| Contas | Cadastro, login, recuperação de senha, login com Google (precisa ativar) |
| Salas | Criar sala, link de convite, sala pública ou privada, explorar salas públicas, sair e excluir |
| Cargos | Dono, moderador e membro; cargos personalizados com nome, cor e permissões (expulsar, banir, gerenciar cargos, apagar mensagens); passar a posse |
| Moderação | Expulsar e banir (derruba da call na hora), lista de banidos e desbanir |
| Áudio e vídeo | Cancelamento de eco e de ruído, mutar e ensurdecer, volume individual (0 a 200%), escolha de microfone, saída e câmera, teste do microfone, indicador de quem fala, câmera, transmissão de tela com áudio |
| Chat | Histórico salvo no banco, chat da sala disponível fora da call, apagar mensagens, links clicáveis, anti-flood (5 mensagens a cada 5 segundos) |

Todas as permissões são checadas **no banco** (RLS + funções), não só na tela. Mesmo que alguém mexa no código do navegador, não consegue expulsar, banir ou ler salas sem permissão.

---

## Configuração (uma vez só)

### 1. LiveKit Cloud (a call)

1. Crie uma conta em **https://cloud.livekit.io** (plano Build, grátis).
2. Crie um projeto, por exemplo `resenha`.
3. Vá em **Settings → API Keys → Create key**.
4. Anote três coisas:
   - **URL** do projeto, tipo `wss://resenha-xxxx.livekit.cloud`
   - **API Key**
   - **API Secret** (aparece uma vez só; guarde)

O plano grátis tem 5.000 minutos-pessoa por mês. Com 7 pessoas, isso dá umas 12 horas de call cheia. O consumo aparece no painel do LiveKit.

### 2. Vercel (o site e a API)

Importe o repositório no Vercel. O `vercel.json` configura o build, cabeçalhos de segurança e cache dos chunks com hash. Os arquivos dentro de `public/` são servidos pela CDN; as rotas Express ficam na Function. Não configure `public` como Output Directory nem use um Start Command.

Em **Project → Settings → Environment Variables**, adicione para Production e Preview:

| Variável | Valor |
| --- | --- |
| `LIVEKIT_URL` | a URL `wss://...livekit.cloud` |
| `LIVEKIT_API_KEY` | a API Key |
| `LIVEKIT_API_SECRET` | o API Secret |

O arquivo `.env` local não é enviado ao Vercel. Cadastre as variáveis de servidor diretamente no painel, sem colocar segredos no Git.

### 3. Supabase (login)

O banco já está pronto. Faltam os URLs de produção e Preview depois que o domínio Vercel for criado. Entre em **https://supabase.com/dashboard**, abra o projeto **resenha** e configure:

1. **Authentication → URL Configuration**
   - **Site URL:** o domínio de produção atribuído ao projeto Vercel.
   - **Redirect URLs:** adicione o domínio de produção, os domínios de Preview que serão usados para homologar (com curinga do Vercel, se necessário) e `http://localhost:3000`.
2. **Authentication → Sign In / Providers → Email**
   - Recomendado: **desligue "Confirm email"**. O envio de e-mail grátis do Supabase manda poucas mensagens por hora. Se vários amigos se cadastrarem ao mesmo tempo, os e-mails de confirmação travam. A recuperação de senha continua funcionando.
3. **Login com Google (opcional)**
   - No [Google Cloud Console](https://console.cloud.google.com/apis/credentials), crie um **ID do cliente OAuth** do tipo "Aplicativo da Web".
   - Em "URIs de redirecionamento autorizados", coloque: `https://hxptmylcpbrqzlmixwga.supabase.co/auth/v1/callback`
   - Copie o Client ID e o Client Secret para **Supabase → Authentication → Sign In / Providers → Google** e ative.

> O Supabase pode pausar projetos gratuitos com pouca atividade em uma semana. Se isso acontecer, é possível retomar o projeto pelo painel; uso regular reduz a chance de pausa, mas não a elimina.

O workflow `.github/workflows/database-activity.yml` prepara consultas leves três vezes ao dia. Para funcionar após publicação na branch padrão, configure as variáveis do repositório `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` em **Settings → Secrets and variables → Actions → Variables**. Use somente a chave publicável, nunca a service role. A consulta ajuda a manter atividade, mas não garante que o projeto gratuito não será pausado; no GitHub, workflows agendados de repositórios públicos também podem ser desativados após 60 dias sem atividade no repositório. Consulte [pausa de projetos Supabase](https://supabase.com/docs/guides/platform/free-project-pausing) e [workflows agendados do GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

---

## Publicar mudanças

Com o repositório conectado, o Vercel gera uma Preview para branches e publica a branch de produção conforme a configuração do projeto. O Express exporta o app para execução na Function e só abre `app.listen()` quando executado diretamente no PC.

## Atualizar o GitHub (vindo da versão 1)

A estrutura mudou, então:

1. No GitHub, **apague** os arquivos antigos `public/app.js` e `package-lock.json`.
2. Suba todos os arquivos deste zip: `server.js`, `package.json`, `package-lock.json`, `README.md`, a pasta `src` e a pasta `public`, substituindo os antigos.
3. Faça commit e push quando a mudança estiver pronta; o Vercel cria a Preview ou publicação conforme a branch.

## Rodar no PC (opcional)

Requer Node.js 22 ou superior. O servidor carrega o arquivo `.env` automaticamente; variáveis definidas no ambiente do servidor têm prioridade sobre as do arquivo.

```bash
npm install
set LIVEKIT_URL=wss://...        (no Windows; no Linux/Mac use export)
set LIVEKIT_API_KEY=...
set LIVEKIT_API_SECRET=...
npm start
```

Abra `http://localhost:3000`.

## Loja em teste

O primeiro item é o Telão da sala. Ele funciona apenas com chave Stripe de teste; chaves de produção não ativam a loja. Preencha no `.env`:

- `STRIPE_SECRET_KEY`: chave secreta Stripe de teste, iniciada por `sk_test_`.
- `STRIPE_WEBHOOK_SECRET`: segredo `whsec_` do endpoint de teste que envia eventos para `/api/stripe-webhook`.
- `SUPABASE_SERVICE_ROLE_KEY`: chave secreta do servidor do projeto Supabase, nunca a chave publicável.
- `RESENHA_APP_URL`: endereço de retorno do app; para testes locais, `http://localhost:3000`.

Para receber webhooks na máquina local, use a Stripe CLI autenticada e execute `stripe listen --forward-to localhost:3000/api/stripe-webhook`. Preencha `STRIPE_WEBHOOK_SECRET` com o segredo mostrado pela CLI e reinicie o servidor. Configure o Pix na conta Stripe de teste quando estiver disponível. O pagamento só é confirmado após o webhook informar que ele foi pago; a volta ao app não libera a compra por si só. A loja continua visível sem configuração, mas o botão informa que o pagamento ainda não está configurado.

Execute `npm test` para os testes automatizados que não precisam de acesso ao banco real.

## Estrutura

```
server.js           Express: /config, token do LiveKit, moderação
src/main.js         login, salas, cargos, chat, menus
src/call.js         call com LiveKit (voz, câmera, tela, volumes, dispositivos)
src/ui.js           componentes de interface
public/             HTML, CSS, ícones e app instalável (PWA)
public/dist/        gerado no build (não suba para o GitHub)
```

## Banco de dados (Supabase)

As migrações em `supabase/migrations/` dependem do esquema anterior, que já existia no projeto Supabase. Elas foram aplicadas manualmente e o banco ainda não possui histórico `supabase_migrations.schema_migrations`. Antes de usar `supabase db push` ou recriar o banco, é necessário obter uma linha de base completa e reconciliar o histórico; não basta executar essas migrações em um banco vazio.

O arquivo `supabase/schema_snapshot_public.sql` é um retrato da estrutura pública, sem dados, gerado em 22/11/2026. Ele não inclui as configurações do Auth e do Storage nem substitui backup completo ou reconciliação das migrações. Não execute esse retrato diretamente no banco existente.

Tabelas: `profiles`, `rooms`, `room_members`, `room_roles`, `room_bans` e `messages`, todas com RLS. As ações sensíveis passam por funções que conferem a permissão: `create_room`, `join_room`, `kick_member`, `ban_member`, `create_role`, `assign_role`, `set_moderator`, `transfer_ownership` e outras.

Regras de hierarquia:
- Ninguém age sobre o dono.
- Moderadores só podem ser expulsos ou banidos pelo dono.
- Um membro com cargo só age sobre membros comuns.
- Ninguém cria um cargo com uma permissão que não tem.
