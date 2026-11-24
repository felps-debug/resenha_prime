# Resenha: debriefing para o beta

22/11/2026. Análise do que melhorar antes de abrir para as 50 pessoas da lista de espera: risco, funções que o Discord não tem, visual e experiência. Parte do estado atual do código (ver `PLANO-RESENHA-V3.md`) e de pesquisa sobre o que as pessoas reclamam do Discord. As fontes estão no fim.

---

## 1. O que mais importa, em cinco linhas

1. **O momento é real.** Desde 18/08/2026 o Go Live (transmissão de tela) do Discord está suspenso no Brasil, e o recurso deles foi negado em 19/11. O Resenha tem justamente transmissão de tela funcionando, com fixar e dividir. Isso explica boa parte do interesse no vídeo.
2. **Posicionamento:** "o app da sua galera". Beta fechado por convite, sem pedir documento nem foto de rosto (foi isso que fez a galera odiar o Discord em 2026).
3. **O diferencial que eu defenderia:** saber onde a galera está agora e entrar em um clique; combinar a resenha (horário e quem vai); assistir junto; e ser leve no 4G. São dores que aparecem nas reclamações e que o Discord não resolve.
4. **As suas duas ideias são boas, com ajustes:** a caixa de sugestões vira um mural de ideias com votos e status; a "sala realmente privada" vira sala trancada, com pedido para entrar e convite que expira. Detalhes na seção 4.
5. **Banco de ideias:** mais de 40 ideias, separadas por tema, para escolher o que combina com o seu público (seção 8).

---

## 2. Antes de qualquer função nova: o que precisa estar resolvido para as 50 pessoas

### 2.1 Convite e convivência
- **Convite obrigatório.** Sem código da lista de espera, ninguém cria conta. Isso controla quem entra e dá rastro de quem convidou quem.
- **Sem pedir documento.** Nada de RG ou foto de rosto. Vira argumento: "aqui ninguém te pede documento".
- **Denunciar e bloquear.** Com gente de fora da sua galera, alguém chato vai aparecer. "Bloquear" faz a pessoa sumir do seu chat, não te mandar DM e não te chamar pra call. "Denunciar" cai num painel que você e o Yves leem.
- **Remover rápido.** Vocês dois conseguirem, de um lugar só, apagar conteúdo, suspender conta e derrubar alguém de uma call. Já existe para moderadores de sala; falta para os donos do app.

### 2.2 Custo da call
O LiveKit grátis dá 5.000 minutos-pessoa por mês, umas 83 horas de pessoa em call. Com 50 pessoas fazendo resenha à noite, acaba em poucos dias e a call para pra todo mundo. O caminho de custo zero é rodar o LiveKit na VPS do Easypanel que já está paga: o código do app não muda, só URL e chaves. O ponto de atenção é a banda da VPS com transmissão em 1080p.

### 2.3 O que o Codex já resolveu (não precisa entrar de novo na lista)
Permissões de quem não está logado reduzidas, CSP e HSTS no servidor, JavaScript inicial caiu de ~890 KB para 332 KB com o LiveKit carregado sob demanda, busca e mensagens fixadas, deploy na Vercel. Falta ligar a confirmação de e-mail com o Resend (templates prontos em `emails/`) e trocar as URLs de redirecionamento do Supabase para o domínio da Vercel.

---

## 3. Funções que o Discord não tem e que alguém realmente precisa

Para cada uma: a dor (com de onde ela veio), como ficaria no Resenha, o tamanho do trabalho e a minha opinião sincera.

### 3.1 "Agora": onde está a galera, em um clique
**A dor.** O Discord removeu a aba que mostrava em qual call cada amigo estava, em todos os servidores. Hoje é preciso abrir servidor por servidor para descobrir onde a galera está. Isso aparece várias vezes no fórum oficial deles.
**No Resenha.** Um item fixo no topo do trilho, "Agora", que mostra numa tela só: quem está em call e em qual sala, quem está transmitindo o quê, e um botão "Entrar" em cada uma. No celular, é a primeira tela ao abrir o app quando tem call rolando.
**Tamanho.** Pequeno a médio. O servidor já lista participantes por sala; falta juntar as salas do usuário numa consulta só.
**Opinião.** É o meu favorito. É exatamente o que um grupo de amigos usa todo dia ("tem alguém na call?"), é visível no vídeo e ninguém tem bem feito.

