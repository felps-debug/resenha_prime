# Resenha v3: resumo do projeto e pendências

Atualizado em 22/11/2026. Documento de passagem: dá pra retomar o trabalho daqui sem depender da conversa anterior.

## Continuação — 22/11/2026

- Decisão mais recente: continuar o desenvolvimento normalmente, mas deixar a integração de pagamento sem configurar por enquanto. A tela e o botão da loja permanecem acessíveis; sem credenciais, o servidor informa que o pagamento não está configurado.
- Welison escolheu Vercel para hospedar o app; Render saiu do plano. Criados `vercel.json` e exportação condicional do Express. Ainda falta conectar o repositório e cadastrar as variáveis de ambiente no projeto Vercel.
- Revisão do protótipo Claude: o menu mobile agora abre o trilho de salas e os canais como um único drawer com backdrop, fechamento por toque/Escape e controle acessível. A call mobile ganhou avançar/voltar entre transmissões, controle de áudio e alternância entre call e chat.
- Validação local renovada nesta sessão: `npm test` passou com 33/33 testes e `npm run build` concluiu. Publicado em produção na Vercel: https://resenha-nu.vercel.app. Página inicial, `/health` e `/config` responderam; `/config` confirma LiveKit e loja desligados por falta de variáveis, conforme combinado para pagamentos. As calls aguardam as chaves LiveKit.
- Projeto Vercel criado na conta `felps-debugs-projects`; publicação foi feita via CLI, sem conectar o repositório Git nem enviar push. Revisar URLs de redirecionamento do Supabase para o domínio da produção antes de validar cadastro e recuperação de senha.
- Stripe permanece pausada, sem configuração de credenciais ou processamento.
- Pagamentos permanecem pausados, conforme pedido: a tela e o botão continuam, sem preencher credenciais nem validar checkout real.

- Busca de mensagens e fixação/desafixação implementadas em salas e DMs. A migração `20261122000100_mensagens_fixadas.sql` foi aplicada e teve as políticas verificadas com transações revertidas.
- Os arquivos de migração foram renomeados com versões únicas e em ordem de dependência. O banco existente não possui tabela `supabase_migrations.schema_migrations`: as mudanças foram aplicadas manualmente. Antes de usar `supabase db push`, levantar uma linha de base completa e reconciliar o histórico; as migrações existentes não recriam sozinhas o esquema anterior.
- Foi salvo `supabase/schema_snapshot_public.sql`, retrato somente da estrutura pública em 22/11/2026, sem dados de tabelas. Ele não inclui configuração de Auth, políticas e buckets do Storage, nem substitui o histórico de migrações ou um backup completo; não aplicá-lo diretamente no banco existente.
- Workflow local `.github/workflows/database-activity.yml` preparado para consultas leves três vezes ao dia; só funcionará após publicação na branch padrão e configuração das variáveis públicas do Supabase no GitHub. Isso não garante que o projeto gratuito permanecerá ativo e o GitHub pode desativar agendamentos em repositórios públicos inativos por 60 dias.
- Ajustadas as corridas de navegação e os rascunhos por conversa; anexos pendentes ficam em memória separados por sala, com limite de três. Uma falha de envio preserva o texto na conversa de origem.
- O contador de DMs agora mostra mensagens recebidas durante uma call. A abertura simultânea da mesma DM por duas pessoas foi validada; a biblioteca LiveKit é carregada sob demanda e o JavaScript inicial caiu de aproximadamente 890 KB para 332 KB.
- Servidor recebeu CSP, proteção contra enquadramento e HSTS em HTTPS. Instalação limpa, build, testes unitários e testes no navegador passaram; o teste móvel usa emulação, não celular físico.
- Testadas regras de privacidade de salas, DMs, reações, call e Storage, além da hierarquia de moderação. A estrutura da loja segue em modo de teste; ainda falta confirmar o pagamento ponta a ponta com Stripe e webhook configurados, e os demais itens da loja não estão prontos.

