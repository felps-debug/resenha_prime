# Checklist: golpe "Mandar pra privada" na call

**Regra:** só pare quando TODOS os itens estiverem marcados. Marque `[x]` só depois de conferir de verdade, não por ter escrito o código. Se um item não puder ser feito, escreva o motivo embaixo dele e não marque.

**Referência visual obrigatória:**
- Artefato de demonstração: https://claude.ai/artifact/T6ghgaxS9n9hFUvKHHacaW
- Vídeo da sequência: `segundo-cerebro/projetos/resenha-privada-coco.mp4`
- Se a pasta local `C:\Users\Felps\code\resenha_prime` tiver `src/zoeira.js`, ele é a implementação de referência: o artefato roda exatamente esse arquivo. Copie o comportamento dele; não reinvente.

O resultado tem que ficar **igual ao artefato**. Se ficar diferente, o item não está pronto.

---

## 1. O que a pessoa vê (layout)

- [ ] A animação aparece **por cima do quadro (tile) da pessoa-alvo** no palco da call, centralizada no centro do quadro.
- [ ] A animação fica numa camada própria `position: fixed`, com `pointer-events: none`, `z-index` acima do palco e `overflow: hidden` na tela inteira. Ela **não** é inserida dentro do tile, porque o tile tem `overflow: hidden` e é redesenhado a cada mudança da call.
- [ ] O grid da call **não mexe** durante a animação: nenhum tile muda de tamanho nem de posição, nenhuma barra de rolagem aparece.
- [ ] A cena é desenhada num quadro de 1080×1080 e reduzida com `transform: scale(s)`, com `transform-origin: 0 0`.
- [ ] O tamanho do avatar animado é `max(72, min(altura do tile × 0,85, largura do tile × 0,6, 340))` px, e `s = tamanho / 400`.
- [ ] O ponto (540, 430) da cena cai no centro do tile.
- [ ] A posição é recalculada a cada frame (`requestAnimationFrame`), procurando o tile por `#stage .tile[data-identity="<id>"]`. Se o palco redesenhar no meio da animação, ela continua em cima do tile certo.
- [ ] Se o tile sumir (a pessoa saiu da tela da call), a camada fica invisível, sem erro no console.
- [ ] Durante a animação, o avatar ou vídeo original do tile fica escondido (`visibility: hidden` via classe `zoeira-target` no tile), para não aparecer duplicado. A classe sai quando a animação termina.
- [ ] O avatar animado é um círculo com borda preta grossa (12 px na escala da cena) e mostra:
  - [ ] a câmera da pessoa (um quadro capturado do `<video>` do tile num `<canvas>` 400×400, cortado no centro), se a câmera estiver ligada;
  - [ ] senão, a foto de perfil (`call.avatarUrl(id)`);
  - [ ] senão, a inicial com a cor padrão do app.
- [ ] Os textos SPLAT!, AAAAHH! e FLUUUSH! usam fonte grossa (Geist 900) com contorno preto grosso, como no artefato.
- [ ] Funciona no modo grade (sem tela compartilhada) e na faixa de quadros pequenos quando alguém compartilha a tela (`.focus-strip`).
- [ ] No celular (largura ~390 px), a animação aparece inteira em cima do quadro, sem criar rolagem lateral na página.
- [ ] Com `prefers-reduced-motion: reduce`, não há flash branco nem tremida de câmera. O resto da animação continua.

## 2. Sequência da animação (7 s, GSAP)

Tempos em segundos a partir do disparo. Confira cada um no artefato.

- [ ] **0,00:** privada e cocô **invisíveis**. Nada aparece fora do lugar antes da hora.
- [ ] **0,42:** o cocô (com olhos, sorriso e fedor verde) aparece e voa em arco de baixo à esquerda até o rosto, girando.
- [ ] **1,12 (impacto):** o cocô amassa no rosto, flash branco, raios amarelos, 8 bolinhas marrons espirrando, câmera treme, "SPLAT!" aparece com pulo.
- [ ] **1,12:** manchas marrons ficam no rosto até o fim.
- [ ] **1,18:** o cocô quica e fica **em cima da cabeça** (e continua lá até o fim, inclusive depois da descarga).
- [ ] **1,20 a 2,45:** balão "AAAAHH!" com letras pulando, e o avatar tremendo.
- [ ] **2,05:** "SPLAT!" some.
- [ ] **2,15:** a privada sobe de baixo, com mola, e o avatar fica **entre** a parte de trás (caixa, tampa aberta, água) e a parte da frente (borda e corpo do vaso).
- [ ] **2,62:** a tampa abre e a água começa a girar.
- [ ] **2,82 a 3,72:** o avatar sobe um pouco, depois é sugado girando e esticado até sumir na água. A borda da frente do vaso cobre o avatar quando ele passa da linha da água.
- [ ] **2,95 a 4,03:** "FLUUUSH!" no topo, balançando.
- [ ] **3,62:** a tampa fecha e a privada chacoalha.
- [ ] **3,85 e 4,05:** dois "glub" sobem.
- [ ] **4,50:** a tampa abre e o avatar volta pulando, **molhado** (película azul e pingos na cabeça), com 6 gotas de água espirrando.
- [ ] **4,85 até o fim:** duas moscas voando em volta da cabeça, 3 pingos caindo em loop e o avatar balançando, tonto.
- [ ] **5,15:** a privada desce e some.
- [ ] **6,70 a 7,00:** tudo some e a camada é removida do DOM.

## 3. Som