### 3.2 Combinar a resenha (horário, quem vai, lembrete)
**A dor.** Falta agendamento e lembrete no Discord; os eventos existem, mas ficam escondidos e quase ninguém usa. Nos grupos, a combinação acontece no WhatsApp e depois todo mundo vai pro Discord.
**No Resenha.** Na sala: "Marcar resenha" com horário e título. Aparece fixo no topo do chat com três botões (tô dentro, talvez, fora) e avatares de quem confirmou. Na hora marcada, aviso pra quem confirmou e o card vira "Entrar na call".
**Tamanho.** Médio: uma tabela de eventos e respostas, um agendador para o aviso (o mesmo serviço de push que vai existir).
**Opinião.** Forte. Tira o WhatsApp do meio, que é o maior concorrente real para grupos de amigos no Brasil.

### 3.3 Assistir junto, de verdade
**A dor.** Transmitir um vídeo pela tela gasta muita internet de quem transmite e chega com qualidade ruim; e no Brasil a transmissão do Discord está suspensa.
**No Resenha.** Colar um link do YouTube e o vídeo toca sincronizado para todos na call, cada um puxando do próprio YouTube (play, pause e posição sincronizados pelo canal de tempo real). Quem entra no meio cai no mesmo ponto.
**Tamanho.** Médio. O player oficial do YouTube permite controlar tudo isso.
**Opinião.** Bom e barato de rodar, porque o vídeo não passa pelo nosso servidor: cada um puxa do próprio YouTube, então não gasta banda da call nem da VPS.

### 3.4 Leve no celular e no 4G
**A dor.** Reclamações frequentes de consumo de dados em chamada, quedas no 4G e app travando no celular.
**No Resenha.** Um "modo economia" nas configurações de áudio e vídeo: voz em qualidade menor, sem receber câmera dos outros (só avatar), transmissão em 720p. Liga sozinho quando o celular está em dados móveis, com aviso.
**Tamanho.** Pequeno. O LiveKit já permite escolher a qualidade que cada um recebe.
**Opinião.** Pouco chamativo, mas é o tipo de coisa que faz a pessoa ficar. O público do vídeo é jovem e muito no celular.

### 3.5 Privacidade como argumento
**A dor.** A revolta com o Discord em 2026 foi a exigência de documento ou rosto, logo depois de um vazamento de documentos de usuários, e a desconfiança de um app movido a anúncio e assinatura.
**No Resenha.** Uma página curta e honesta: sem anúncio, sem venda de dados, sem pedir documento; a barra de custos da loja mostrando quanto o projeto custa e quanto foi coberto; exportar e apagar a conta em dois cliques.
**Tamanho.** Pequeno (páginas e duas funções no servidor).
**Opinião.** É o que dá personalidade ao projeto. Só não prometa criptografia de ponta a ponta nas mensagens: é muito trabalho e não dá para fazer direito agora.

### 3.6 O que é do Brasil
Racha da conta com chave Pix, placar da pelada e retrospectiva da semana (ideias da conversa anterior). Continuam boas, mas são segundo plano. Fazem sentido depois que 3.1 e 3.2 estiverem rodando, porque dependem de a galera já usar o app no dia a dia.

### 3.7 O que eu deixaria de fora por enquanto
- **Loja e zoeiras pagas.** A estrutura está pronta em modo de teste, mas cobrar no beta pode azedar o primeiro contato. Eu abriria a loja depois que as 50 pessoas estiverem usando de verdade.
- **Bots e API para terceiros.** Abre porta para spam e conteúdo que vocês não controlam.
- **App de desktop.** A versão instalável pelo navegador já resolve para o beta.

---

## 4. Pensando junto nas suas ideias

### 4.1 Caixa de sugestões → Mural de ideias
**O que você propôs.** Um campo na barra lateral para a pessoa mandar sugestões.
**O ajuste que eu faria.** Se for só um campo de texto, as sugestões somem num banco que ninguém lê e quem sugeriu nunca sabe o que aconteceu. Melhor um **mural**:
- cada ideia vira um card com votos ("eu também quero");
- ideias parecidas se juntam (quando a pessoa digita, aparecem as já enviadas: "é isso aqui?");
- cada card tem status visível: recebida, vamos fazer, fazendo, saiu;
- quando sai, quem votou recebe aviso ("a função que você pediu chegou").