## Continuação — 21/11/2026

- O repositório segue com alterações locais, sem commit ou push. O projeto agora requer Node 22 ou superior; o servidor lê `.env` automaticamente.
- Banco real: corrigida a política de reações que aceitava sala diferente da mensagem; reduzidos privilégios excessivos de `anon` e `authenticated`; DM fechada volta quando recebe mensagem, sem readicionar quem saiu de grupo. Migrações correspondentes estão em `supabase/migrations/` e foram aplicadas.
- Validados com contas temporárias e sala de teste: DMs, reações, respostas, reabertura, grupo de três, saída de grupo e call com microfone, câmera, tela e volume simulados. Também foram testados login, troca de tema e mensagens em viewport móvel; celular físico ainda falta. As contas temporárias criadas para esses testes foram removidas.
- Interface: corridas ao trocar de conversa corrigidas; clicar na DM atual retorna ao chat durante uma ligação. Histórico e prévia de salas usam IndexedDB, isolados por conta, com mensagens limitadas a 50 por conversa, 10 conversas e validade de 12 horas. As salas em cache ficam desabilitadas até confirmar acesso.
- Loja: primeiro item, Telão, implementado **somente em modo de teste**. A estrutura do banco foi aplicada; assinatura, preço, Pix pendente, idempotência e permissões foram testados, assim como interface com checkout simulado. Falta testar pagamento real em ambiente de teste da Stripe após preencher as credenciais e configurar o webhook. Os demais itens da loja ainda não foram implementados.
- Para executar os testes locais: `npm test`. Os testes transacionais do banco em `test/*.py` usam `DATABASE_URL` e `psycopg`; `scripts/browser-dm.cjs` usa Playwright, Chrome e a conta/sala de teste do `.env`.

---

## 1. O que é o projeto

Resenha é um app de salas estilo Discord feito pelo Yves para o grupo de amigos: login, salas com convite, cargos, chat salvo, call com voz/câmera/tela, sorteador e insígnias.

| Peça | Onde |
|---|---|
| Código | `C:\Users\Felps\code\resenha_prime` (GitHub `yvespontes08-source/resenha_prime`) |
| Site | Vercel, destino escolhido em 22/11/2026; conectar o GitHub e ajustar variáveis/redirects ainda pendente |
| Banco e login | Supabase **Resenha.SouthAmerica** (`hxptmylcpbrqzlmixwga`), com dados reais (10 usuários, ~8 salas) |
| Call | LiveKit Cloud, projeto `yves-dc-vmotik89`, plano grátis (5.000 minutos-pessoa/mês, 100 pessoas simultâneas) |
| Design aprovado | Canvas no Claude Design: https://claude.ai/artifact/VnCENpvrVdPUXRoraw2a4g |
| Credenciais | `.env` na raiz do repo (fora do git). Nunca colar valores em chat |

Stack: Node/Express (`server.js`), front em JavaScript puro compilado com esbuild (`src/` → `public/dist/app.js`), Supabase (Postgres + Auth + Realtime + Storage), LiveKit.

### Por que o app tinha parado

O código apontava para um projeto Supabase antigo (`bwcfciel…`) que deixou de existir. O banco certo é o Resenha.SouthAmerica, que já tinha tabelas, funções e dados. A estrutura do banco não estava no repositório; agora cada mudança fica em `supabase/migrations/`.

---

## 2. O que já foi feito (nada commitado ainda)

### Fase 1: visual novo
- `public/style.css` reescrito com as cores do canvas (grafite + laranja `#FF6B3D`), fonte Geist, cantos arredondados. Os nomes de classe são os mesmos de antes, então a lógica não mudou.
- Tema claro e escuro com troca em transição circular (botão sol/lua no topo). Fica salvo por pessoa.
- Logo "Roda" (escolhida pelo Yves) no favicon, ícones do app instalável e manifest.
- Login em duas colunas, cabeçalho da sala com "X online · Y membros" e botão de convite, card "Call da sala" com feixe de luz quando tem gente, blur no topo do chat e no fim da lista de membros, ripple nos botões, animação de entrada das mensagens.
- Testado no navegador (PC, celular, tema claro).

