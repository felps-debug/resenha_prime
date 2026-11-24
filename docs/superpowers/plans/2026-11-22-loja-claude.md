# Loja do Claude no Resenha — Plano de implementação

**Goal:** Substituir o modal único do Telão por uma página de loja inspirada no artefato Resenha — redesign do Claude, com catálogo, categorias, painel do item e layout responsivo.

**Architecture:** A Loja será uma view própria no app existente, aberta tanto pelo trilho quanto pelo canal da sala. Os produtos e preços visuais virão de um catálogo estático alinhado ao protótipo; nenhum novo fluxo Stripe ou gravação de compra será criado. O formulário existente do Telão permanece acessível como etapa visual após selecionar o item.

**Tech Stack:** JavaScript ES modules, HTML sem framework, CSS existente, Supabase JS já instalado.

**Spec:** `docs/PLANO-RESENHA-V3.md` §3.3; artefato Claude `Resenha — redesign`, artboards “Chat da sala (PC)”, “Loja (valores simbólicos)” e “Celular: loja”.

## Global Constraints

- Manter a stack, navegação e utilitários DOM existentes.
- Não adicionar dependências.
- Não configurar nem alterar backend/checkout Stripe.
- Seguir o catálogo, as categorias e a apresentação aprovados no protótipo Claude.
- Funcionar em desktop e celular sem esconder o caminho de voltar para a sala.

## Review Focus

- Usuário sem sala selecionada: Loja deve abrir e informar quando um item exige sala.
- Item inexistente/inativo no banco: a vitrine visual continua renderizando; o Telão usa apenas preço obtido do banco ao personalizar.
- Janela estreita: categorias, cartões e painel do produto devem caber e permanecer navegáveis.
- Compras ausentes: “Acontecendo agora” e “Meus itens” exibem estado vazio sem inventar compras.
- CTA de compra: não criar sessão de checkout nem compra no servidor enquanto Stripe estiver fora do escopo.

---

### Task 1: Navegação da Loja como view

**Files:** `public/index.html`, `src/main.js`

- [ ] Adicionar canal “Loja · APOIE” à navegação da sala e uma raiz `#shop-view` dentro da área principal.
- [ ] Fazer o botão do trilho e o canal chamarem `setView('shop')` sem abrir modal.
- [ ] Atualizar `setView` para ocultar chat, call e membros enquanto a Loja está ativa; criar ação “Voltar” para restaurar a view anterior.

### Task 2: Catálogo e painel de produto

**Files:** `src/main.js`

- [ ] Definir dados visuais dos produtos e categorias da Loja iguais ao artboard Claude.
- [ ] Renderizar apresentação/valores simbólicos, filtros por categoria, cards, detalhes do item selecionado e estados vazios para itens próprios/atividade.
- [ ] Manter opções visuais de destinatário e personalização; submeter o CTA com aviso de checkout ainda não configurado, sem chamar `/api/checkout`.

### Task 3: Layout desktop e mobile

**Files:** `public/style.css`

- [ ] Criar layout de vitrine com grid de produtos à esquerda e detalhe do item à direita em desktop.
- [ ] Empilhar/colapsar painel e permitir rolagem horizontal de categorias em celular.
- [ ] Conferir `npm run build`, diff e os estados visuais em desktop e mobile.