**Separe bug de ideia.** "Algo quebrou" é outro botão, que já anexa o aparelho, o navegador e um print da tela. Misturar os dois enterra os bugs.
**O cuidado.** Voto não decide sozinho o que fazer: dez pessoas pedindo "modo escuro mais escuro" valem menos que três pedindo "a call cai no 4G". Use o mural para enxergar a dor, não como fila.
**Bônus.** Cada card que sai vira conteúdo: "vocês pediram, eu fiz em uma madrugada".

### 4.2 "Deixar as salas realmente privadas"
**O que já existe.** Hoje toda sala nasce privada: só entra quem tem o convite, e quem não é membro não consegue ler nada (isso está garantido no banco, não só na tela). Pública é quem marcou "aparecer em Explorar".
**O que falta para ser "realmente".**
- **Sala trancada:** além do convite, o dono aprova cada pedido para entrar ("Fulano quer entrar, convidado por Ciclano").
- **Convites que expiram e de uso único** (a tela de configurações da sala já tem os campos desenhados).
- **Sala invisível:** nem o nome aparece fora dela, nem na prévia do convite para quem não foi aprovado.
- **Saber quem convidou quem:** ajuda o dono e ajuda a moderação.

**O cuidado.** Mesmo trancada, a denúncia e o bloqueio precisam funcionar lá dentro, senão o dono de uma sala chata fica sem saída.

---

## 5. Visual, design e experiência

O visual novo já passa a sensação de produto. Os pontos abaixo são o que separa "bonito no print" de "gostoso de usar todo dia".

**Primeira impressão.** O cadastro com convite, a confirmação de e-mail e o onboarding de boas-vindas (tudo desenhado no canvas) são a primeira coisa que as 50 pessoas veem. Vale priorizar sobre qualquer tela interna.

**Estados vazios e de erro.** Toda tela precisa dizer o que fazer quando não tem nada ("Nenhuma sala ainda: cole um convite ou crie a sua") e quando algo falhou ("Sem internet, tentando de novo" em vez de nada acontecer). Hoje vários erros só aparecem num aviso rápido que some.

**Reconexão.** Quando a internet oscila, mostrar uma faixa fina "reconectando" no topo e não derrubar a pessoa da call nem perder o texto que ela estava digitando (o Codex já guarda rascunho por conversa).

**Celular.** O app foi pensado para computador e adaptado. No celular, uma barra inferior fixa (Agora, Mensagens, Salas, Perfil) é mais natural que o menu escondido. A call no celular já ganhou troca de transmissão; falta testar em aparelho físico.

**Avisos na hora certa.** Pedir permissão de notificação só quando faz sentido ("quer ser avisado quando te marcarem?" depois da primeira menção), não ao abrir o app.

**Acessibilidade.** Conferir contraste do texto cinza no tema claro e navegação por teclado nos menus e modais.

**Consistência.** Barra de rolagem escondida, chaves no lugar de caixas de marcar e tipografia sem peso exagerado já foram decididos; manter isso em toda tela nova.

---

## 6. Ordem que eu sugiro

**Antes de mandar o primeiro convite.** Convite obrigatório, denunciar e bloquear, confirmação de e-mail com Resend, URLs do Supabase apontando para a Vercel, LiveKit na VPS (ou um plano pago enquanto isso) e o onboarding.

**Primeira semana do beta.** "Agora" (onde está a galera) e o mural de ideias com bug separado. Com isso você já tem o que mostrar e um canal para ouvir.

**Segunda semana.** Combinar a resenha e assistir junto.

**Depois que a galera estiver usando todo dia.** Sala trancada completa, modo economia, retrospectiva e, por fim, a loja.

---

## 7. Como saber se o beta deu certo

Sem painel complicado; dá para tirar tudo do banco:
- quantos dos 50 voltaram no dia seguinte e na semana seguinte;
- quantas salas têm 3 pessoas ou mais usando;
- horas de call por semana (é também a conta do custo);
- quantas pessoas convidaram alguém de fora da lista;
- as ideias mais votadas no mural e quantos bugs chegaram.

Se em duas semanas metade das 50 pessoas ainda estiver entrando toda semana, vale abrir a segunda leva.

---

## 8. Banco de ideias

Pensado para o público que está chegando pelo vídeo: jovem, brasileiro, grupo de amigos, jogo, futebol, faculdade, muito no celular e muita zoeira. Tamanho: **P** (uma madrugada), **M** (alguns dias), **G** (uma semana ou mais). As marcadas com ★ são as que eu escolheria primeiro, e o motivo está na frase.