### Fase 2: chat
- Barra de ações ao passar o mouse: reagir, responder, apagar.
- Reações em tempo real (tabela `message_reactions`).
- Responder mensagem (coluna `messages.reply_to`), com citação clicável.
- "Fulano está digitando…" via broadcast do Realtime (sem banco).
- Link de post do X vira card (endpoint `/api/link-preview` no `server.js`, usa o oEmbed público do X).
- Migração: `supabase/migrations/20261121000100_fase2_reacoes_respostas.sql` (já aplicada).
- Testado no navegador.

### Fase 3: mensagens diretas
- DM é uma sala com `rooms.kind = 'dm'` (2 pessoas) ou `'group'` (até 10). Assim chat, reações, respostas, digitando e **ligação** funcionam igual às salas.
- Botão de balão no topo do trilho com contador, lista de conversas com busca e prévia, "Nova conversa" (1:1 ou grupo), "Mandar mensagem" no menu de qualquer pessoa.
- Regras no banco: só dá pra chamar no privado quem divide alguma sala com você; o convite de uma DM não funciona; reabrir a DM devolve a mesma conversa.
- Migração: `supabase/migrations/20261121000200_fase3_mensagens_diretas.sql` (já aplicada). Ela também alterou `join_room` e `invite_preview` para só aceitarem salas comuns.
- Regras testadas direto no banco. A conversa entre duas pessoas reais **ainda não foi testada na tela**.

### Arquivos mexidos
`public/index.html`, `public/style.css`, `public/manifest.json`, `public/icons/*`, `src/main.js`, `src/ui.js`, `server.js`, `README.md`, `.gitignore` (novo), `supabase/migrations/*` (novo), `docs/` (novo).

---

## 3. O que precisa ser feito, na ordem

### 3.1 Antes de publicar o que já existe

1. **Concluído:** DM com duas pessoas, conversas em grupo, reações, respostas, contador, chamadas e saída de grupo foram exercitados no navegador com contas de teste.
2. **Concluído:** chamadas com áudio, câmera, tela e volume individual foram exercitadas com dispositivos simulados.
3. **Pendente:** testar em celular físico (não só emulação): login, troca de sala, DMs, compositor e menus.
4. **Concluído no navegador:** tema claro, telas e fluxos principais foram conferidos.
5. **Concluído localmente:** instalação limpa, build, `npm start` e testes automatizados; a última execução de `npm test` passou com 31/31 testes.

### 3.2 Publicar no Vercel (deploy)

1. **Conectar o repositório do Yves ao Vercel** e definir a branch de produção. O `vercel.json` executa `npm run build`, configura os cabeçalhos também nos arquivos estáticos da CDN e mantém cache imutável nos chunks versionados. Não configurar `public` como Output Directory. A Function atende a API Express; `public/**` é entregue pela CDN.
2. **Cadastrar no Vercel → Project Settings → Environment Variables** para Production e Preview: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Copiar segredos à mão pelo painel; não versionar `.env`. O Supabase usa URL/chave publicável no código. Pagamentos continuam sem configuração.
3. **No Supabase → Authentication → URL Configuration:** depois de conhecer o domínio Vercel, configurar Site URL e Redirect URLs para produção, Preview e `http://localhost:3000`. Sem isso, recuperação de senha e login com Google podem falhar.
4. Testar uma Preview do Vercel antes de selecionar produção; verificar `/health`, login, mensagens, DMs e chamada. A navegação do protótipo mobile também precisa de implementação/homologação se Welison confirmar que deseja levá-la ao app.
5. Após QA no celular físico e validação da Preview, publicar a branch principal. Não subir `.env`, `.impeccable/`, `public/dist/` (estão no `.gitignore`). O site e a API ficam no Vercel; o Realtime de chat e a mídia de voz continuam diretos para Supabase e LiveKit.
6. **Login com Google** (opcional): no Google Cloud, URI de redirecionamento `https://hxptmylcpbrqzlmixwga.supabase.co/auth/v1/callback`, e ativar o provedor no Supabase.
7. **Supabase grátis pode pausar com pouca atividade em sete dias.** O workflow de consultas leves está preparado localmente; falta publicar e configurar as variáveis do repositório. Ele reduz a chance de inatividade, sem garantir disponibilidade.
8. Depois de publicar: abrir o domínio, logar, mandar mensagem, entrar na call e abrir DM. Se algo quebrar, reverter o deployment pelo Vercel ou reverter a alteração no GitHub. As migrações acrescentam coisas, então a versão anterior do site continua funcionando com o banco novo.

