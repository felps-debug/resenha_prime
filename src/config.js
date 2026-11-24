// Tela de Configurações (igual a docs/telas/Config.dc.html).
// Abre pela engrenagem do rodapé. Menu: SUAS CONFIGURAÇÕES e DO APP.
// As seções Perfil, Áudio e vídeo e Notificações vêm do main.js (ctx.mount), que as desenha dentro do painel.
import { h, $, toast, confirmModal } from './ui.js';
import { ACCENTS, DEFAULT_ACCENT, getPrefs, setPrefs, isHex, onThemeChange } from './theme.js';
import { loadSettings, saveSettings } from './call.js';

export const SHORTCUTS = [
  { keys: 'Alt + Shift + M', label: 'Mutar ou desmutar o microfone', id: 'mic' },
  { keys: 'Alt + Shift + D', label: 'Desativar ou ativar o áudio (fone)', id: 'deaf' },
  { keys: 'Alt + Shift + L', label: 'Sair da call', id: 'leave' },
  { keys: 'Esc', label: 'Fechar menus e janelas', id: 'esc' }
];

const MINE = [['account', 'Minha conta'], ['profile', 'Perfil'], ['audio', 'Áudio e vídeo'], ['notif', 'Notificações'], ['zoeira', 'Zoeira']];
const APP = [['look', 'Aparência'], ['keys', 'Atalhos'], ['about', 'Sobre o Resenha']];
const DESC = {
  look: 'Vale pra este aparelho. As outras pessoas continuam com o tema delas.',
  account: 'E-mail, senha e contas conectadas.',
  profile: 'Como as outras pessoas te veem.',
  audio: 'Microfone, saída de som e câmera.',
  notif: 'O que toca e o que aparece.',
  zoeira: 'Quais zoeiras podem te pegar na call.',
  keys: 'Atalhos de teclado, como mutar e sair da call.',
  about: 'Versão e novidades.'
};

let root = null;
let offTheme = null;

export function isConfigOpen() { return Boolean(root); }

export function closeConfig() {
  if (!root) return;
  if (offTheme) offTheme();
  offTheme = null;
  root.remove();
  root = null;
  document.removeEventListener('keydown', onKey, true);
  const app = $('app');
  if (app) app.removeAttribute('inert');
}
function onKey(e) {
  if (e.key === 'Escape' && !document.querySelector('#modal-layer .modal-bg') && !document.querySelector('#menu-layer .menu')) {
    e.stopPropagation();
    closeConfig();
  }
}

const maskEmail = (e) => {
  if (!e || !e.includes('@')) return e || '';
  const [u, d] = e.split('@');
  return u.slice(0, 1) + '•'.repeat(Math.max(3, Math.min(8, u.length - 1))) + '@' + d;
};