### 8.1 Call: o coração do app
| Ideia | Por que faz sentido | Tam. |
|---|---|---|
| ★ **Agora** | Ver em qual call cada amigo está, em todas as salas, e entrar em um clique. O Discord tirou isso. | M |
| ★ **Chamar pra call** | Um toque que vibra o celular do amigo: "Bia tá te chamando na call da Resenha". Hoje a galera chama pelo WhatsApp. | P |
| **Status com prazo** | "Jogando até 23h", "volto às 22h": some sozinho quando o horário passa. | P |
| **Tô chegando** | Botão "entro em 5 min" que aparece pra quem já está na call, com contagem. | P |
| ★ **Clipar o momento** | Salva os últimos 30 segundos de uma transmissão ("o clutch do Caio") e já sai pronto pra postar no TikTok e no Reels. Avisa na call quando alguém clipa. Cada clipe postado é propaganda grátis do Resenha. | G |
| **Rádio da sala** | Fila de músicas tocando sincronizada pra todo mundo na call, cada um ouvindo do próprio YouTube. | M |
| **Volume que se ajusta** | Iguala o volume de quem grita com quem fala baixo, automaticamente. | M |
| **Aperte pra falar** | Segura uma tecla pra falar, bom pra quem tem barulho em casa. | P |
| **Procurando time** | "Falta 1 pro 5x5 de Valorant, ouro": quem clica entra na call. | M |

### 8.2 Chat e zoeira
| Ideia | Por que faz sentido | Tam. |
|---|---|---|
| ★ **Áudio no chat** | Segura e grava, estilo WhatsApp. Brasileiro vive de áudio e o Discord só tem no celular. | M |
| ★ **Pérolas da resenha** | Mensagem que passa de X reações vai sozinha pra um mural de melhores momentos da sala. É a memória do grupo e rende print. | P |
| **Enquete rápida** | "/enquete pizza ou hambúrguer?" com votos na hora. | P |
| **Figurinha de print** | Recorta um print ou foto e vira figurinha da sala, como no WhatsApp. | M |
| **Apelido por sala** | O dono dá apelido a cada um só naquela sala. | P |
| **Mensagem que some** | Some em 24h ou depois de vista, pra fofoca. | M |
| **Quem é mais provável…** | Jogo de votação anônima: "quem é mais provável de chegar atrasado?". Viraliza em grupo de amigos. | M |
| **Verdade ou desafio** | O Sorteador escolhe quem e o quê, na call. | P |
| **Zoeiras da loja** | Chapéu de palhaço, apelido forçado, efeitos de tela (já desenhadas). | G |

### 8.3 Combinar e organizar a vida real
| Ideia | Por que faz sentido | Tam. |
|---|---|---|
| ★ **Marcar a resenha** | Horário, "tô dentro / talvez / fora" e aviso na hora. Tira o WhatsApp do meio. | M |
| **Racha da conta** | Divide a pizza e mostra a chave Pix de quem pagou. Só calcula, não mexe em dinheiro. | P |
| **Placar da pelada** | Depois do Sorteador, registra quem ganhou: ranking da temporada. | M |
| **Aniversários** | Avisa a sala no dia e solta o /parabéns. | P |
| **Quem leva o quê** | Lista do churrasco: cada um marca o que leva. | P |

### 8.4 Ficar e voltar (retenção)
| Ideia | Por que faz sentido | Tam. |
|---|---|---|
| ★ **Ofensiva da galera** | Dias seguidos com a sala em call, com foguinho e contador, como a ofensiva do Snapchat. Ninguém quer ser quem quebrou a sequência. | P |
| ★ **Retrospectiva (Wrapped)** | Toda semana, e um grande no fim do ano: horas de call, quem mais falou, a pérola mais reagida. Sai como imagem de story pra postar. Cada story leva gente nova. | M |
| **Conquistas da sala** | Insígnias coletivas: "100 horas de call juntos". | P |
| **Resumo do que rolou** | Ao voltar depois de horas fora, um resumo das conversas em vez de 300 mensagens. | M |
| **Horário de silêncio** | Sem aviso durante a aula ou o trabalho, configurado uma vez. | P |