### 3.3 Fase 4: Loja (decidido: pagamento por item, Stripe)

**Regra que não muda com "por item":** mesmo sem saldo, o banco precisa saber o que cada pessoa comprou. O mínimo é uma tabela de compras e um webhook do Stripe que grava a compra. Sem isso, qualquer um liberaria item pelo navegador. Isso é pequeno (abaixo).

**Preço mínimo do Stripe em real é R$ 0,50.** O que estava a R$ 0,49 vira R$ 0,50. Em compras desse tamanho a taxa do Stripe consome boa parte do valor; vale conferir a tarifa da conta antes de fechar a tabela de preços.

#### Banco (migração `fase4_loja.sql`)
- `shop_items`: id (texto, ex. `z-palhaco`), nome, descrição, categoria, tipo, preço em centavos, ativo, temporada até (data). Preço **sempre lido daqui**, nunca do navegador.
- `purchases`: id, comprador, destinatário (para presente e zoeira), item, sala (para zoeira/telão/vaquinha), valor pago, id da sessão do Stripe (único), status (`pending`, `paid`, `refunded`), dados extras (apelido, texto do telão, recado), criado em, expira em (zoeiras de 1 h/24 h e telão).
- `inventory` (ou visão sobre `purchases` pagas sem expiração): o que cada um tem para sempre.
- `room_pots` e `room_pot_contributions`: vaquinha por sala e por meta (mascote, sorteio dramático).
- `user_settings.zoeira_off` (booleano): quem desliga a zoeira não pode ser alvo.
- RLS: cada um lê as próprias compras; todos da sala leem efeitos ativos da sala (para desenhar o chapéu, o telão etc.); **ninguém insere em `purchases` pelo navegador**, só o servidor com a chave service role.

#### Servidor (`server.js`)
- `POST /api/checkout`: recebe item, destinatário, sala e extras. Valida login, item ativo, temporada, se o alvo aceita zoeira, se divide sala, tamanho de apelido (16) e telão (40), e filtro de palavrão no texto. Cria `purchases` como `pending` e uma **Stripe Checkout Session** (`payment_method_types: ['card', 'pix']`, BRL, `metadata.purchase_id`). Devolve a URL do Checkout.
- `POST /api/stripe-webhook`: corpo cru (`express.raw`), **valida a assinatura** com `STRIPE_WEBHOOK_SECRET`. Em `checkout.session.completed` (e `async_payment_succeeded` para Pix), marca a compra como `paid`, calcula a expiração e dispara o efeito. Precisa ser idempotente (o Stripe reenvia).
- Variáveis novas no `.env` e no Render: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` (só no servidor, nunca no front).
- No painel do Stripe: ativar Pix na conta brasileira, criar o webhook apontando para `https://<render>/api/stripe-webhook`.