// ctx: { sb, getMe, getSession, avatarEl(), mount(pane, container), signOut, updates() }
export function openConfig(ctx, start = 'look') {
  closeConfig();
  let pane = start;
  const me = ctx.getMe();

  const nav = h('nav', { class: 'cfg-nav', 'aria-label': 'Configurações' });
  const main = h('main', { class: 'cfg-main' });
  const close = h('button', { class: 'cfg-close', 'aria-label': 'Fechar configurações', title: 'Fechar (Esc)', onClick: closeConfig },
    h('span', { html: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>' }));
  root = h('div', { class: 'cfg', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Configurações' }, nav, main, close);
  document.body.append(root);
  document.addEventListener('keydown', onKey, true);
  $('app').setAttribute('inert', '');

  const item = ([id, name]) => h('button', { class: 'cfg-item', 'aria-current': pane === id ? 'page' : 'false', onClick: () => go(id) }, name);

  function drawNav() {
    nav.replaceChildren(
      h('div', { class: 'cfg-me' }, ctx.avatarEl(), h('span', { class: 'cfg-me-text' }, h('b', null, me.display_name), h('small', null, 'Abriu pela engrenagem'))),
      h('div', { class: 'cfg-cat' }, 'SUAS CONFIGURAÇÕES'),
      ...MINE.map(item),
      h('div', { class: 'cfg-cat' }, 'DO APP'),
      ...APP.map(item),
      h('div', { class: 'cfg-spacer' }),
      h('button', { class: 'cfg-item danger', onClick: async () => {
        if (!(await confirmModal({ title: 'Sair da conta?', text: 'Você volta para a tela de entrada.', confirm: 'Sair', danger: true }))) return;
        closeConfig();
        ctx.signOut();
      } }, 'Sair da conta'));
  }

  function go(id) {
    pane = id;
    drawNav();
    main.replaceChildren();
    const title = [...MINE, ...APP].find((x) => x[0] === id)[1];
    const head = [h('h1', { class: 'cfg-title' }, title), h('p', { class: 'cfg-desc' }, DESC[id])];
    const body = h('div', { class: 'cfg-body' });
    main.append(...head, body);
    main.scrollTop = 0;
    if (offTheme) { offTheme(); offTheme = null; }
    if (id === 'look') paintLook(body);
    else if (id === 'account') paintAccount(body, ctx);
    else if (id === 'zoeira') paintZoeira(body);
    else if (id === 'keys') paintKeys(body);
    else if (id === 'about') paintAbout(body, ctx);
    else ctx.mount(id, body);
  }

  go(pane);
  const first = nav.querySelector('[aria-current="page"]');
  if (first) first.focus();
}

const card = (title, ...kids) => h('section', { class: 'cfg-card' }, title ? h('h2', null, title) : null, ...kids);
const row = (label, hint, control) => h('label', { class: 'cfg-row' }, h('span', { class: 'cfg-row-text' }, h('b', null, label), hint ? h('small', null, hint) : null), control);
function toggle(checked, onChange) {
  const cb = h('input', { type: 'checkbox', class: 'cfg-switch', checked });
  cb.addEventListener('change', () => onChange(cb.checked));
  return cb;
}

// ---------- Aparência ----------
function paintLook(body) {
  const modes = [
    ['dark', 'Escuro', 'cfg-prev dark'],
    ['light', 'Claro', 'cfg-prev light'],
    ['system', 'Seguir o sistema', 'cfg-prev system']
  ];
  const modeBox = h('div', { class: 'cfg-modes', role: 'radiogroup', 'aria-label': 'Modo' });
  const swatches = h('div', { class: 'cfg-swatches', role: 'radiogroup', 'aria-label': 'Cor de destaque' });
  const custom = h('input', { type: 'color', class: 'cfg-color-input', 'aria-label': 'Escolher outra cor' });

  const paint = () => {
    const p = getPrefs();
    modeBox.replaceChildren(...modes.map(([id, name, cls]) => h('button', {
      class: 'cfg-mode', role: 'radio', 'aria-checked': String(p.mode === id), onClick: () => setPrefs({ mode: id })
    }, h('span', { class: cls }, h('i'), h('span', null, h('u'), h('u'), h('em'))), h('b', null, name))));
    const known = ACCENTS.some(([, hex]) => hex.toLowerCase() === p.accent.toLowerCase());
    swatches.replaceChildren(...ACCENTS.map(([name, hex]) => h('button', {
      class: 'cfg-swatch', role: 'radio', title: name, 'aria-label': name, 'aria-checked': String(p.accent.toLowerCase() === hex.toLowerCase()),
      style: { background: hex, '--ring': hex }, onClick: () => setPrefs({ accent: hex })
    }, h('span', { html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>' }))),
    h('label', { class: 'cfg-other', 'data-on': String(!known) }, h('span', { class: 'cfg-other-dot', style: { background: p.accent } }), 'Outra cor', custom));
    custom.value = isHex(p.accent) ? p.accent : DEFAULT_ACCENT;
  };
  custom.addEventListener('input', () => setPrefs({ accent: custom.value }));
  paint();
  offTheme = onThemeChange(paint);

  body.append(
    card('Modo', modeBox),
    card('Cor de destaque', h('p', { class: 'cfg-hint' }, 'Botões, menções, abas e o anel de quem fala'), swatches),
    card('Prévia', h('div', { class: 'cfg-preview' },
      h('div', { class: 'cfg-preview-msg' },
        h('span', { class: 'cfg-preview-av' }, 'B'),
        h('div', null, h('div', null, h('b', null, 'Bia'), h('small', null, ' 21:02')),
          h('div', null, 'Bora call? ', h('span', { class: 'cfg-preview-mention' }, '@' + (document.getElementById('me-name') ? document.getElementById('me-name').textContent : 'você')), ' vem também'))),
      h('div', { class: 'cfg-preview-actions' }, h('span', { class: 'primary' }, 'Entrar na call'), h('span', { class: 'secondary' }, 'Depois')))));
}

// ---------- Minha conta ----------
async function paintAccount(body, ctx) {
  const { sb } = ctx;
  const session = ctx.getSession();
  const user = session.user;
  let identities = [];
  try { identities = ((await sb.auth.getUserIdentities()).data || {}).identities || []; } catch (_) {}
  const hasPassword = identities.length ? identities.some((i) => i.provider === 'email') : true;
  const google = identities.find((i) => i.provider === 'google');

  const msg = (el, text, ok) => { el.textContent = text; el.className = 'msg' + (ok ? ' ok' : ''); };

  // E-mail
  const emailMsg = h('p', { class: 'msg', role: 'status' });
  const newEmail = h('input', { type: 'email', placeholder: 'novo@email.com', autocomplete: 'email' });
  const emailForm = h('form', { class: 'cfg-inline', hidden: true },
    newEmail,
    h('button', { class: 'btn primary', type: 'submit' }, 'Mandar link de confirmação'));
  emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = newEmail.value.trim();
    if (!v) return;
    const { error } = await sb.auth.updateUser({ email: v });
    if (error) msg(emailMsg, 'Não foi possível trocar o e-mail: ' + error.message);
    else { msg(emailMsg, 'Mandamos um link de confirmação. O e-mail só muda depois que você clicar nele.', true); emailForm.hidden = true; }
  });
  const emailBtn = h('button', { class: 'btn secondary', type: 'button', onClick: () => { emailForm.hidden = !emailForm.hidden; if (!emailForm.hidden) newEmail.focus(); } }, 'Alterar e-mail');

  // Senha
  const passMsg = h('p', { class: 'msg', role: 'status' });
  const cur = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Senha atual' });
  const nw = h('input', { type: 'password', autocomplete: 'new-password', minlength: '6', placeholder: 'Nova senha (mínimo 6 caracteres)' });
  const passForm = h('form', { class: 'cfg-inline', hidden: true }, hasPassword ? cur : null, nw, h('button', { class: 'btn primary', type: 'submit' }, 'Salvar senha'));
  passForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (nw.value.length < 6) { msg(passMsg, 'A nova senha precisa ter pelo menos 6 caracteres.'); return; }
    if (hasPassword) {
      const chk = await sb.auth.signInWithPassword({ email: user.email, password: cur.value });
      if (chk.error) { msg(passMsg, 'A senha atual está errada.'); return; }
    }
    const { error } = await sb.auth.updateUser({ password: nw.value });
    if (error) msg(passMsg, 'Não foi possível trocar a senha: ' + error.message);
    else { msg(passMsg, 'Senha trocada.', true); cur.value = ''; nw.value = ''; passForm.hidden = true; }
  });
  const passBtn = h('button', { class: 'btn secondary', type: 'button', onClick: () => { passForm.hidden = !passForm.hidden; if (!passForm.hidden) (hasPassword ? cur : nw).focus(); } }, hasPassword ? 'Trocar senha' : 'Criar senha');

  // Google
  const gMsg = h('p', { class: 'msg', role: 'status' });
  const gBtn = h('button', { class: 'btn secondary', type: 'button' }, google ? 'Desconectar' : 'Conectar');
  gBtn.addEventListener('click', async () => {
    if (google) {
      if (identities.length < 2) { msg(gMsg, 'É o seu único jeito de entrar. Crie uma senha antes de desconectar.'); return; }
      if (!(await confirmModal({ title: 'Desconectar o Google?', text: 'Você continua entrando com e-mail e senha.', confirm: 'Desconectar', danger: true }))) return;
      const { error } = await sb.auth.unlinkIdentity(google);
      if (error) msg(gMsg, 'Não foi possível desconectar: ' + error.message);
      else { toast('Google desconectado.'); paintAgain(); }
    } else {
      const { error } = await sb.auth.linkIdentity({ provider: 'google', options: { redirectTo: location.origin } });
      if (error) msg(gMsg, 'Não foi possível conectar o Google: ' + error.message);
    }
  });
  const paintAgain = () => { body.replaceChildren(); paintAccount(body, ctx); };

  body.append(
    card('Acesso',
      row('E-mail', maskEmail(user.email), emailBtn), emailForm, emailMsg,
      row('Senha', hasPassword ? 'Pede a senha atual antes de trocar' : 'Você entra só pelo Google', passBtn), passForm, passMsg,
      row('Google', google ? 'Conectado' : 'Não conectado', gBtn), gMsg));
}

// ---------- Zoeira ----------
function paintZoeira(body) {
  const s = loadSettings();
  body.append(card('Na call',
    row('Aceitar zoeiras em mim', 'Desligado: ninguém consegue te mandar pra privada, e você não vê a animação quando é com você.', toggle(s.zoeiraOnMe !== false, (v) => { const c = loadSettings(); c.zoeiraOnMe = v; saveSettings(c); })),
    row('Som das zoeiras', 'Grito, descarga e o resto. Desligado: só a animação.', toggle(s.zoeiraSound !== false, (v) => { const c = loadSettings(); c.zoeiraSound = v; saveSettings(c); }))));
}

// ---------- Atalhos ----------
function paintKeys(body) {
  body.append(card('Teclado',
    ...SHORTCUTS.map((k) => h('div', { class: 'cfg-row' }, h('span', { class: 'cfg-row-text' }, h('b', null, k.label)), h('kbd', null, k.keys))),
    h('p', { class: 'cfg-hint' }, 'Os atalhos de mutar, áudio e sair só funcionam com você dentro da call.')));
}

// ---------- Sobre ----------
async function paintAbout(body, ctx) {
  const list = h('div', { class: 'cfg-updates' }, h('p', { class: 'cfg-hint' }, 'Carregando…'));
  body.append(card('Resenha', h('p', { class: 'cfg-hint' }, 'Salas de voz, chat e transmissão de tela para a sua galera.')), card('Novidades', list));
  try {
    const items = await ctx.updates();
    list.replaceChildren(...items.slice(0, 5).map((u) => h('div', { class: 'cfg-update' },
      h('div', null, h('b', null, u.titulo), h('small', null, ` · v${u.versao} · ${u.data}`)),
      h('ul', null, ...(u.itens || []).map((i) => h('li', null, i))))));
  } catch (_) { list.replaceChildren(h('p', { class: 'cfg-hint' }, 'Não deu para carregar as novidades.')); }
}
