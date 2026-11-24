# Telas do Resenha (versão final)

Estas são as telas finais do Resenha. **O app tem que ficar igual a elas.** Não são esboço: cor, fonte, tamanho, espaçamento, ícone, animação e comportamento são para copiar.

O que fazer está em `docs/CHECKLIST-CODEX.md`.

## O que tem aqui

- `prints/*.png` — foto de página inteira de cada tela. Olhe antes de mexer.
- `*.dc.html` — o código de cada tela, com estilos inline e a lógica de demonstração.
- `support.js` — o motor que faz os `.dc.html` funcionarem no navegador.
- `canvas.json` — a lista das telas com nome e tamanho.

## Como abrir as telas funcionando

```bash
cd docs/telas
python -m http.server 5178
```

Abra `http://127.0.0.1:5178/Main.dc.html`. Os links entre telas funcionam (chat → call → configurações etc.).

## Como ler um `.dc.html`

- Tudo dentro de `<x-dc>` é a tela. Os estilos estão inline em cada elemento; copie os valores.
- O `<helmet><style>` tem as animações e os estados de hover. Copie também.
- `{{nome}}` é um valor de `renderVals()` (no `<script>` do fim). No app vem do banco ou do estado.
- `<sc-for list="{{x}}" as="y">` é um laço (`map`). `<sc-if value="{{c}}">` é um `if`.
- `onClick="{{acao}}"` é o clique; a ação está em `renderVals()`.
- `<a href="Outra.dc.html">` é a navegação; no app vira a rota ou a view.
- Nomes e mensagens de exemplo (Bia, Caio, Duda…) estão no `<script>`. No app vêm do banco. Nunca deixe dado fixo.
- Texto entre colchetes, como `[player do YouTube]`, é lugar reservado para o conteúdo real.

## Padrão que vale para todas as telas do app

Toda tela que mostra o app aberto usa o mesmo esqueleto (veja `Main.dc.html`, `Transmissao.dc.html` e `DMs.dc.html`):

1. **Trilho de salas** (esquerda): mensagens diretas, divisória, salas, **+ adicionar sala** (tracejado verde), **explorar salas públicas** (bússola), espaço, **loja** (sacola) embaixo.
2. **Lista de canais** com os grupos **TEXTO** e **VOZ**, cada um com **+ criar canal**. O canal de voz com gente vira um card vivo com quem está nele.
3. **Rodapé com você**: foto, nome, status (Online / Mutado / Sem áudio), **microfone** (fica vermelho e cortado quando mutado), **fone** (desativar áudio; também muta) e **engrenagem** (abre `Config.dc.html`).
4. **Micro-animações**: ícones dos canais e do trilho mexem no hover (megafone balança, # pula, sacola se desenha, bússola gira, + gira, engrenagem gira).
5. **Painel de membros** abre e fecha deslizando, com as pessoas entrando em cascata.
6. **Na call, todo quadro pode ser fixado** (tela, câmera ou avatar).

## Mapa das telas

| Tela | Arquivo |
|---|---|
| Chat da sala (o esqueleto padrão) | `Main.dc.html` |
| Call com telas transmitidas, canais de texto e voz | `Transmissao.dc.html` |
| Call: fixar qualquer quadro e layouts (destaque, lado a lado, câmera flutuante) | `CallFixar.dc.html` |
| Transmitir tela (pop-up nosso) | `Compartilhar.dc.html` |
| Call: música e assistir junto, barra de baixo em pílula | `Atividades.dc.html` |
| DJ Resenha, bot de música `m!` | `DJ.dc.html` |
| Mensagens diretas | `DMs.dc.html` |
| Configurações: suas (conta, perfil, áudio e vídeo…) e do app (aparência/tema) | `Config.dc.html` |
| Loja | `Loja.dc.html` |
| Loja: compra e agradecimento | `LojaCompra.dc.html` |
| Vaquinha | `Vaquinha.dc.html` |
| Salas públicas e criar sala | `Explorar.dc.html` |
| Configurações da sala e moderação | `SalaConfig.dc.html` |
| Criar canal de texto ou voz | `CriarCanal.dc.html` |
| Entrar | `Login.dc.html` |
| Criar conta e confirmar e-mail | `Cadastro.dc.html` |
| Redefinir senha | `Senha.dc.html` |
| Onboarding | `Onboarding.dc.html` |
| Logo | `Logo.dc.html` |
| Celular: chat, menu, call, mensagens, loja | `Mobile*.dc.html` |

Cada tela tem a foto em `prints/<Tela>.png`.