### 8.5 Perfil e identidade
| Ideia | Por que faz sentido | Tam. |
|---|---|---|
| **Jogos que eu jogo** | Lista com rank e nick de cada jogo no perfil. | P |
| **Tocando agora** | Mostra a música do Spotify no perfil e na lista de membros. | M |
| **Música do perfil** | Um trecho que toca quando alguém abre seu perfil, como o Orkut e o MySpace. A galera mais velha vai lembrar, a mais nova vai achar novo. | M |
| **Cartão de perfil personalizado** | Fundos animados e molduras (loja). | M |

### 8.6 Crescer (cada função traz gente)
| Ideia | Por que faz sentido | Tam. |
|---|---|---|
| ★ **Convite com prévia bonita** | Link de convite que, colado no WhatsApp, mostra a sala, quem está nela e "3 na call agora". | P |
| **Indique e ganhe** | Quem traz 3 amigos ganha um item da loja. | P |
| **Card de clipe e de pérola** | Toda pérola e todo clipe com um botão "postar" que já gera a imagem ou o vídeo com a marca do Resenha. | M |
| **Lista de espera com fila** | "Você é o 37º da fila; convide 1 amigo e suba 10 posições." | P |

### 8.7 Celular e internet ruim
| Ideia | Por que faz sentido | Tam. |
|---|---|---|
| ★ **Modo economia** | Voz mais leve e sem câmera dos outros no 4G, ligando sozinho. | P |
| **Mensagem na fila** | Sem sinal, a mensagem fica esperando e sai quando a conexão volta. | M |
| **Barra inferior no celular** | Agora, Mensagens, Salas, Perfil: navegação de app de verdade. | M |

### 8.8 Pra criador de conteúdo (você e quem te segue)
| Ideia | Por que faz sentido | Tam. |
|---|---|---|
| **Palco** | Uma sala onde só alguns falam e o resto assiste e levanta a mão pra subir. Com a transmissão do Discord parada no Brasil, criador pequeno precisa de um lugar pra fazer live com a comunidade. Atenção: é a função mais cara de banda. | G |
| **Mural de clipes da comunidade** | Os melhores clipes da semana, votados. | M |

### Meu top 10 para o seu público
1. Agora
2. Chamar pra call
3. Áudio no chat
4. Pérolas da resenha
5. Marcar a resenha
6. Ofensiva da galera
7. Retrospectiva para story
8. Convite com prévia bonita
9. Clipar o momento
10. Modo economia

As cinco primeiras deixam o app mais gostoso de usar todo dia. Da 6 à 9, cada uso faz a galera voltar ou trazer gente nova. A 10 segura quem está no celular.

---

## Fontes
- ANPD determina suspensão das transmissões ao vivo do Discord: https://agenciagov.ebc.com.br/noticias/202608/em-medida-preventiva-anpd-determina-que-discord-suspenda-transmissoes-ao-vivo
- Tecnoblog sobre a ordem da ANPD: https://tecnoblog.net/noticias/anpd-ordena-que-discorde-suspenda-transmissoes-ao-vivo-no-brasil/
- ANPD rejeita recurso do Discord (19/11/2026): https://teletime.com.br/19/11/2026/anpd-rejeita-recurso-discord/
- Revolta com a verificação de idade do Discord: https://techcrunch.com/2026/02/24/discord-delays-global-rollout-of-age-verification-after-backlash/ e https://www.eff.org/deeplinks/2026/02/discord-voluntarily-pushes-mandatory-age-verification-despite-recent-data-breach
- Por que as pessoas saem do Discord: https://bgr.com/2203337/reasons-why-people-ditching-discord/ e https://engadget.com/2193599/open-source-discord-alternatives-what-stoat-and-element-actually-fix
- Aba de amigos sem saber quem está em call: https://support.discord.com/hc/vi/community/posts/5874093823255--Friends-tab-is-overall-not-as-useful-as-it-could-be
- Falta de agendamento e lembretes, busca difícil: https://pumble.com/reviews/discord-review
- Excesso de notificações: https://konvoy.vc/content/discords-vulnerability
- Consumo de dados e quedas no celular: https://wisechecker.com/pt/discord-voz-celular-cai-resolver/ e https://canaltech.com.br/apps/app-do-discord-ganha-novo-visual-e-usuarios-reclamam-272573/
- Pedidos que o próprio Discord atendeu em 2026 (para não copiar): https://www.dexerto.com/entertainment/discord-rolls-out-huge-batch-of-highly-requested-features-after-asking-users-for-ideas-3410116/
