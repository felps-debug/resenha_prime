# Checklist do Codex: deixar o Resenha igual às telas finais

**Regra:** só pare quando TODOS os itens estiverem marcados. Marque `[x]` só depois de ver funcionando no app rodando, não por ter escrito o código. Item que não der para fazer: escreva o motivo embaixo dele e não marque.

**Referência:** `docs/telas/` (leia o `README.md` de lá primeiro). Cada parte abaixo cita a tela. Abra o print (`docs/telas/prints/<Tela>.png`) **e** a tela funcionando (`python -m http.server 5178` dentro de `docs/telas`).

**Como provar que uma parte terminou:** tire um print do app na mesma largura (1440 px; celular 390 px) e compare lado a lado com o print da tela. Diferente = não terminou.

**Ponto de partida:** a pasta local já tem, sem commit, o espelhar câmera (`src/call.js`, `src/main.js`, `public/style.css`) e o golpe da privada (`src/zoeira.js`, `public/sfx/`). Mantenha os dois funcionando.

Ordem sugerida: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9.

---

## 1. Esqueleto padrão do app — `Main.dc.html` (também em `Transmissao.dc.html` e `DMs.dc.html`)

- [ ] **Trilho de salas** igual ao print: DMs (com contador), divisória, salas (a ativa quadrada laranja com a barrinha à esquerda; não lida com bolinha; menções com número vermelho), **+ adicionar sala** (tracejado, verde), **explorar** (bússola verde), espaço e **loja** (sacola) embaixo.
- [ ] **+ adicionar sala** abre criar sala / entrar com convite (`Explorar.dc.html`). **Explorar** abre as salas públicas.
- [ ] **Lista de canais** com os grupos **TEXTO** e **VOZ**, cada um com **+** que abre "Criar canal" (`CriarCanal.dc.html`). O + só aparece para quem pode gerenciar canais.
- [ ] Canal de voz com gente vira um **card vivo** (quem está, quem fala, quem transmite, quem está mutado) com o botão "Entrar na call".
- [ ] **Rodapé com você**: foto, nome e status (Online / Mutado / Sem áudio).
  - [ ] **Microfone:** um clique muta. Mutado = ícone cortado em vermelho com fundo avermelhado. Funciona dentro e fora da call.
  - [ ] **Fone:** desativa o áudio (e também muta). Clicar de novo volta.
  - [ ] **Engrenagem:** abre as Configurações (`Config.dc.html`).
- [ ] **Painel de membros**: o botão no topo abre e fecha o painel **deslizando** (0 → 248 px em ~0,34 s), com as pessoas entrando em cascata. Nada aparece de uma vez.
- [ ] Grupos de membros por cargo (Dona, Moderador, cargos, Online, Offline), com status e o que a pessoa está fazendo ("Na call", "Transmitindo a tela", "Digitando…").
- [ ] **Micro-animações** no hover: megafone balança, # pula, sacola se desenha (e se desenha uma vez ao abrir o app), ondas no ícone de voz, bússola gira, + gira, engrenagem gira, microfone e fone dão um pulinho. Tudo desligado com `prefers-reduced-motion`.
- [ ] O mesmo esqueleto aparece em todas as telas com o app aberto (chat, call, DMs). Nenhuma tela fica sem trilho, sem + ou sem rodapé.

## 2. Call — `Transmissao.dc.html`, `CallFixar.dc.html`, `Compartilhar.dc.html`

- [ ] Layout da call igual a `Transmissao.dc.html`: palco, faixa de quadros, barra de controles e chat da call à direita.
- [ ] **Todo quadro tem "Fixar"** no hover: tela compartilhada, câmera ou avatar, seu ou de outra pessoa. Fixado mostra "Fixado" em laranja; clicar desafixa.
- [ ] Até **4** fixados. O quinto solta o mais antigo.
- [ ] Seletor de layout (`CallFixar.dc.html`):
  - [ ] **Destaque:** o primeiro fixado grande e o resto na faixa.
  - [ ] **Lado a lado:** os fixados dividem o palco (2 meio a meio; 3 ou 4 em grade 2x2).
  - [ ] **Câmera flutuante:** o primeiro ocupa o palco e o segundo flutua num canto. Dá para mudar de canto, aumentar/diminuir e "Trocar".