#### Front
- Aba/canal "loja" e botão no trilho, igual ao canvas (vitrine com prévias animadas, painel de compra, "Pra mim / Presentear", "Quem vai ser zoado?", campo de apelido e de telão, "Acontecendo agora", vaquinha com anel de progresso).
- Ao comprar: redireciona para o Checkout do Stripe e volta para `/?loja=ok` ou `/?loja=cancelado`. A liberação aparece pelo Realtime quando o webhook grava.
- "Custos deste mês": valor real, lido de uma tabela simples que o Yves atualiza (ou soma das compras pagas do mês contra um custo fixo cadastrado).

#### Itens e como cada efeito funciona
| Item | Preço sugerido | Como aplicar no app |
|---|---|---|
| Chapéu de palhaço (24 h) | R$ 0,99 | Avatar do alvo ganha o SVG do chapéu em toda a interface enquanto a compra não expira |
| Nome rosa-chiclete (24 h) | R$ 0,50 | Nome do alvo com cor `#FF7EC7` no chat e na lista |
| Apelido forçado (1 h) | R$ 0,99 | Nome exibido trocado pelo apelido (sem alterar o perfil) |
| Modo fantasma (1 h) | R$ 0,50 | Foto do alvo trocada pelo fantasminha |
| Espelho | R$ 0,99 | Fica guardado; a próxima zoeira contra o dono volta para quem mandou (tratado no webhook) |
| /gol, /parabéns, /F, /terremoto | R$ 0,99 cada, R$ 2,49 o pacote | Item permanente; vira comando no chat; dispara broadcast para a sala e cada tela toca a animação |
| Telão da sala (24 h) | R$ 0,50 | Letreiro no topo da sala com o texto pago |
| Entrada triunfal | R$ 1,99 | Ao entrar na call, broadcast mostra o card com holofote para todos |
| Voz zoada | R$ 1,49 | Processador de áudio local (Web Audio) no microfone antes de publicar no LiveKit |
| Soundboard | R$ 1,99 | Sons próprios (sem áudio de meme com direito autoral) tocados como faixa de áudio na call |
| Mascote da sala (vaquinha R$ 4,90) | coletivo | Bichinho no topo do chat que reage à atividade da sala |
| Sorteio dramático (vaquinha R$ 2,90) | coletivo | Resultado do Sorteador aparece como caça-níquel |
| Estilo: molduras, nome com brilho | R$ 0,99 a R$ 1,49 | Classes CSS no avatar/nome do dono |

Toda zoeira mostra "zoeira de Fulano" e some sozinha. Nada de pacote surpresa pago (é caixa de recompensa, tem cara de aposta).

#### Ordem sugerida dentro da fase 4
Primeiro o fluxo de pagamento com **um item só** (Telão, que é simples e visível), em modo teste, de ponta a ponta. Depois as zoeiras, os efeitos de tela, a call (entrada, soundboard, voz) e por último a vaquinha.

### 3.4 Itens do design que ainda não estão no código
- Nenhum item identificado desta seção: busca no chat e mensagens fixadas foram implementadas.
- Insígnias no perfil da DM e o botão "Zoar Fulano" no perfil (depende da Loja).
- Tema claro nas telas desenhadas da Loja.

---

## 4. Segurança e pentest

Fazer com duas contas comuns e uma conta "atacante" que não é membro da sala, chamando a API do Supabase direto (curl ou console do navegador com a chave publicável), não só pela interface.