- [ ] Arquivos em `public/sfx/`: `whoosh`, `splat`, `scream`, `boing`, `clack`, `flush`, `glub`, `pop`, `buzz` (`.mp3`). Se não existirem no seu repo, peça ao Welison; não gere sons diferentes.
- [ ] Momentos: whoosh 0,45 · splat 1,10 · scream 1,18 · boing 2,15 · clack 2,62, 3,64 e 4,44 · flush 2,80 · glub 3,85 e 4,05 · pop 4,50 · buzz 4,85.
- [ ] Os sons são pré-carregados quando a pessoa entra na call.
- [ ] Quem está com o fone desligado (`call.deafened`) vê a animação **sem som**.
- [ ] Os sons respeitam a saída de áudio normal do navegador e não travam se o navegador bloquear o autoplay (`play().catch(() => {})`).

## 4. Como o golpe chega a todo mundo (LiveKit)

- [ ] O aviso vai pelo canal de dados do LiveKit: `room.localParticipant.publishData(bytes, { reliable: true, topic: 'zoeira' })`.
- [ ] O conteúdo é exatamente `{"v":1,"kind":"privada","target":"<identity>"}` em JSON UTF-8. Nada de nome, URL ou HTML na mensagem.
- [ ] Quem recebe escuta `RoomEvent.DataReceived` e só aceita a mensagem se:
  - [ ] o `topic` for `zoeira`;
  - [ ] o JSON for válido, com `v === 1` e `kind === 'privada'`;
  - [ ] o `target` for alguém que está na call (eu ou um participante remoto);
  - [ ] quem mandou não for o próprio alvo;
  - [ ] quem mandou não tiver mandado outro golpe há menos de 7 s.
- [ ] O nome de quem mandou vem do `participant.name` do LiveKit, nunca da mensagem.
- [ ] Quem dispara vê a animação na hora, sem esperar a volta da mensagem.
- [ ] O token do LiveKit já tem `canPublishData: true` em `server.js`. Confira; não crie rota nova no backend.

## 5. Como disparar

- [ ] No menu do membro (o que tem o controle de volume), aparece "Mandar pra privada" **só** quando a pessoa está na call e não é você.
- [ ] Clicar no quadro de outra pessoa no palco abre esse mesmo menu. O seu próprio quadro não abre nada.
- [ ] Clicar na pessoa na lista da call (barra lateral) também abre o menu.
- [ ] Cada pessoa só pode mandar um golpe a cada 8 s. Antes disso, aparece o toast "Calma, espera Ns pra zoar de novo."
- [ ] Se o alvo ainda estiver no meio de uma animação, aparece "<nome> ainda está na privada." e nada é enviado.
- [ ] Se o envio falhar, aparece "Não consegui mandar a zoeira. Tenta de novo." e a espera de 8 s é liberada.
- [ ] Toasts que todos veem: "Você mandou <nome> pra privada" (quem mandou), "<nome> te mandou pra privada" (o alvo) e "<nome> mandou <nome> pra privada" (o resto).
- [ ] Ao sair da call, qualquer animação em andamento é interrompida e removida.

## 6. Código e peso do app

- [ ] A lógica da animação fica num arquivo só, `src/zoeira.js`. O `src/call.js` cuida do envio e recebimento; o `src/main.js` só liga o menu.
- [ ] O GSAP é dependência com versão fixa (`gsap@3.15.0`) e é carregado com `import('gsap')` só na hora do primeiro golpe ou ao entrar na call. **Ele não pode entrar no `app.js` principal.**
- [ ] Os desenhos (cocô, privada, moscas, manchas) são SVG fixo no código. Nenhum dado de usuário entra via `innerHTML`; nomes entram por `textContent`.
- [ ] Os estilos ficam em `public/style.css`, num bloco "Zoeira na call", com classes prefixadas `z-` e `zoeira-`.
- [ ] O CSP do `vercel.json` continua funcionando: sons de `'self'`, nenhum script ou fonte de fora.
- [ ] Nenhum `console.error` ou exceção durante a animação.

## 7. Testes automáticos

- [ ] `npm run build` passa.
- [ ] `npm test` passa, com zero falhas.
- [ ] Existe um teste em `test/bundle.test.js` provando que `node_modules/gsap` não entra no arquivo principal (mesmo padrão do teste do `livekit-client`).
- [ ] Existe um teste para a validação da mensagem recebida: JSON inválido, `v` errado, `kind` desconhecido, alvo fora da call, alvo igual a quem mandou e cooldown são todos ignorados.

## 8. Teste manual (obrigatório antes de dizer que terminou)

Faça com **dois navegadores** (ou uma aba normal e uma anônima) logados com contas diferentes, na mesma sala e na mesma call.

- [ ] A manda B pra privada: A e B veem a animação **ao mesmo tempo**, em cima do quadro de B, com som.
- [ ] B vê o toast "<A> te mandou pra privada".
- [ ] A animação bate com o artefato em cada momento da seção 2.
- [ ] Com B de câmera ligada, a imagem que vai pra privada é a câmera de B.
- [ ] Com B de fone desligado, B vê sem som.
- [ ] A tenta mandar de novo em menos de 8 s e recebe o aviso de espera.
- [ ] Alguém liga o compartilhamento de tela no meio: a animação continua em cima do quadro de B na faixa de baixo.
- [ ] Em tela de celular (DevTools, 390×844), a animação aparece inteira e a página não ganha rolagem lateral.
- [ ] Depois dos 7 s, o quadro de B volta ao normal, sem resto de cocô, mosca ou classe `zoeira-target`.
- [ ] Console limpo nos dois navegadores.

## 9. Entrega

- [ ] Liste o que mudou, arquivo por arquivo.
- [ ] Liste qualquer item que não deu para marcar, com o motivo.
- [ ] Não faça deploy nem push sem o Welison pedir.