- [ ] Caso obrigatório: transmitindo a tela **e** com a câmera ligada, você deixa a tela gigante e a sua câmera pequena num canto.
- [ ] Troca de layout animada, sem piscar e sem recarregar os vídeos. O layout continua quando alguém entra ou sai.
- [ ] Transmitir tela abre o nosso pop-up (`Compartilhar.dc.html`) antes do seletor do navegador.

## 3. Configurações — `Config.dc.html`

- [ ] Abre pela engrenagem do rodapé.
- [ ] Menu com **SUAS CONFIGURAÇÕES** (Minha conta, Perfil, Áudio e vídeo, Notificações, Zoeira) e **DO APP** (Aparência, Atalhos, Sobre o Resenha). **Sem Idioma.** "Sair da conta" no fim.
- [ ] **Minha conta:** e-mail mascarado e "Alterar e-mail" (manda link de confirmação), "Trocar senha" (atual + nova), Google conectado/desconectar e "Excluir conta" com confirmação. Tudo pelo Supabase Auth.
- [ ] **Perfil:** trocar foto (até 4 MB), nome, recado e cor do fundo do cartão, com a prévia do cartão mudando ao digitar. "Salvar perfil" grava e o cartão que os outros veem muda.
- [ ] **Áudio e vídeo:** microfone, saída de som, câmera e "Espelhar minha câmera" (já existe no app; mova para cá).
- [ ] **Aparência:** modo Escuro / Claro / Seguir o sistema e cor de destaque (Laranja, Azul, Verde, Roxo, Rosa, Amarelo, Vermelho e "Outra cor"). Muda o app inteiro na hora, a prévia acompanha e a escolha fica salva no perfil (vale em outro aparelho).
- [ ] O app inteiro usa variáveis de cor. Nenhum laranja fixo sobra.

## 4. Canais — `CriarCanal.dc.html`

- [ ] Modal "Criar canal" com Texto ou Voz (já marcado conforme o + clicado), nome (texto vira minúsculo com hífen e mostra "Vai ficar #nome") e "Canal privado" (só cargos escolhidos).
- [ ] Cria quantos quiser. Cada canal de voz é uma call separada.
- [ ] O canal novo entra na lista com destaque animado e aparece o aviso "Canal … criado". Todos da sala veem na hora.

## 5. Loja, Vaquinha e Salas públicas (refazer igual às telas)

- [ ] **Loja** (`Loja.dc.html`, `LojaCompra.dc.html`, `MobileLoja.dc.html`): topo "Zoar os amigos custa trocado" com o anel de custos do mês, abas filtrando, cards com arte e preço em mono, painel do item com "Quem vai ser zoado?" e "Zoar <nome> por R$ X", "Acontecendo agora" com compras reais, card de compra e agradecimento. Itens e preços vêm do banco. O pagamento ainda não está configurado: o botão deve mostrar isso, sem cobrar.
- [ ] **Vaquinha** (`Vaquinha.dc.html`): mascote, barra da meta e explosão iguais ao protótipo, com contribuições reais. Bateu a meta, todos da sala veem a explosão.
- [ ] **Salas públicas** (`Explorar.dc.html`): busca, categorias e cards iguais ao print. Entrar funciona. Criar sala funciona.

## 6. Música, assistir junto e DJ — `Atividades.dc.html`, `DJ.dc.html`