**Banco (RLS e funções)**
- Atacante não consegue ler `messages`, `message_reactions`, `room_members`, `room_roles` de sala onde não está, nem de DM alheia.
- Não consegue inserir mensagem/reação em sala alheia, nem reação com `room_id` diferente do da mensagem.
- Não consegue `update` em `messages` (não há regra de update; confirmar).
- Não consegue entrar em DM por `join_room` nem com o código de convite dela.
- `open_dm` e `create_group_dm` recusam quem não divide sala.
- Funções `security definer` usam `search_path ''` (as novas seguem isso); conferir que nenhuma aceita `user_id` vindo do cliente no lugar de `auth.uid()`.
- **Privilégios largos para `anon`:** as tabelas dão `INSERT/UPDATE/DELETE/TRUNCATE` para `anon` e `authenticated`, e só o RLS segura. Recomendo revogar de `anon` e tirar `TRUNCATE`/`TRIGGER`/`REFERENCES` de todo mundo numa migração.
- Eventos `DELETE` do Realtime mandam só a chave primária e não passam pelo RLS. Em `message_reactions` isso expõe id da mensagem, id de quem reagiu e o emoji. Baixo risco, mas registrado.

**Servidor**
- `/api/livekit-token` só para membro (inclusive DM); token expira em 6 h.
- `/api/moderate` respeita hierarquia (testar membro tentando expulsar dono e moderador).
- `/api/link-preview` só aceita link de post do X (regex fixa, sem SSRF para outros hosts), exige login, tem limite de chamadas e cache.
- Limite por IP em memória: some ao reiniciar e não vale com várias instâncias. Suficiente para o tamanho atual.
- Faltam cabeçalhos: `Content-Security-Policy` (scripts só do próprio site, fontes do Google, conexões para Supabase/LiveKit/Stripe), `Strict-Transport-Security`, `frame-ancestors 'none'`.
- Na Loja: webhook com assinatura validada, preço sempre do banco, compra idempotente pelo id da sessão, teste de replay do webhook, teste de compra com valor alterado no navegador (tem que ser ignorado).

**Front**
- Conteúdo de mensagem entra por `textContent` e o `linkify` cria `<a>` com `rel="noopener noreferrer"`. Testar mensagens com `<script>`, `<img onerror>`, `javascript:` em link e menções malformadas.
- Texto do telão e apelido: testar HTML e emoji gigante; limitar tamanho no banco também.
- Upload de imagem: tipo conferido pelos primeiros bytes; confirmar que o bucket `chat` não deixa ler imagem de outra sala.

**Contas**
- Ligar confirmação de e-mail ou manter desligada sabendo o risco (contas com e-mail falso).
- Senha mínima de 6 caracteres; pensar em 8.
- Ativar o "Leaked password protection" do Supabase, se o plano permitir.

---

## 5. Testes automatizados (não existem hoje)

Mínimo que vale a pena:
1. **Banco:** script que, numa transação desfeita, simula usuários com `request.jwt.claims` e confere as regras da seção 4 (o mesmo método usado para validar as DMs).
2. **Servidor:** testes das rotas `/api/*` com `node --test` (token do LiveKit, moderação, prévia de link, checkout e webhook com payload assinado de teste do Stripe).
3. **Fluxos de tela:** Playwright com duas contas de teste em paralelo (mensagem, reação, resposta, DM, digitando).

---

## 6. Limpeza pendente

A conta de teste `teste-claude@resenha.test` e a "Sala de teste do Claude" (`TEST_ROOM_ID` no `.env`) ainda estão no banco real. Apagar no fim dos testes, com o `DATABASE_URL` do `.env`:

```sql
delete from public.rooms where id = '<TEST_ROOM_ID>';
delete from auth.users where email = 'teste-claude@resenha.test';
```

Depois, tirar as linhas `TEST_USER_*` e `TEST_ROOM_ID` do `.env`.

---

## 7. Decisões já tomadas (não reabrir)
- Banco: Resenha.SouthAmerica. Call: LiveKit Cloud (migrar para LiveKit na VPS só se estourar o limite grátis; o código não muda).
- Logo: Roda. Fonte: Geist. Destaque: laranja `#FF6B3D`. Sem borda colorida em card, sem brilho colorido.
- Loja: pagamento por item via Stripe (Pix e cartão), valores simbólicos, nada dá vantagem, zoeira com opção de desligar.
- Repositório é do Yves: commit e push só quando pedirem.