- [ ] **Barra de baixo da call em pílula:** microfone, câmera, separador e as abas **Call**, **Música** e **Assistir junto**, com "Sair" ao lado. A aba ativa ganha fundo claro, o nome aparece crescendo (~0,38 s, com leve mola) e o ícone dá um pulinho. As outras mostram só o ícone.
- [ ] Call = só os quadros. Música e Assistir junto abrem o painel lateral (entra deslizando).
- [ ] **Card do CD:** a capa na frente e o disco atrás, **escondido**. **Só no hover** o disco sai da capa para o lado (e a capa inclina). Tocando, o disco gira; pausado, para. Ele não fica para fora sozinho.
- [ ] **Música:** tocando agora, barra de tempo, pausar/tocar para todos, pular por votos (3 votos), volume só para você, fila com quem pediu e tirar da fila o que você pediu. Pedir pelo nome, sem link.
- [ ] **Assistir junto:** vídeo no palco sincronizado para todos ("Sincronizado · <nome> controla"), pausar/avançar para todos, "Passar controle", fila e reações rápidas (KKKKK, GOOOL, NÃÃÃO) subindo na tela. Pessoa fixada flutua sobre o vídeo.
- [ ] **DJ Resenha** (funciona como o Jockie Music, mas é nosso):
  - [ ] Comandos no chat: `m!play nome` (`m!p`), `m!skip` (`m!s`), `m!pause`, `m!resume` (`m!r`), `m!queue` (`m!q`), `m!np`, `m!loop`, `m!volume 0-100` (`m!vol`), `m!leave` (`m!stop`), `m!help` (`m!h`). Comando desconhecido: "Comando m!x não existe · Manda m!help".
  - [ ] `m!play nome` busca pelo nome (YouTube Data API, primeiro resultado) e toca ou põe na fila. Se o DJ não estiver na call, ele entra.
  - [ ] Na call, o DJ é **um quadro igual ao de uma pessoa mutada**: só a foto dele (nota musical), microfone cortado e selo BOT. Também pode ser fixado.
  - [ ] O "tocando agora" fica **no topo do chat da call**, com o card do CD (mesmo efeito acima), música, artista, quem pediu, equalizador, estado e pausar/tocar. A capa do CD é onde fica o player do YouTube, visível.
  - [ ] Respostas em cartões no chat: TOCANDO AGORA, NA FILA · #n, PULEI, PAUSADO, FILA, LOOP, VOLUME, TCHAU, COMANDOS.
  - [ ] Digitar `m!` abre a lista de comandos (autocompletar). Atalhos rápidos acima do campo.
  - [ ] Fila e estado no servidor: a música continua se quem pediu sair. Quem entra no meio começa no ponto certo. O DJ sai quando todos saem ou após alguns minutos de fila vazia.
  - [ ] Áudio pelo **player oficial do YouTube (IFrame API) em cada navegador**, sincronizado pelo servidor. Não baixar nem retransmitir o áudio (nada de yt-dlp/ffmpeg puxando do YouTube).
  - [ ] O painel Música é o controle visual do mesmo DJ: mesma fila e mesmo estado.

## 7. Mensagens diretas, sala e conta

- [ ] **DMs** (`DMs.dc.html`) iguais ao print, com o esqueleto padrão (trilho e rodapé).
- [ ] **Configurações da sala** (`SalaConfig.dc.html`) iguais ao print, com cargos e moderação funcionando.
- [ ] **Entrar, Criar conta, Redefinir senha e Onboarding** (`Login`, `Cadastro`, `Senha`, `Onboarding`) iguais aos prints, pelo Supabase Auth. O botão "Simular clique no link do e-mail" é só do protótipo: não entra no app.

## 8. Celular — `Mobile*.dc.html`

- [ ] Chat, menu e canais, call, mensagens e loja iguais aos prints em 390 px.
- [ ] Sem rolagem lateral e com áreas de toque de pelo menos 44 px.

## 9. Golpe "Mandar pra privada"

- [ ] Seguir `docs/CHECKLIST-ZOEIRA-PRIVADA.md` (a implementação de referência está em `src/zoeira.js`).

---

## Antes de dizer que terminou

- [ ] `npm run build` e `npm test` passando.
- [ ] Teste com **dois navegadores** logados em contas diferentes na mesma sala: mutar, fixar tela e câmera, layouts, criar canal, tema, música, assistir junto, `m!play` / `m!skip` / `m!queue`, zoeira.
- [ ] Prints do app ao lado dos prints de `docs/telas/prints/` para cada tela.
- [ ] Console sem erro.
- [ ] Lista do que mudou, arquivo por arquivo, e do que não deu para fazer, com o motivo.
- [ ] Sem deploy e sem push sem o Welison pedir.
