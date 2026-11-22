// Resenha v2 — app principal: login, salas, cargos, chat salvo e call.
import { createClient } from '@supabase/supabase-js';
import {
  $, h, ICON, avatar, colorFor, toast, openMenu, closeMenu, openModal, closeModal, confirmModal,
  field, linkify, fmtTime, STATUS, statusDot, setBeepsMuted, beep, initRipple, setupThemeToggle
} from './ui.js';
import { prepareImage, prepareChatImage, storagePath } from './profile.js';
import { openEmojiPicker } from './emoji.js';
import { badgeIcon, badgeRow, RARITY_LABEL } from './badges.js';
import { COMMANDS, parseCommand, resultCard, BOT_ICON } from './draw.js';
import { createChatCache } from './chat-cache.js';
import { moveFocus } from './focus-navigation.js';
import {
  call, joinCall, leaveCall, toggleMic, setDeafened, toggleCam, toggleScreen, participants, renderStage,
  getVolume, setVolume, loadSettings, saveSettings, switchDevice, applyAudioFilters, listDevices
} from './call.js';

// ================= Estado =================
let sb = null;
let cfg = null;
let session = null;
let me = null;              // { id, display_name }
let rooms = [];             // salas em que sou membro
let cachedRailRooms = [];   // prévia visual, sem acesso até confirmar no servidor
const textDrafts = new Map(); // rascunhos separados enquanto o aplicativo está aberto
const imageDrafts = new Map(); // no máximo três anexos, mantidos apenas em memória
let current = null;         // sala aberta
let roomRevision = 0;       // invalida respostas de aberturas anteriores da mesma sala
let members = [];           // membros da sala aberta
let roles = [];             // cargos da sala aberta
let view = 'chat';
let roomChannel = null;
let meChannel = null;
let oldestId = null;
let lastMsg = null;
let previewTimer = null;
let callPreview = [];       // quem está na call (antes de eu entrar)
const names = new Map();    // id -> display_name
const profs = new Map();    // id -> { display_name, avatar_url, banner_url }
let myStatus = 'online';    // escolhido: online | idle | dnd | invisible
let autoIdle = false;       // ausente automático por inatividade
let presenceChannel = null;
let presenceState = {};
let lastActivity = Date.now();
let installPrompt = null;
let started = false;
let chatCache = null;
let pinnedIds = new Set();
let pinsModal = null;

const ROLE_LABEL = { owner: 'Dono', moderator: 'Moderador', member: 'Membro' };
const RANK = { owner: 3, moderator: 2, member: 1 };

// ================= Inicialização =================
boot();

async function boot() {
  initRipple();
  const params = new URLSearchParams(location.search);
  const invite = params.get('convite');
  if (invite) {
    sessionStorage.setItem('resenha:invite', invite);
    params.delete('convite');
    history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : ''));
  }
  try {
    cfg = await (await fetch('/config')).json();
  } catch (_) {
    $('boot').textContent = 'Não foi possível carregar. Recarregue a página.';
    return;
  }
  sb = createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
  });

  sb.auth.onAuthStateChange((event, s) => {
    session = s;
    if (event === 'PASSWORD_RECOVERY') { showRecovery(); return; }
    if (s && !started && !recovering) setTimeout(startApp, 0);
    if (!s && started) location.reload();
  });
  const { data } = await sb.auth.getSession();
  session = data.session;
  $('boot').hidden = true;
  if (recovering) return;
  if (session) startApp(); else showAuth('login');

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; showInstall(true); });
  window.addEventListener('appinstalled', () => { installPrompt = null; showInstall(false); toast('App instalado! Procure por Resenha no menu Iniciar.', 4000); });
  $('install-auth').addEventListener('click', installApp);
  $('install-rail').addEventListener('click', installApp);
}

// ================= Instalar como app =================
function showInstall(v) {
  $('install-auth').hidden = !v;
  $('install-rail').hidden = !v;
}
async function installApp() {
  if (!installPrompt) {
    toast('Use o ícone de instalar na barra de endereço do Chrome ou do Edge.', 4000);
    return;
  }
  installPrompt.prompt();
  const choice = await installPrompt.userChoice;
  installPrompt = null;
  showInstall(false);
  if (choice && choice.outcome === 'accepted') toast('Instalando…');
}

// ================= Login =================
let authMode = 'login';
function showAuth(mode) {
  authMode = mode;
  $('auth-screen').hidden = false;
  $('app').hidden = true;
  const isSignup = mode === 'signup';
  const isForgot = mode === 'forgot';
  const isReset = mode === 'reset';
  $('auth-title').textContent = isSignup ? 'Criar conta' : isForgot ? 'Recuperar senha' : isReset ? 'Nova senha' : 'Bem-vindo de volta!';
  $('auth-sub').textContent = isSignup ? 'É rapidinho.' : isForgot ? 'Vamos te mandar um link por e-mail.' : isReset ? 'Escolha uma senha nova.' : 'Entre para ver suas salas.';
  $('name-field').hidden = !isSignup;
  $('auth-name').required = isSignup;
  $('email-field').hidden = isReset;
  $('auth-email').required = !isReset;
  $('pass-field').hidden = isForgot;
  $('auth-pass').required = !isForgot;
  $('auth-pass').autocomplete = isSignup || isReset ? 'new-password' : 'current-password';
  $('forgot-link').hidden = mode !== 'login';
  $('oauth-box').hidden = isForgot || isReset;
  $('auth-submit').textContent = isSignup ? 'Criar conta' : isForgot ? 'Enviar link' : isReset ? 'Salvar senha' : 'Entrar';
  $('switch-text').textContent = isSignup ? 'Já tem conta?' : isForgot || isReset ? '' : 'Ainda não tem conta?';
  $('switch-btn').textContent = isSignup || isForgot || isReset ? 'Voltar para o login' : 'Criar conta';
  $('auth-msg').textContent = '';
  $('auth-msg').className = 'msg';
}

let recovering = false;
function showRecovery() {
  recovering = true;
  showAuth('reset');
}

$('switch-btn').addEventListener('click', () => showAuth(authMode === 'login' ? 'signup' : 'login'));
$('forgot-link').addEventListener('click', () => showAuth('forgot'));

$('google-btn').addEventListener('click', async () => {
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin } });
  if (error) authMsg(traduzir(error.message));
});

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('auth-email').value.trim();
  const pass = $('auth-pass').value;
  const btn = $('auth-submit');
  btn.disabled = true;
  authMsg('');
  try {
    if (authMode === 'login') {
      const { error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
    } else if (authMode === 'signup') {
      const name = $('auth-name').value.trim();
      const { data, error } = await sb.auth.signUp({
        email, password: pass, options: { data: { display_name: name }, emailRedirectTo: location.origin }
      });
      if (error) throw error;
      if (!data.session) authMsg('Conta criada! Confira seu e-mail para confirmar e depois entre.', true);
    } else if (authMode === 'forgot') {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
      if (error) throw error;
      authMsg('Se esse e-mail tiver conta, o link de recuperação chega em instantes.', true);
    } else if (authMode === 'reset') {
      const { error } = await sb.auth.updateUser({ password: pass });
      if (error) throw error;
      authMsg('Senha alterada!', true);
      setTimeout(() => location.replace('/'), 800);
    }
  } catch (err) {
    authMsg(traduzir(err.message));
  } finally {
    btn.disabled = false;
  }
});

function authMsg(text, ok) {
  $('auth-msg').textContent = text;
  $('auth-msg').className = 'msg' + (ok ? ' ok' : '');
}

function traduzir(msg) {
  const m = String(msg || '');
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(m)) return 'Confirme seu e-mail antes de entrar (veja sua caixa de entrada).';
  if (/User already registered/i.test(m)) return 'Esse e-mail já tem conta. Tente entrar.';
  if (/Password should be at least/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/rate limit|security purposes/i.test(m)) return 'Muitas tentativas. Espere um pouco e tente de novo.';
  if (/provider is not enabled/i.test(m)) return 'Login com Google ainda não foi ativado no projeto.';
  if (/JWT|session/i.test(m) && /expired|missing/i.test(m)) return 'Sua sessão expirou. Entre de novo.';
  return m || 'Algo deu errado.';
}

// ================= App =================
async function api(path, body) {
  const { data } = await sb.auth.getSession();
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session ? data.session.access_token : ''}` },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Erro no servidor.');
  return json;
}

async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(traduzir(error.message));
  return data;
}

async function startApp() {
  if (started || recovering) return;
  started = true;
  $('auth-screen').hidden = true;
  $('app').hidden = false;

  const uid = session.user.id;
  let prof = null;
  for (let i = 0; i < 5 && !prof; i++) {
    const { data } = await sb.from('profiles').select('id, display_name, avatar_url, banner_url').eq('id', uid).maybeSingle();
    prof = data;
    if (!prof) await new Promise((r) => setTimeout(r, 400));
  }
  me = prof || { id: uid, display_name: session.user.email.split('@')[0] };
  try { chatCache = createChatCache(window.indexedDB, uid); } catch (_) { chatCache = null; }
  setProf(me);
  try {
    const { data: st } = await sb.from('user_status').select('status').eq('user_id', uid).maybeSingle();
    if (st && STATUS[st.status]) myStatus = st.status;
  } catch (_) {}
  setBeepsMuted(myStatus === 'dnd');
  renderMe();
  startPresence();
  loadBadgeDefs();
  sb.rpc('check_my_badges').then(() => {}, () => {});
  setInterval(() => {
    if (call.room && call.room.state === 'connected') {
      sb.rpc('call_heartbeat', { p_sharing: Boolean(call.room.localParticipant.isScreenShareEnabled) }).then(() => {}, () => {});
    }
  }, 60000);

  call.onChange = onCallChange;
  call.avatarUrl = (id) => (profs.get(id) || {}).avatar_url || null;
  wireStatic();
  subscribeMe();
  await loadRooms();

  const last = localStorage.getItem('resenha:last-room');
  const pick = rooms.find((r) => r.id === last) || rooms[0];
  if (pick) await openRoom(pick.id); else renderEmpty();

  // Gancho só para testes locais (não existe no site publicado)
  if (location.hostname === 'localhost') window.__resenhaTest = { onIncoming, unread };

  const invite = sessionStorage.getItem('resenha:invite');
  if (invite) { sessionStorage.removeItem('resenha:invite'); handleInvite(invite); }
  const checkoutStatus = new URLSearchParams(location.search).get('loja');
  if (checkoutStatus === 'ok') toast('Pagamento iniciado. O telão aparece após a confirmação.', 6000);
  if (checkoutStatus === 'cancelado') toast('Compra cancelada.');
  if (checkoutStatus) { const u = new URL(location.href); u.searchParams.delete('loja'); history.replaceState(null, '', u.pathname + u.search + u.hash); }
  onCallChange();
}

function setProf(p) {
  if (!p || !p.id) return;
  const old = profs.get(p.id) || {};
  const merged = { ...old, ...p };
  profs.set(p.id, merged);
  if (merged.display_name) names.set(p.id, merged.display_name);
}
function avatarOf(id, name, cls, withStatus) {
  const p = profs.get(id) || {};
  return avatar(id, name || p.display_name || names.get(id), cls, p.avatar_url, withStatus ? statusOf(id) : null);
}

function renderMe() {
  $('me-name').textContent = me.display_name;
  const a = avatarOf(me.id, me.display_name, '', true);
  a.id = 'me-avatar';
  $('me-avatar').replaceWith(a);
  document.querySelector('.me-sub').textContent = STATUS[shownStatus()].label;
}

// ---------- Status e presença ----------
// O status que eu mostro para os outros (ausente automático conta aqui)
function shownStatus() {
  if (myStatus === 'invisible') return 'invisible';
  if (myStatus === 'online' && autoIdle) return 'idle';
  return myStatus;
}
// Status de qualquer pessoa como eu enxergo
function statusOf(id) {
  if (me && id === me.id) {
    const s = shownStatus();
    return s === 'invisible' ? 'offline' : s;
  }
  const entry = presenceState[id] && presenceState[id][0];
  return entry && STATUS[entry.status] ? entry.status : 'offline';
}

function startPresence() {
  presenceChannel = sb.channel('presenca', { config: { presence: { key: me.id } } });
  presenceChannel
    .on('presence', { event: 'sync' }, () => {
      presenceState = presenceChannel.presenceState();
      renderMembers();
      renderCallList();
    })
    .subscribe((st) => { if (st === 'SUBSCRIBED') publishPresence(); });

  const activity = () => {
    lastActivity = Date.now();
    if (autoIdle) { autoIdle = false; publishPresence(); renderMe(); }
  };
  ['mousemove', 'keydown', 'mousedown', 'touchstart', 'focus'].forEach((ev) => window.addEventListener(ev, activity, { passive: true }));
  setInterval(() => {
    if (myStatus === 'online' && !autoIdle && Date.now() - lastActivity > 10 * 60 * 1000 && !(call.room && !call.muted)) {
      autoIdle = true;
      publishPresence();
      renderMe();
    }
  }, 30000);
}

async function publishPresence() {
  if (!presenceChannel) return;
  try {
    if (myStatus === 'invisible') await presenceChannel.untrack();
    else await presenceChannel.track({ status: shownStatus(), at: Date.now() });
  } catch (_) {}
}

async function setMyStatus(s) {
  myStatus = s;
  autoIdle = false;
  setBeepsMuted(s === 'dnd');
  renderMe();
  renderMembers();
  publishPresence();
  const { error } = await sb.from('user_status').upsert({ user_id: me.id, status: s, updated_at: new Date().toISOString() });
  if (error) toast('Não consegui salvar o status (rodou o SQL do perfil?).');
  else toast(`Status: ${STATUS[s].label}`);
}

function renderEmpty() {
  if (current) { textDrafts.set(current.id, $('chat-input').value || ''); switchImageDraft(current.id, null); }
  roomRevision++;
  current = null;
  $('room-banner').hidden = true;
  $('room-title').textContent = 'Nenhuma sala';
  $('messages').innerHTML = '';
  $('messages').append(h('div', { class: 'empty-chat' },
    h('h2', null, 'Você ainda não está em nenhuma sala'),
    h('p', null, 'Crie uma sala no botão + ou entre por um link de convite.')));
  $('chat-input').disabled = true;
  $('chat-input').placeholder = 'Entre numa sala pra conversar';
  $('members-panel').innerHTML = '';
  $('call-list').innerHTML = '';
  $('room-sub').textContent = '';
  setView('chat');
  renderCallCard();
}

// ---------- Salas ----------
async function loadRooms() {
  let loading = true;
  if (!rooms.length && chatCache) chatCache.readRooms().then((list) => {
    if (loading && list && list.length) { cachedRailRooms = list; renderRail(); }
  }).catch(() => {});
  const { data, error } = await sb.from('room_members')
    .select('joined_at, rooms(id, name, is_public, invite_code, owner_id, kind)')
    .eq('user_id', me.id)
    .order('joined_at', { ascending: true });
  loading = false;
  if (error) { toast('Erro ao carregar suas salas.'); return; }
  rooms = (data || []).map((r) => r.rooms).filter((r) => r && (!r.kind || r.kind === 'room'));
  cachedRailRooms = [];
  if (chatCache) chatCache.writeRooms(rooms).catch(() => {});
  await loadDms();
  renderRail();
}

// ---------- Mensagens diretas ----------
let dms = [];          // conversas diretas (1:1 e grupo)
let mode = 'rooms';    // 'rooms' ou 'dms' (o que a lateral mostra)
const isDm = (r) => Boolean(r && r.kind && r.kind !== 'room');
const findChat = (id) => rooms.find((x) => x.id === id) || dms.find((x) => x.id === id);

async function loadDms() {
  const { data, error } = await sb.rpc('my_dm_list');
  if (error) { dms = []; return; }
  dms = (data || []).map((d) => ({ id: d.room_id, kind: d.kind, name: d.name, members: d.members || [], last: d.last_content, lastKind: d.last_kind, lastUser: d.last_user, lastAt: d.last_at }));
  for (const d of dms) for (const p of d.members) setProf({ id: p.id, display_name: p.name, avatar_url: p.avatar });
  renderDmList();
}
function dmOthers(d) { return (d.members || []).filter((x) => x.id !== me.id); }
function joinNames(list) {
  if (list.length <= 1) return list[0] || '';
  return list.slice(0, -1).join(', ') + ' e ' + list[list.length - 1];
}
function dmTitle(d) {
  if (!d) return '';
  const others = dmOthers(d).map((x) => names.get(x.id) || x.name);
  if (d.kind === 'group') return d.name && d.name !== 'Grupo' ? d.name : joinNames(others.slice(0, 3)) || 'Grupo';
  return others[0] || 'Conversa';
}
function dmAvatar(d) {
  const others = dmOthers(d);
  if (d.kind === 'group') {
    const [a, b] = others;
    return h('span', { class: 'group-av', 'aria-hidden': 'true' }, a ? avatarOf(a.id, a.name) : null, b ? avatarOf(b.id, b.name) : null);
  }
  const o = others[0];
  return o ? avatarOf(o.id, o.name, '', true) : avatar(d.id, '?');
}
function shortTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function dmPreview(d) {
  if (!d.lastAt || (!d.last && !d.lastKind)) return d.kind === 'group' ? `${d.members.length} pessoas` : 'Diga oi!';
  const who = d.lastUser === me.id ? 'Você: ' : d.kind === 'group' ? (names.get(d.lastUser) || 'Alguém') + ': ' : '';
  if (d.lastKind === 'bot') return who + 'fez um sorteio';
  return who + (d.last ? plainText(d.last) : '📷 Imagem');
}
function renderDmList() {
  const box = $('dm-list');
  if (!box) return;
  const q = ($('dm-search').value || '').trim().toLowerCase();
  box.innerHTML = '';
  const list = dms.filter((d) => !q || dmTitle(d).toLowerCase().includes(q));
  if (!list.length) {
    box.append(h('p', { class: 'dm-empty' }, dms.length ? 'Ninguém com esse nome.' : 'Nenhuma conversa ainda. Clique no + pra chamar alguém das suas salas no privado.'));
  }
  for (const d of list) {
    const u = unread.get(d.id);
    const n = u ? u.n : 0;
    const b = h('button', { type: 'button', class: 'dm-item' + (current && current.id === d.id ? ' active' : '') + (n ? ' unread' : '') },
      dmAvatar(d),
      h('span', { class: 'dm-main' },
        h('span', { class: 'dm-top' }, h('span', { class: 'dm-name' }, dmTitle(d)), h('span', { class: 'dm-time' }, shortTime(d.lastAt))),
        h('span', { class: 'dm-bottom' }, h('span', { class: 'dm-preview' }, dmPreview(d)), n ? h('span', { class: 'dm-badge' }, n > 99 ? '99+' : String(n)) : null)));
    b.addEventListener('click', () => {
      if (current && current.id === d.id) setView('chat');
      else openRoom(d.id);
      if (innerWidth <= 560) $('app').classList.remove('show-side');
    });
    box.append(b);
  }
}
function setMode(m) {
  mode = m;
  const dmMode = m === 'dms';
  $('room-channels').hidden = dmMode;
  $('dm-panel').hidden = !dmMode;
  $('channels').classList.toggle('dm-mode', dmMode);
  $('invite-btn').title = dmMode ? 'Nova conversa ou grupo' : 'Convidar pessoas';
  $('invite-btn').setAttribute('aria-label', $('invite-btn').title);
  if (dmMode) { $('room-title').textContent = 'Mensagens diretas'; $('room-sub').textContent = ''; renderDmList(); }
  renderRail();
}
function showDms() {
  setMode('dms');
  if (current && isDm(current)) return;
  const last = localStorage.getItem('resenha:last-dm');
  const pick = dms.find((d) => d.id === last) || dms[0];
  if (pick) openRoom(pick.id);
  else renderEmptyDm();
}
function renderEmptyDm() {
  if (current) { textDrafts.set(current.id, $('chat-input').value || ''); switchImageDraft(current.id, null); }
  roomRevision++;
  current = null;
  $('room-banner').hidden = true;
  $('messages').innerHTML = '';
  $('messages').append(h('div', { class: 'empty-chat' },
    h('h2', null, 'Suas conversas no privado'),
    h('p', null, 'Chame alguém das suas salas pra conversar só vocês dois, ou monte um grupo.')));
  $('chat-input').disabled = true;
  $('chat-input').placeholder = 'Escolha uma conversa';
  $('members-panel').innerHTML = '';
  $('call-list').innerHTML = '';
  setView('chat');
  $('top-icon').textContent = '@';
  $('top-title').textContent = 'Mensagens diretas';
  $('top-sub').textContent = '';
  renderCallCard();
}
async function startDm(userId) {
  try {
    const id = await rpc('open_dm', { p_user: userId });
    await loadDms();
    setMode('dms');
    await openRoom(id);
  } catch (err) { toast(err.message, 4000); }
}
async function newDmModal() {
  const ids = rooms.map((r) => r.id);
  const list = h('div', { class: 'pick-list' }, h('p', { class: 'muted' }, 'Carregando…'));
  const groupName = h('input', { maxlength: '50', placeholder: 'Ex.: Pelada de quinta' });
  const nameField = field('Nome do grupo (opcional)', groupName);
  nameField.hidden = true;
  const ok = h('button', { class: 'btn primary', disabled: true }, 'Conversar');
  const picked = new Set();
  const sync = () => {
    ok.disabled = picked.size === 0;
    ok.textContent = picked.size > 1 ? `Criar grupo (${picked.size + 1})` : 'Conversar';
    nameField.hidden = picked.size < 2;
  };
  openModal({
    title: 'Nova conversa',
    body: [h('p', { class: 'hint' }, 'Escolha 1 pessoa pra conversar no privado, ou várias pra montar um grupo. Aparece quem está em alguma sala com você.'), list, nameField],
    actions: [h('button', { class: 'btn secondary', onClick: closeModal }, 'Cancelar'), ok]
  });
  const { data } = ids.length ? await sb.from('room_members').select('user_id, profiles(display_name, avatar_url)').in('room_id', ids) : { data: [] };
  const people = new Map();
  for (const x of data || []) if (x.user_id !== me.id && x.profiles) people.set(x.user_id, x.profiles);
  list.innerHTML = '';
  if (!people.size) { list.append(h('p', { class: 'muted' }, 'Ainda não tem ninguém nas suas salas. Convide a galera primeiro.')); return; }
  for (const [id, p] of [...people].sort((a, b) => a[1].display_name.localeCompare(b[1].display_name))) {
    setProf({ id, display_name: p.display_name, avatar_url: p.avatar_url });
    const cb = h('input', { type: 'checkbox' });
    cb.addEventListener('change', () => { if (cb.checked) picked.add(id); else picked.delete(id); if (picked.size > 9) { cb.checked = false; picked.delete(id); toast('Um grupo tem no máximo 10 pessoas.'); } sync(); });
    list.append(h('label', { class: 'pick-item' }, cb, avatarOf(id, p.display_name, '', true), h('span', { class: 'grow' }, p.display_name)));
  }
  ok.addEventListener('click', async () => {
    ok.disabled = true;
    try {
      const sel = [...picked];
      const id = sel.length === 1 ? await rpc('open_dm', { p_user: sel[0] }) : await rpc('create_group_dm', { p_users: sel, p_name: groupName.value.trim() || null });
      closeModal();
      await loadDms();
      setMode('dms');
      await openRoom(id);
    } catch (err) { toast(err.message, 4000); ok.disabled = false; }
  });
}
// Atualiza a prévia da conversa quando chega mensagem
function bumpDm(m) {
  const d = dms.find((x) => x.id === m.room_id);
  if (!d) return false;
  d.last = m.content; d.lastKind = m.kind; d.lastUser = m.user_id; d.lastAt = m.created_at;
  dms.sort((a, b) => new Date(b.lastAt || 0) - new Date(a.lastAt || 0));
  renderDmList();
  return true;
}

// ---------- Loja: telão em modo de teste ----------
let bannerTimer = null;
async function loadRoomBanner(id) {
  clearTimeout(bannerTimer);
  if (!current || current.id !== id || isDm(current)) return;
  const revision = roomRevision;
  const { data, error } = await sb.from('purchases').select('buyer_id,extra,expires_at')
    .eq('room_id', id).eq('item_id', 'telao').eq('status', 'paid')
    .gt('expires_at', new Date().toISOString()).order('paid_at', { ascending: false }).limit(1).maybeSingle();
  if (!current || current.id !== id || roomRevision !== revision) return;
  const banner = $('room-banner');
  if (error || !data) { banner.hidden = true; return; }
  await ensureNames([data.buyer_id]);
  if (!current || current.id !== id || roomRevision !== revision) return;
  banner.replaceChildren(document.createTextNode(String(data.extra?.text || '')), h('small', null, `Telão de ${names.get(data.buyer_id) || 'alguém'}`));
  banner.hidden = false;
  bannerTimer = setTimeout(() => loadRoomBanner(id), Math.max(1000, new Date(data.expires_at).getTime() - Date.now() + 1000));
}

async function openShop() {
  if (!rooms.length) { toast('Entre em uma sala para usar a loja.'); return; }
  const { data: item, error } = await sb.from('shop_items').select('name,price_cents').eq('id', 'telao').maybeSingle();
  if (error || !item) { toast('A loja está indisponível agora.'); return; }
  const select = h('select', null, rooms.map((r) => h('option', { value: r.id }, r.name)));
  if (current && !isDm(current)) select.value = current.id;
  const message = h('input', { maxlength: '40', placeholder: 'Sua mensagem para a sala' });
  const buy = h('button', { class: 'btn primary' }, 'Ir para o pagamento');
  const price = (item.price_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  openModal({ title: 'Telão da sala', body: [h('p', { class: 'muted' }, `Sua mensagem aparece no topo do chat por 24 horas. ${price}. Modo de teste.`), field('Sala', select), field('Mensagem (até 40 caracteres)', message)], actions: [h('button', { class: 'btn secondary', onClick: closeModal }, 'Cancelar'), buy] });
  buy.addEventListener('click', async () => {
    buy.disabled = true;
    try {
      const { url } = await api('/api/checkout', { roomId: select.value, text: message.value });
      location.assign(url);
    } catch (err) { toast(err.message, 4000); buy.disabled = false; }
  });
}

function renderRail() {
  const dmBtn = $('dm-btn');
  dmBtn.classList.toggle('active', mode === 'dms');
  let dmUnread = 0;
  for (const d of dms) { const u = unread.get(d.id); if (u) dmUnread += u.n; }
  $('dm-count').hidden = !dmUnread;
  $('dm-count').textContent = dmUnread > 99 ? '99+' : String(dmUnread);
  const box = $('rail-rooms');
  box.innerHTML = '';
  const railRooms = rooms.length ? rooms : cachedRailRooms;
  for (const r of railRooms) {
    const b = h('button', {
      class: 'rail-room' + (mode === 'rooms' && current && current.id === r.id ? ' active' : ''),
      title: r.name, 'aria-label': r.name, disabled: !rooms.length, style: { background: current && current.id === r.id ? '' : undefined }
    }, r.name.trim().charAt(0).toUpperCase());
    if (call.room && call.roomId === r.id) b.append(h('span', { class: 'live-dot', title: 'Você está na call desta sala' }));
    const u = unread.get(r.id);
    if (u && u.n) b.classList.add('has-unread');
    if (u && u.mentions) b.append(h('span', { class: 'mention-count', title: `${u.mentions} ${u.mentions === 1 ? 'menção' : 'menções'}` }, u.mentions > 99 ? '99+' : String(u.mentions)));
    b.addEventListener('click', () => {
      if (innerWidth <= 560 && current && current.id === r.id) { $('app').classList.toggle('show-side'); return; }
      openRoom(r.id);
      if (innerWidth <= 560) $('app').classList.add('show-side');
    });
    box.append(b);
  }
}

async function openRoom(id) {
  const r = findChat(id);
  if (!r) return;
  const revision = ++roomRevision;
  if (!current || current.id !== id) {
    const input = $('chat-input');
    if (current) {
      textDrafts.set(current.id, input.value || '');
      members = []; roles = []; callPreview = []; oldestId = null; lastMsg = null;
      $('members-panel').replaceChildren();
      $('messages').replaceChildren(h('div', { class: 'empty-chat' }, 'Carregando mensagens…'));
    }
    input.value = textDrafts.get(id) || '';
    switchImageDraft(current && current.id, id);
  }
  current = r;
  pinnedIds.clear();
  $('room-banner').hidden = true;
  clearReply();
  for (const t of typing.values()) clearTimeout(t.t);
  typing.clear();
  renderTyping();
  const dm = isDm(r);
  if ((mode === 'dms') !== dm) setMode(dm ? 'dms' : 'rooms');
  localStorage.setItem(dm ? 'resenha:last-dm' : 'resenha:last-room', id);
  if (!dm) $('room-title').textContent = r.name;
  $('chat-input').disabled = false;
  $('chat-input').placeholder = dm ? `Mensagem para ${dmTitle(r)}` : `Conversar em #chat`;
  renderRail();
  renderDmList();
  setView(call.room && call.roomId === id ? 'call' : 'chat');
  await Promise.all([loadMembers(), loadMessages(true)]);
  if (!current || current.id !== id || roomRevision !== revision) return;
  subscribeRoom(id);
  loadPins(id);
  if (cfg.shopReady) loadRoomBanner(id);
  startPreviewPolling();
  onCallChange();
}

async function loadMembers() {
  if (!current) return;
  const id = current.id;
  const revision = roomRevision;
  const [m, rl] = await Promise.all([
    sb.from('room_members').select('user_id, base_role, role_id, joined_at, profiles(display_name, avatar_url, banner_url)').eq('room_id', id),
    sb.from('room_roles').select('*').eq('room_id', id).order('created_at')
  ]);
  if (!current || current.id !== id || roomRevision !== revision) return;
  members = (m.data || []).map((x) => ({ ...x, name: x.profiles ? x.profiles.display_name : 'Alguém' }));
  roles = rl.data || [];
  for (const x of members) setProf({ id: x.user_id, ...(x.profiles || {}) });
  const mine = members.find((x) => x.user_id === me.id);
  if (mine && mine.name !== me.display_name) { me.display_name = mine.name; renderMe(); }
  renderMembers();
}

function myMember() { return members.find((x) => x.user_id === me.id); }
function roleOf(m) { return m && m.role_id ? roles.find((r) => r.id === m.role_id) : null; }
function can(perm) {
  const m = myMember();
  if (!m) return false;
  if (m.base_role === 'owner' || m.base_role === 'moderator') return true;
  const r = roleOf(m);
  if (!r) return false;
  return { kick: r.can_kick, ban: r.can_ban, manage_roles: r.can_manage_roles, delete_messages: r.can_delete_messages }[perm] || false;
}
function canActOn(target, perm) {
  const mine = myMember();
  if (!mine || !target || target.user_id === me.id || !can(perm)) return false;
  if (target.base_role === 'owner') return false;
  return RANK[mine.base_role] > RANK[target.base_role] || target.base_role === 'member';
}
function nameColor(m) { const r = roleOf(m); return r ? r.color : null; }

function renderMembers() {
  const panel = $('members-panel');
  panel.innerHTML = '';
  if (!members.length) { $('room-sub').textContent = ''; return; }
  const groups = [];
  const online = members.filter((m) => statusOf(m.user_id) !== 'offline');
  const offline = members.filter((m) => statusOf(m.user_id) === 'offline');
  const sub = $('room-sub');
  sub.innerHTML = '';
  if (!isDm(current)) sub.append(h('span', { class: 'dot', 'aria-hidden': 'true' }), `${online.length} online · ${members.length} ${members.length === 1 ? 'membro' : 'membros'}`);
  else $('top-sub').textContent = current.kind === 'group' ? `${members.length} pessoas` : (STATUS[statusOf((dmOthers(current)[0] || {}).id)] || STATUS.offline).label;
  const owner = online.filter((m) => m.base_role === 'owner');
  const mods = online.filter((m) => m.base_role === 'moderator');
  groups.push(['Dono', owner], ['Moderadores', mods]);
  const rest = online.filter((m) => m.base_role === 'member');
  for (const r of roles) groups.push([r.name, rest.filter((m) => m.role_id === r.id)]);
  groups.push(['Online', rest.filter((m) => !m.role_id || !roles.some((r) => r.id === m.role_id))]);
  groups.push(['Offline', offline]);
  for (const [title, list] of groups) {
    if (!list.length) continue;
    panel.append(h('div', { class: 'mem-group' }, `${title} — ${list.length}`));
    for (const m of list.sort((a, b) => a.name.localeCompare(b.name))) {
      const st = statusOf(m.user_id);
      const b = h('button', { class: 'mem' + (st === 'offline' ? ' offline' : '') },
        avatarOf(m.user_id, m.name, '', true),
        h('span', { class: 'name', style: { color: nameColor(m) || '' } }, m.name),
        m.base_role === 'owner' ? h('span', { class: 'crown', html: ICON.crown, title: 'Dono' }) : null,
        m.base_role === 'moderator' ? h('span', { class: 'crown', html: ICON.shield, title: 'Moderador', style: { color: 'var(--accent)' } }) : null);
      b.addEventListener('click', () => memberMenu(b, m.user_id));
      panel.append(b);
    }
  }
}

function memberMenu(anchor, userId) {
  const m = members.find((x) => x.user_id === userId);
  const name = m ? m.name : names.get(userId) || 'Alguém';
  const items = [{ node: profileCard(userId, name, m) }];
  if (userId !== me.id && !(isDm(current) && current.kind === 'dm')) {
    items.push({ label: 'Mandar mensagem', onClick: () => startDm(userId) });
  }

  const inCall = call.room && call.room.remoteParticipants.get(userId);
  if (inCall) {
    const val = Math.round(getVolume(userId) * 100);
    const label = h('span', null, `Volume: ${val}%`);
    const range = h('input', { type: 'range', min: '0', max: '200', step: '5', value: String(val), 'aria-label': `Volume de ${name}` });
    range.addEventListener('input', () => { label.textContent = `Volume: ${range.value}%`; setVolume(userId, Number(range.value) / 100); });
    items.push('sep', { node: h('div', { class: 'menu-range' }, label, range) });
  }

  if (m && current) {
    const mod = [];
    if (canActOn(m, 'manage_roles')) {
      mod.push({ title: 'Cargo' });
      for (const r of roles) {
        mod.push({ label: (m.role_id === r.id ? '✓ ' : '') + r.name, swatch: r.color, onClick: () => doRpc('assign_role', { p_room: current.id, p_user: userId, p_role: r.id }, 'Cargo atualizado.') });
      }
      if (m.role_id) mod.push({ label: 'Remover cargo', onClick: () => doRpc('assign_role', { p_room: current.id, p_user: userId, p_role: null }, 'Cargo removido.') });
      if (!roles.length) mod.push({ label: 'Criar cargos…', onClick: rolesModal });
    }
    const mine = myMember();
    if (mine && mine.base_role === 'owner' && userId !== me.id && !isDm(current)) {
      mod.push('sep');
      if (m.base_role === 'member') mod.push({ label: 'Tornar moderador', onClick: () => doRpc('set_moderator', { p_room: current.id, p_user: userId, p_value: true }, `${name} agora é moderador.`) });
      if (m.base_role === 'moderator') mod.push({ label: 'Remover moderador', onClick: () => doRpc('set_moderator', { p_room: current.id, p_user: userId, p_value: false }, 'Moderador removido.') });
      mod.push({ label: 'Passar a posse da sala', onClick: async () => {
        if (await confirmModal({ title: 'Passar a posse', text: `${name} vira dono da sala e você vira moderador. Continuar?`, confirm: 'Passar posse', danger: true })) {
          doRpc('transfer_ownership', { p_room: current.id, p_user: userId }, 'Posse transferida.');
        }
      } });
    }
    if (canActOn(m, 'kick') || canActOn(m, 'ban')) mod.push('sep');
    if (canActOn(m, 'kick')) mod.push({ label: `Expulsar ${name}`, danger: true, onClick: () => moderate(userId, name, 'kick') });
    if (canActOn(m, 'ban')) mod.push({ label: `Banir ${name}`, danger: true, onClick: () => moderate(userId, name, 'ban') });
    if (mod.length) items.push('sep', ...mod);
  }
  openMenu(anchor, items, { side: anchor.closest('.members-panel') ? undefined : 'right' });
}

async function doRpc(name, args, okMsg) {
  try {
    await rpc(name, args);
    if (okMsg) toast(okMsg);
    await loadMembers();
    if (name === 'transfer_ownership') await loadRooms();
  } catch (err) { toast(err.message); }
}

function moderate(userId, name, action) {
  if (action === 'kick') {
    confirmModal({ title: `Expulsar ${name}?`, text: 'A pessoa sai da sala e da call, mas pode voltar se tiver o convite.', confirm: 'Expulsar', danger: true })
      .then((ok) => ok && runModerate(userId, action));
    return;
  }
  const reason = h('input', { maxlength: '200', placeholder: 'Opcional' });
  const ok = h('button', { class: 'btn danger' }, 'Banir');
  const cancel = h('button', { class: 'btn secondary', onClick: closeModal }, 'Cancelar');
  openModal({ title: `Banir ${name}?`, body: [h('p', { class: 'muted', style: { margin: 0 } }, 'A pessoa sai da sala e não consegue voltar, nem com convite.'), field('Motivo', reason)], actions: [cancel, ok] });
  ok.addEventListener('click', () => { closeModal(); runModerate(userId, action, reason.value.trim()); });
}

async function runModerate(userId, action, reason) {
  try {
    await api('/api/moderate', { roomId: current.id, userId, action, reason });
    toast(action === 'kick' ? 'Pessoa expulsa.' : 'Pessoa banida.');
    await loadMembers();
  } catch (err) { toast(err.message); }
}

// ---------- Tempo real ----------
function subscribeRoom(id) {
  if (roomChannel) sb.removeChannel(roomChannel);
  roomChannel = sb.channel('sala-' + id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${id}` }, () => loadMembers())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_roles', filter: `room_id=eq.${id}` }, () => loadMembers())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_pins', filter: `room_id=eq.${id}` }, () => {
      if (current && current.id === id) { loadPins(id); if (pinsModal && pinsModal.isConnected) refreshPinsModal(id); }
    })
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (current && current.id === id && members.some((m) => m.user_id === (payload && payload.id))) onTyping(payload);
    });
  if (cfg.shopReady) roomChannel.on('postgres_changes', { event: '*', schema: 'public', table: 'purchases', filter: `room_id=eq.${id}` }, () => loadRoomBanner(id));
  roomChannel.subscribe();
}

function subscribeMe() {
  meChannel = sb.channel('eu-' + me.id)
    // Mensagens de TODAS as minhas salas (o banco só entrega as das salas em que sou membro)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => onIncoming(p.new))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (p) => {
      if (chatCache && p.old && p.old.id != null) chatCache.removeMessage(p.old.id).catch(() => {});
      const el = p.old && document.querySelector(`[data-mid="${p.old.id}"]`);
      if (el) el.remove();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' }, async (p) => {
      if (!p.new || !msgById.has(p.new.message_id)) return;
      await ensureNames([p.new.user_id]);
      addReaction(p.new);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' }, (p) => {
      if (p.old && p.old.message_id && msgById.has(p.old.message_id)) removeReaction(p.old);
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_badges', filter: `user_id=eq.${me.id}` }, (p) => onBadgeEarned(p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (p) => {
      if (!p.new || !p.new.id) return;
      setProf(p.new);
      if (p.new.id === me.id) { Object.assign(me, p.new); renderMe(); }
      const mem = members.find((x) => x.user_id === p.new.id);
      if (mem) { mem.name = p.new.display_name; renderMembers(); }
      renderCallList();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_members', filter: `user_id=eq.${me.id}` }, () => loadRooms())
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'room_members' }, async (p) => {
      const o = p.old || {};
      if (current && o.room_id === current.id && o.user_id !== me.id) { loadMembers(); return; }
      if (o.user_id !== me.id) return;
      const r = findChat(o.room_id);
      if (!r) return;
      if (call.roomId === r.id) leaveCall();
      if (!isDm(r)) toast(`Você saiu ou foi removido da sala ${r.name}.`, 4000);
      await loadRooms();
      if (current && current.id === r.id) {
        if (isDm(r)) { if (dms[0]) openRoom(dms[0].id); else renderEmptyDm(); }
        else if (rooms[0]) openRoom(rooms[0].id); else renderEmpty();
      }
    })
    .subscribe();
}

// ---------- Notificações e não lidas ----------
const unread = new Map(); // roomId -> { n, mentions }
const NOTIF_KEY = 'resenha:notificacoes';
function notifPrefs() {
  const def = { desktop: false, mode: 'mentions', sound: true };
  try { return { ...def, ...JSON.parse(localStorage.getItem(NOTIF_KEY) || '{}') }; } catch (_) { return def; }
}
function saveNotifPrefs(p) { localStorage.setItem(NOTIF_KEY, JSON.stringify(p)); }

function seeingRoom(roomId) {
  return current && current.id === roomId && view === 'chat' && document.visibilityState === 'visible' && document.hasFocus();
}
function addUnread(roomId, mention) {
  const u = unread.get(roomId) || { n: 0, mentions: 0 };
  u.n += 1;
  if (mention) u.mentions += 1;
  unread.set(roomId, u);
  renderUnread();
}
function clearUnread(roomId) {
  if (!roomId || !unread.has(roomId)) return;
  unread.delete(roomId);
  renderUnread();
}
function renderUnread() {
  let mentions = 0, any = false;
  for (const [id, u] of unread) {
    if (!findChat(id)) { unread.delete(id); continue; }
    mentions += u.mentions;
    any = any || u.n > 0;
  }
  document.title = (mentions ? `(${mentions}) ` : any ? '• ' : '') + 'Resenha';
  renderRail();
  const u = current && unread.get(current.id);
  $('ch-chat').classList.toggle('unread', Boolean(u && u.n));
}

async function onIncoming(m) {
  if (!m) return;
  if (chatCache) chatCache.append(m.room_id, m).catch(() => {});
  if (!findChat(m.room_id)) {
    // Pode ser uma conversa nova que alguém abriu comigo
    await loadDms();
    if (!findChat(m.room_id)) return;
  }
  stopTyping(m.user_id);
  bumpDm(m);
  if (current && current.id === m.room_id) appendMessage(m, true);
  if (m.user_id === me.id) return;
  const mention = mentionsMe(m.content) || isDm(findChat(m.room_id));
  const seeing = seeingRoom(m.room_id);
  if (!seeing) addUnread(m.room_id, mention);
  await ensureNames([m.user_id]);
  notifyMessage(m, mention, seeing);
}

function notifyMessage(m, mention, seeing) {
  if (myStatus === 'dnd') return;
  const prefs = notifPrefs();
  if (prefs.mode === 'none' || (prefs.mode === 'mentions' && !mention)) return;
  if (seeing && !mention) return;
  if (prefs.sound) { if (mention) beep(880, 1320); else beep(620, 720); }
  if (!seeing && prefs.desktop && 'Notification' in window && Notification.permission === 'granted' && (document.hidden || !document.hasFocus())) {
    const chat = findChat(m.room_id);
    const room = chat && isDm(chat) ? (chat.kind === 'group' ? { name: dmTitle(chat) } : { name: 'mensagem direta' }) : chat;
    const who = names.get(m.user_id) || 'Alguém';
    const body = m.content ? plainText(m.content).slice(0, 140) : '📷 Imagem';
    try {
      const n = new Notification(mention ? `${who} te marcou em ${room ? room.name : 'uma sala'}` : `${who} em ${room ? room.name : 'uma sala'}`, {
        body, tag: 'resenha-' + m.room_id, icon: (profs.get(m.user_id) || {}).avatar_url || '/icons/icon-192.png'
      });
      n.onclick = () => { window.focus(); openRoom(m.room_id).then(() => setView('chat')); n.close(); };
    } catch (_) {}
  }
}

window.addEventListener('focus', () => { if (current && view === 'chat') clearUnread(current.id); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && current && view === 'chat' && document.hasFocus()) clearUnread(current.id); });

// ---------- Menções ----------
const MENTION_RE = /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi;
function mentionsMe(content) { return Boolean(content) && content.toLowerCase().includes(`<@${me.id}>`); }
function plainText(content) {
  return String(content || '').replace(MENTION_RE, (_, id) => '@' + (names.get(id.toLowerCase()) || 'alguém'));
}
function escapeRe(t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// Troca "@Nome" (de quem é membro da sala) pelo código <@id> antes de salvar
function encodeMentions(text) {
  const list = [...members].sort((a, b) => b.name.length - a.name.length);
  let out = text;
  for (const m of list) {
    const re = new RegExp('@' + escapeRe(m.name) + '(?=$|[\\s.,!?;:)\\]])', 'g');
    out = out.replace(re, `<@${m.user_id}>`);
  }
  return out;
}
function renderContent(container, content) {
  const parts = String(content || '').split(MENTION_RE);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const id = part.toLowerCase();
      const chip = h('button', { type: 'button', class: 'mention' + (id === me.id ? ' mention-self' : '') }, '@' + (names.get(id) || 'alguém'));
      chip.addEventListener('click', () => memberMenu(chip, id));
      container.append(chip);
    } else if (part) {
      linkify(container, part);
    }
  });
}

let mentionState = null; // { start, query, items, index }
function updateMentionPopup() {
  const input = $('chat-input');
  const pop = $('mention-pop');
  const before = input.value.slice(0, input.selectionStart);
  // Comandos do bot: texto começando com / e ainda sem espaço
  const cm = input.value.match(/^\/(\S*)$/);
  if (cm) {
    const q = cm[1].toLowerCase();
    const items = COMMANDS.filter((c) => c.cmd.slice(1).startsWith(q));
    if (!items.length) { closeMentionPopup(); return; }
    mentionState = { cmd: true, items, index: 0 };
    renderMentionPopup();
    pop.hidden = false;
    return;
  }
  const m = before.match(/(^|\s)@([^\s@]{0,24})$/);
  if (!m || !members.length) { closeMentionPopup(); return; }
  const query = m[2].toLowerCase();
  const items = members
    .filter((x) => x.user_id !== me.id && x.name.toLowerCase().includes(query))
    .sort((a, b) => (a.name.toLowerCase().startsWith(query) ? 0 : 1) - (b.name.toLowerCase().startsWith(query) ? 0 : 1) || a.name.localeCompare(b.name))
    .slice(0, 8);
  if (!items.length) { closeMentionPopup(); return; }
  mentionState = { start: before.length - m[2].length - 1, items, index: 0 };
  renderMentionPopup();
  pop.hidden = false;
}
function renderMentionPopup() {
  const pop = $('mention-pop');
  pop.innerHTML = '';
  if (mentionState.cmd) {
    pop.append(h('div', { class: 'mention-head' }, 'Comandos do Sorteador'));
    mentionState.items.forEach((c, i) => {
      const b = h('button', { type: 'button', class: 'mention-item cmd-item' + (i === mentionState.index ? ' active' : ''), role: 'option', 'aria-selected': String(i === mentionState.index) },
        h('span', { class: 'cmd-name' }, c.cmd), h('span', { class: 'cmd-desc' }, c.desc), h('span', { class: 'cmd-ex' }, c.example));
      b.addEventListener('mousedown', (e) => { e.preventDefault(); pickMention(i); });
      pop.append(b);
    });
    return;
  }
  pop.append(h('div', { class: 'mention-head' }, 'Membros'));
  mentionState.items.forEach((x, i) => {
    const b = h('button', { type: 'button', class: 'mention-item' + (i === mentionState.index ? ' active' : ''), role: 'option', 'aria-selected': String(i === mentionState.index) },
      avatarOf(x.user_id, x.name, 'sm', true), h('span', { style: { color: nameColor(x) || '' } }, x.name));
    b.addEventListener('mousedown', (e) => { e.preventDefault(); pickMention(i); });
    pop.append(b);
  });
}
function closeMentionPopup() { mentionState = null; $('mention-pop').hidden = true; }
function pickMention(i) {
  const input = $('chat-input');
  if (mentionState.cmd) {
    const c = mentionState.items[i];
    input.value = c.cmd + ' ';
    input.setSelectionRange(input.value.length, input.value.length);
    closeMentionPopup();
    input.focus();
    return;
  }
  const x = mentionState.items[i];
  const caret = input.selectionStart;
  const text = input.value;
  const insert = '@' + x.name + ' ';
  input.value = text.slice(0, mentionState.start) + insert + text.slice(caret);
  const pos = mentionState.start + insert.length;
  input.setSelectionRange(pos, pos);
  closeMentionPopup();
  input.dispatchEvent(new Event('input'));
  input.focus();
}

// ---------- Imagens no chat (bucket privado, links assinados) ----------
const signed = new Map(); // caminho -> { url, exp }
async function signedUrls(paths) {
  const now = Date.now();
  const need = [...new Set(paths)].filter((p) => !signed.has(p) || signed.get(p).exp < now + 60000);
  if (need.length) {
    const { data } = await sb.storage.from('chat').createSignedUrls(need, 3600);
    for (const d of data || []) if (d.signedUrl && d.path) signed.set(d.path, { url: d.signedUrl, exp: now + 3600 * 1000 });
  }
  return paths.map((p) => (signed.get(p) || {}).url || null);
}
async function hydrateImages(root) {
  const imgs = [...root.querySelectorAll('img.msg-img[data-path]:not([src])')];
  if (!imgs.length) return;
  const urls = await signedUrls(imgs.map((i) => i.dataset.path));
  const box = $('messages');
  imgs.forEach((img, i) => {
    if (!urls[i]) { img.replaceWith(h('div', { class: 'msg-img-missing' }, 'Imagem indisponível')); return; }
    img.addEventListener('load', () => {
      if (box.scrollHeight - box.scrollTop - box.clientHeight < 400) box.scrollTop = box.scrollHeight;
    }, { once: true });
    img.src = urls[i];
  });
}
function openLightbox(src) {
  const img = h('img', { src, alt: 'Imagem enviada no chat', class: 'lightbox-img' });
  openModal({ title: 'Imagem', wide: true, body: [img, h('a', { href: src, target: '_blank', rel: 'noopener noreferrer', class: 'link' }, 'Abrir original em outra aba')] });
}

// ---------- Bot Sorteador ----------
// Quem entra por padrão: quem está na call desta sala; senão quem está online; senão todo mundo
function defaultDrawPeople() {
  if (!current) return [];
  if (call.room && call.roomId === current.id) {
    const inCall = participants().map((x) => x.identity).filter((id) => members.some((m) => m.user_id === id));
    if (inCall.length >= 2) return inCall;
  }
  const online = members.filter((m) => statusOf(m.user_id) !== 'offline').map((m) => m.user_id);
  return online.length >= 2 ? online : members.map((m) => m.user_id);
}

async function runDraw(req) {
  if (!current) return;
  try {
    const id = await rpc('bot_draw', {
      p_room: current.id,
      p_kind: req.kind,
      p_people: req.people || [],
      p_items: req.items || [],
      p_count: req.count || 1,
      p_min: req.min ?? 1,
      p_max: req.max ?? 6,
      p_title: req.title || null
    });
    const { data } = await sb.from('messages').select(MSG_FIELDS).eq('id', id).single();
    if (data) appendMessage(data, true);
  } catch (err) {
    toast(/bot_draw|function/i.test(err.message) ? 'O Sorteador ainda não foi ativado (rode o SQL da v2.4).' : err.message, 4500);
  }
}

function openDrawModal(kind, count) {
  if (!current) return;
  const tabs = [['teams', 'Times'], ['people', 'Pessoas'], ['items', 'Lista'], ['order', 'Ordem'], ['quick', 'Rápidos']];
  let active = kind || 'teams';
  const selected = new Set(defaultDrawPeople());
  const title = h('input', { maxlength: '60', placeholder: 'Ex.: Quem paga a pizza?' });
  const guests = h('input', { maxlength: '400', placeholder: 'Nomes de quem não tem conta, separados por vírgula' });
  const listArea = h('textarea', { rows: '5', maxlength: '2000', placeholder: 'Uma opção por linha (ou separadas por vírgula)' });
  const countSel = h('select');
  const body = h('div', { class: 'draw-modal' });
  const tabRow = h('div', { class: 'draw-tabs', role: 'tablist' });
  const submit = h('button', { class: 'btn primary' }, 'Sortear');

  const peopleBox = () => {
    const list = h('div', { class: 'draw-people' });
    const paint = () => {
      list.innerHTML = '';
      for (const m of [...members].sort((a, b) => a.name.localeCompare(b.name))) {
        const cb = h('input', { type: 'checkbox', checked: selected.has(m.user_id) });
        cb.addEventListener('change', () => { if (cb.checked) selected.add(m.user_id); else selected.delete(m.user_id); });
        list.append(h('label', { class: 'draw-person' }, cb, avatarOf(m.user_id, m.name, 'sm', true), h('span', { style: { color: nameColor(m) || '' } }, m.name)));
      }
    };
    paint();
    const quick = (label, fn) => h('button', { type: 'button', class: 'btn secondary small', onClick: () => { selected.clear(); fn().forEach((id) => selected.add(id)); paint(); } }, label);
    return h('div', { class: 'field' },
      h('span', { class: 'label' }, 'Quem participa'),
      h('div', { class: 'draw-quick' },
        call.room && call.roomId === current.id ? quick('Quem está na call', () => participants().map((x) => x.identity)) : null,
        quick('Online', () => members.filter((m) => statusOf(m.user_id) !== 'offline').map((m) => m.user_id)),
        quick('Todos', () => members.map((m) => m.user_id)),
        quick('Ninguém', () => [])),
      list,
      field('Mais alguém de fora?', guests));
  };
  const setCount = (min, max, def, label) => {
    countSel.innerHTML = '';
    for (let i = min; i <= max; i++) countSel.append(h('option', { value: String(i) }, `${i} ${label(i)}`));
    countSel.value = String(Math.min(max, Math.max(min, def)));
  };

  const render = () => {
    tabRow.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.k === active));
    body.innerHTML = '';
    submit.hidden = active === 'quick';
    if (active === 'quick') {
      const q = (label, req) => h('button', { type: 'button', class: 'btn secondary', onClick: () => { closeModal(); runDraw(req); } }, label);
      body.append(h('div', { class: 'draw-quick-grid' },
        q('🪙 Cara ou coroa', { kind: 'coin', count: 1 }),
        q('🎲 Dado de 6 lados', { kind: 'dice', count: 1, max: 6 }),
        q('🎲🎲 Dois dados', { kind: 'dice', count: 2, max: 6 }),
        q('🎲 Dado de 20 lados', { kind: 'dice', count: 1, max: 20 }),
        q('🔢 Número de 1 a 10', { kind: 'number', min: 1, max: 10 }),
        q('🔢 Número de 1 a 100', { kind: 'number', min: 1, max: 100 })),
        h('p', { class: 'hint' }, 'Dica: no chat, dá para digitar /dado 3d8, /moeda 3 ou /numero 5 50.'));
      return;
    }
    body.append(field('Título (opcional)', title));
    if (active === 'teams') { setCount(2, 8, count || 2, (i) => 'times'); body.append(field('Quantos times', countSel), peopleBox()); }
    if (active === 'people') { setCount(1, 10, count || 1, (i) => (i === 1 ? 'pessoa' : 'pessoas')); body.append(field('Quantas pessoas sortear', countSel), peopleBox()); }
    if (active === 'order') body.append(peopleBox());
    if (active === 'items') { setCount(1, 10, count || 1, (i) => (i === 1 ? 'opção' : 'opções')); body.append(field('Opções', listArea), field('Quantas escolher', countSel)); }
  };
  for (const [k, label] of tabs) {
    const b = h('button', { type: 'button', class: 'draw-tab', 'data-k': k, role: 'tab' }, label);
    b.addEventListener('click', () => { active = k; render(); });
    tabRow.append(b);
  }
  openModal({ title: 'Sorteador', wide: true, body: [tabRow, body], actions: [h('button', { class: 'btn secondary', onClick: closeModal }, 'Cancelar'), submit] });
  render();

  submit.addEventListener('click', () => {
    const guestList = guests.value.split(',').map((s) => s.trim()).filter(Boolean);
    const req = { kind: active, title: title.value.trim() || null, count: parseInt(countSel.value, 10) || 1 };
    if (active === 'items') {
      req.items = listArea.value.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
      if (req.items.length < 2) { toast('Coloque pelo menos 2 opções.'); return; }
    } else {
      req.people = [...selected];
      req.items = guestList;
      if (req.people.length + guestList.length < 2) { toast('Escolha pelo menos 2 pessoas.'); return; }
    }
    closeModal();
    runDraw(req);
  });
}

// ---------- Chat ----------
const MSG_FIELDS = 'id, room_id, user_id, content, created_at, attachment_path, attachment_type, kind, payload, reply_to';
async function renderCachedMessages(list, id, isFresh) {
  if (!list.length || isFresh() || !current || current.id !== id) return;
  const box = $('messages');
  box.innerHTML = '';
  box.append(h('div', { class: 'cache-notice' }, 'Histórico do dispositivo · atualizando…'));
  let prev = null;
  for (const m of list) { box.append(messageEl(m, prev)); prev = m; }
  lastMsg = list[list.length - 1] || null;
  box.scrollTop = box.scrollHeight;
  hydrateImages(box);
}
async function loadMessages(reset, throughId = null) {
  if (!current) return;
  const id = current.id;
  const revision = roomRevision;
  let fresh = false;
  if (reset && !throughId && chatCache) chatCache.read(id).then((list) => {
    if (list) return renderCachedMessages(list, id, () => fresh || roomRevision !== revision);
  }).catch(() => {});
  let q = sb.from('messages').select(MSG_FIELDS).eq('room_id', id).order('id', { ascending: false }).limit(50);
  if (reset && throughId) q = q.lte('id', throughId);
  if (!reset && oldestId) q = q.lt('id', oldestId);
  const { data, error } = await q;
  if (error || !current || current.id !== id || roomRevision !== revision) return;
  fresh = true;
  const list = (data || []).reverse();
  if (reset && !throughId && chatCache) chatCache.write(id, list).catch(() => {});
  const mentioned = [];
  for (const m of list) for (const x of String(m.content || '').matchAll(MENTION_RE)) mentioned.push(x[1].toLowerCase());
  await ensureNames([...list.map((m) => m.user_id), ...mentioned]);
  if (!current || current.id !== id || roomRevision !== revision) return;
  const box = $('messages');
  if (reset) {
    box.innerHTML = '';
    lastMsg = null;
    oldestId = null;
  }
  const prevHeight = box.scrollHeight;
  const frag = document.createDocumentFragment();
  let prev = null;
  for (const m of list) { frag.append(messageEl(m, prev)); prev = m; }
  const oldMore = box.querySelector('.load-more, .empty-chat');
  if (oldMore) oldMore.remove();
  box.prepend(frag);
  if (reset && throughId) {
    const recent = h('button', { class: 'btn secondary' }, 'Voltar para as mensagens recentes');
    recent.addEventListener('click', () => loadMessages(true));
    box.append(recent);
  }
  if (list.length === 50) {
    const more = h('button', { class: 'btn secondary load-more' }, 'Carregar mensagens antigas');
    more.addEventListener('click', () => loadMessages(false));
    box.prepend(more);
  } else if (reset || !list.length) {
    if (isDm(current)) {
      const title = dmTitle(current);
      box.prepend(h('div', { class: 'dm-hero' }, dmAvatar(current), h('h2', null, title),
        h('p', null, current.kind === 'group' ? 'Começo do grupo. Só quem está nele vê essas mensagens.' : `Começo da conversa com ${title}. Só vocês dois veem isso.`)));
    } else {
      box.prepend(h('div', { class: 'empty-chat' }, h('h2', null, `Bem-vindo a ${current.name}!`), h('p', null, 'Este é o começo do chat da sala.')));
    }
  }
  if (list.length) oldestId = list[0].id;
  if (reset) { lastMsg = list[list.length - 1] || null; box.scrollTop = box.scrollHeight; }
  else box.scrollTop = box.scrollHeight - prevHeight;
  hydrateImages(box);
  loadReactions(list.map((m) => m.id));
}

function openMessageSearch() {
  if (!current) return;
  const roomId = current.id;
  const input = h('input', { type: 'search', maxlength: '100', placeholder: 'Buscar nesta conversa', autocomplete: 'off' });
  const results = h('div', { class: 'search-results', 'aria-live': 'polite' }, h('p', { class: 'muted' }, 'Digite pelo menos 2 caracteres.'));
  const modal = openModal({ title: 'Buscar mensagens', body: [field('Buscar', input), results] });
  let timer = null, sequence = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const term = input.value.trim();
    const requestId = ++sequence;
    if (term.length < 2) { results.replaceChildren(h('p', { class: 'muted' }, 'Digite pelo menos 2 caracteres.')); return; }
    results.replaceChildren(h('p', { class: 'muted' }, 'Buscando…'));
    timer = setTimeout(async () => {
      const escaped = term.replace(/[\\%_]/g, '\\$&');
      const { data, error } = await sb.from('messages').select('id,user_id,content,created_at')
        .eq('room_id', roomId).ilike('content', `%${escaped}%`).order('id', { ascending: false }).limit(30);
      if (!modal.isConnected || requestId !== sequence || !current || current.id !== roomId) return;
      if (error) { results.replaceChildren(h('p', { class: 'muted' }, 'Não foi possível buscar agora.')); return; }
      await ensureNames((data || []).map((m) => m.user_id));
      if (!modal.isConnected || requestId !== sequence || !current || current.id !== roomId) return;
      results.replaceChildren();
      if (!data.length) { results.append(h('p', { class: 'muted' }, 'Nenhuma mensagem encontrada.')); return; }
      for (const m of data) {
        const button = h('button', { type: 'button', class: 'search-result' },
          h('small', null, `${names.get(m.user_id) || 'Alguém'} · ${new Date(m.created_at).toLocaleString('pt-BR')}`),
          h('span', null, plainText(m.content || '')));
        button.addEventListener('click', async () => {
          closeModal();
          await loadMessages(true, m.id);
          if (!current || current.id !== roomId) return;
          const target = document.querySelector(`[data-mid="${m.id}"]`);
          if (target) { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); target.classList.add('flash'); }
        });
        results.append(button);
      }
    }, 300);
  });
}

function paintPinButton(button, id) {
  const pinned = pinnedIds.has(String(id));
  const label = pinned ? 'Desafixar mensagem' : 'Fixar mensagem';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(pinned));
}
async function loadPins(roomId) {
  const revision = roomRevision;
  const { data, error } = await sb.from('room_pins').select('message_id').eq('room_id', roomId);
  if (error || !current || current.id !== roomId || roomRevision !== revision) return;
  pinnedIds = new Set((data || []).map((p) => String(p.message_id)));
  document.querySelectorAll('[data-pin-mid]').forEach((button) => paintPinButton(button, button.dataset.pinMid));
}
function openPinsModal() {
  if (!current) return;
  const results = h('div', { class: 'search-results', 'aria-live': 'polite' }, h('p', { class: 'muted' }, 'Carregando…'));
  pinsModal = openModal({ title: 'Mensagens fixadas', body: results });
  refreshPinsModal(current.id);
}
async function refreshPinsModal(roomId) {
  const modal = pinsModal;
  if (!modal || !modal.isConnected) return;
  const { data, error } = await sb.from('room_pins').select('message_id,created_at,messages(id,user_id,content,created_at,kind)')
    .eq('room_id', roomId).order('created_at', { ascending: false }).limit(100);
  if (!modal.isConnected || pinsModal !== modal || !current || current.id !== roomId) return;
  const results = modal.querySelector('.search-results');
  if (error) { results.replaceChildren(h('p', { class: 'muted' }, 'Não foi possível carregar as mensagens fixadas.')); return; }
  const messages = (data || []).map((p) => p.messages).filter(Boolean);
  await ensureNames(messages.map((m) => m.user_id));
  if (!modal.isConnected || pinsModal !== modal || !current || current.id !== roomId) return;
  results.replaceChildren();
  if (!messages.length) { results.append(h('p', { class: 'muted' }, 'Nenhuma mensagem fixada ainda.')); return; }
  for (const m of messages) {
    const button = h('button', { type: 'button', class: 'search-result' },
      h('small', null, `${names.get(m.user_id) || 'Alguém'} · ${new Date(m.created_at).toLocaleString('pt-BR')}`),
      h('span', null, excerpt(m)));
    button.addEventListener('click', async () => {
      closeModal();
      await loadMessages(true, m.id);
      if (!current || current.id !== roomId) return;
      const target = document.querySelector(`[data-mid="${m.id}"]`);
      if (target) { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); target.classList.add('flash'); }
    });
    results.append(button);
  }
}

async function ensureNames(ids) {
  const missing = [...new Set(ids)].filter((id) => !names.has(id));
  if (!missing.length) return;
  const { data } = await sb.from('profiles').select('id, display_name, avatar_url, banner_url').in('id', missing);
  for (const p of data || []) setProf(p);
}

// ---------- Reações ----------
const reacts = new Map();   // id da mensagem -> Map(emoji -> Set(id de quem reagiu))
const msgById = new Map();  // id da mensagem -> mensagem (para respostas e reações)
const QUICK_REACTIONS = ['👍', '😂', '❤️', '🔥', '😮', '😢', '🎉'];

async function loadReactions(ids) {
  if (!ids.length) return;
  const { data } = await sb.from('message_reactions').select('message_id, user_id, emoji').in('message_id', ids);
  for (const id of ids) reacts.delete(id);
  for (const r of data || []) addReaction(r, false);
  await ensureNames((data || []).map((r) => r.user_id));
  ids.forEach(paintReactions);
}
function addReaction(r, paint = true) {
  let map = reacts.get(r.message_id);
  if (!map) { map = new Map(); reacts.set(r.message_id, map); }
  if (!map.has(r.emoji)) map.set(r.emoji, new Set());
  map.get(r.emoji).add(r.user_id);
  if (paint) paintReactions(r.message_id);
}
function removeReaction(r, paint = true) {
  const set = reacts.get(r.message_id)?.get(r.emoji);
  if (set) { set.delete(r.user_id); if (!set.size) reacts.get(r.message_id).delete(r.emoji); }
  if (paint) paintReactions(r.message_id);
}
function paintReactions(id) {
  const box = document.querySelector(`[data-rx="${id}"]`);
  if (!box) return;
  box.innerHTML = '';
  const map = reacts.get(id);
  if (!map || !map.size) { box.hidden = true; return; }
  box.hidden = false;
  for (const [emoji, set] of map) {
    const mine = set.has(me.id);
    const who = [...set].map((u) => (u === me.id ? 'você' : names.get(u) || 'alguém'));
    const chip = h('button', { type: 'button', class: 'react-chip' + (mine ? ' mine' : ''), title: who.join(', '), 'aria-pressed': String(mine), 'aria-label': `${emoji}: ${set.size}, ${who.join(', ')}` },
      h('span', { class: 're' }, emoji), h('span', { class: 'rc' }, String(set.size)));
    chip.addEventListener('click', () => toggleReaction(id, emoji));
    box.append(chip);
  }
  const add = h('button', { type: 'button', class: 'react-chip react-add', title: 'Adicionar reação', 'aria-label': 'Adicionar reação', html: ICON.plus });
  add.addEventListener('click', () => quickReact(add, id));
  box.append(add);
}
async function toggleReaction(id, emoji) {
  const m = msgById.get(id);
  if (!m) return;
  const mine = reacts.get(id)?.get(emoji)?.has(me.id);
  const r = { message_id: id, user_id: me.id, emoji };
  if (mine) {
    removeReaction(r);
    const { error } = await sb.from('message_reactions').delete().match(r);
    if (error) { addReaction(r); toast('Não consegui tirar a reação.'); }
  } else {
    addReaction(r);
    const { error } = await sb.from('message_reactions').insert({ ...r, room_id: m.room_id });
    if (error && !/duplicate/i.test(error.message)) { removeReaction(r); toast(traduzir(error.message)); }
  }
}
function quickReact(anchor, id) {
  const row = h('div', { class: 'quick-react', role: 'group', 'aria-label': 'Reagir' });
  for (const e of QUICK_REACTIONS) {
    const b = h('button', { type: 'button', class: 'emoji-btn', title: e, 'aria-label': `Reagir com ${e}` }, e);
    b.addEventListener('click', () => { closeMenu(); toggleReaction(id, e); });
    row.append(b);
  }
  const more = h('button', { type: 'button', class: 'emoji-btn more', title: 'Mais emojis', 'aria-label': 'Mais emojis', html: ICON.plus });
  more.addEventListener('click', () => openEmojiPicker(anchor, (e) => { closeMenu(); if (!reacts.get(id)?.get(e)?.has(me.id)) toggleReaction(id, e); }));
  row.append(more);
  openMenu(anchor, [{ node: row }]);
}

// ---------- Responder ----------
let replyTo = null; // { id, name }
function startReply(m) {
  replyTo = { id: m.id, name: names.get(m.user_id) || 'alguém' };
  const bar = $('reply-bar');
  bar.innerHTML = '';
  const close = h('button', { type: 'button', class: 'icon-btn', title: 'Cancelar resposta', 'aria-label': 'Cancelar resposta', html: ICON.close });
  close.addEventListener('click', clearReply);
  bar.append(h('span', { html: ICON.reply, style: { display: 'inline-flex' }, 'aria-hidden': 'true' }), h('span', { class: 'grow' }, 'Respondendo a ', h('strong', null, replyTo.name)), close);
  bar.hidden = false;
  $('chat-input').focus();
}
function clearReply() {
  replyTo = null;
  $('reply-bar').hidden = true;
}
function excerpt(m) {
  if (!m) return 'Mensagem apagada';
  if (m.kind === 'bot') return 'Sorteio';
  const t = plainText(m.content || '').replace(/\s+/g, ' ').trim();
  return t ? (t.length > 90 ? t.slice(0, 90) + '…' : t) : '📷 Imagem';
}
function replyRef(m) {
  const ref = h('button', { type: 'button', class: 'reply-ref' }, h('span', { html: ICON.reply, 'aria-hidden': 'true', style: { display: 'inline-flex' } }));
  const fill = (orig) => {
    ref.append(h('strong', null, orig ? names.get(orig.user_id) || 'Alguém' : ''), h('span', { class: 'reply-text' }, excerpt(orig)));
    ref.setAttribute('aria-label', 'Ir para a mensagem respondida');
  };
  const orig = msgById.get(m.reply_to);
  if (orig) fill(orig);
  else {
    sb.from('messages').select(MSG_FIELDS).eq('id', m.reply_to).maybeSingle().then(async ({ data }) => {
      if (data) { msgById.set(data.id, data); await ensureNames([data.user_id]); }
      fill(data);
    });
  }
  ref.addEventListener('click', () => {
    const el = document.querySelector(`[data-mid="${m.reply_to}"]`);
    if (!el) { toast('Essa mensagem é antiga demais pra aparecer aqui.'); return; }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  });
  return ref;
}

// ---------- Prévia de post do X/Twitter ----------
const TWEET_RE = /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+/i;
const previews = new Map();
function tweetCard(url) {
  const card = h('a', { class: 'tweet-card loading', href: url, target: '_blank', rel: 'noopener noreferrer' }, h('span', { class: 'tweet-skel' }));
  let p = previews.get(url);
  if (!p) { p = api('/api/link-preview?url=' + encodeURIComponent(url)).catch(() => null); previews.set(url, p); }
  p.then((d) => {
    const box = $('messages');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
    requestAnimationFrame(() => { if (nearBottom) box.scrollTop = box.scrollHeight; });
    card.classList.remove('loading');
    card.innerHTML = '';
    if (!d || !d.text) { card.remove(); return; }
    card.append(
      h('div', { class: 'tweet-head' },
        h('span', { class: 'avatar', style: { background: colorFor(d.handle || d.author) } }, (d.author || '?').charAt(0).toUpperCase()),
        h('span', { class: 'tweet-who' }, h('strong', null, d.author), h('span', null, d.handle ? '@' + d.handle : '')),
        h('span', { class: 'tweet-tag' }, 'POST')),
      h('p', { class: 'tweet-text' }, d.text),
      h('div', { class: 'tweet-foot' }, h('span', null, d.date || ''), h('span', null, 'Ver no X')));
  });
  return card;
}

// Barra de ações que aparece ao passar o mouse
function msgTools(m, row, isBot) {
  const tools = h('div', { class: 'msg-tools' });
  const rb = h('button', { type: 'button', class: 'icon-btn', title: 'Reagir', 'aria-label': 'Reagir', html: ICON.react });
  rb.addEventListener('click', () => quickReact(rb, m.id));
  tools.append(rb);
  const pin = h('button', { type: 'button', class: 'icon-btn', 'data-pin-mid': String(m.id), html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3h8l-1 6 3 3v2H6v-2l3-3-1-6Z"/><path d="M12 14v7"/></svg>' });
  paintPinButton(pin, m.id);
  pin.addEventListener('click', async () => {
    pin.disabled = true;
    const isPinned = pinnedIds.has(String(m.id));
    const result = isPinned
      ? await sb.from('room_pins').delete().eq('room_id', m.room_id).eq('message_id', m.id)
      : await sb.from('room_pins').insert({ room_id: m.room_id, message_id: m.id, pinned_by: me.id });
    if (result.error) toast('Não foi possível alterar a mensagem fixada.');
    else await loadPins(m.room_id);
    pin.disabled = false;
  });
  tools.append(pin);
  if (!isBot) {
    const rp = h('button', { type: 'button', class: 'icon-btn', title: 'Responder', 'aria-label': 'Responder', html: ICON.reply });
    rp.addEventListener('click', () => startReply(m));
    tools.append(rp);
  }
  if (m.user_id === me.id || can('delete_messages')) {
    const del = h('button', { type: 'button', class: 'icon-btn danger', title: 'Apagar', 'aria-label': isBot ? 'Apagar sorteio' : 'Apagar mensagem', html: ICON.trash });
    del.addEventListener('click', async () => {
      const { error } = await sb.from('messages').delete().eq('id', m.id);
      if (error) { toast('Não foi possível apagar.'); return; }
      if (chatCache) chatCache.removeMessage(m.id).catch(() => {});
      row.remove();
      if (m.attachment_path && m.user_id === me.id) sb.storage.from('chat').remove([m.attachment_path]).catch(() => {});
    });
    tools.append(del);
  }
  return tools;
}

// Mensagem do bot Sorteador
function botMessageEl(m) {
  msgById.set(m.id, m);
  const who = names.get(m.user_id) || 'Alguém';
  const mem = members.find((x) => x.user_id === m.user_id);
  const body = h('div', { class: 'msg-body' },
    h('div', { class: 'msg-meta' },
      h('span', { class: 'msg-name bot-name' }, 'Sorteador'),
      h('span', { class: 'bot-tag' }, 'BOT'),
      h('span', { class: 'msg-time' }, fmtTime(m.created_at))),
    h('div', { class: 'bot-by' }, 'pedido por ', h('span', { style: { color: nameColor(mem) || '' } }, who)),
    resultCard(m.payload, (id) => nameColor(members.find((x) => x.user_id === id))),
    h('div', { class: 'reactions', 'data-rx': String(m.id), hidden: true }));
  const row = h('div', { class: 'msg-row bot', 'data-mid': String(m.id) },
    h('span', { class: 'avatar bot-avatar', 'aria-hidden': 'true', html: BOT_ICON }), body);
  row.append(msgTools(m, row, true));
  return row;
}

function messageEl(m, prev) {
  if (m.kind === 'bot') return botMessageEl(m);
  msgById.set(m.id, m);
  const cont = !m.reply_to && prev && prev.kind !== 'bot' && prev.user_id === m.user_id && new Date(m.created_at) - new Date(prev.created_at) < 5 * 60 * 1000;
  const name = names.get(m.user_id) || 'Alguém';
  const mem = members.find((x) => x.user_id === m.user_id);
  const body = h('div', { class: 'msg-body' });
  if (m.reply_to) body.append(replyRef(m));
  if (!cont) {
    body.append(h('div', { class: 'msg-meta' },
      h('span', { class: 'msg-name', style: { color: nameColor(mem) || '' } }, name),
      h('span', { class: 'msg-time' }, fmtTime(m.created_at))));
  }
  if (m.content) {
    const text = h('div', { class: 'msg-text', title: cont ? fmtTime(m.created_at) : null });
    renderContent(text, m.content);
    body.append(text);
    const tw = m.content.match(TWEET_RE);
    if (tw) body.append(tweetCard(tw[0]));
  }
  if (m.attachment_path) {
    const img = h('img', { class: 'msg-img', 'data-path': m.attachment_path, alt: 'Imagem enviada por ' + name, loading: 'lazy' });
    img.addEventListener('click', () => img.src && openLightbox(img.src));
    body.append(img);
  }
  body.append(h('div', { class: 'reactions', 'data-rx': String(m.id), hidden: true }));
  const row = h('div', { class: 'msg-row' + (cont ? ' cont' : '') + (mentionsMe(m.content) ? ' mentioned' : ''), 'data-mid': String(m.id) }, avatarOf(m.user_id, name), body);
  row.append(msgTools(m, row, false));
  const nameEl = row.querySelector('.msg-name');
  if (nameEl) { nameEl.style.cursor = 'pointer'; nameEl.addEventListener('click', () => memberMenu(nameEl, m.user_id)); }
  return row;
}

// ---------- "Fulano está digitando…" ----------
const typing = new Map(); // id -> { name, t }
let lastTypingSent = 0;
function onTyping(p) {
  if (!p || !p.id || (me && p.id === me.id)) return;
  const old = typing.get(p.id);
  if (old) clearTimeout(old.t);
  typing.set(p.id, { name: String(p.name || 'Alguém').slice(0, 32), t: setTimeout(() => { typing.delete(p.id); renderTyping(); }, 4500) });
  renderTyping();
}
function stopTyping(id) {
  const old = typing.get(id);
  if (!old) return;
  clearTimeout(old.t);
  typing.delete(id);
  renderTyping();
}
function renderTyping() {
  const el = $('typing');
  el.innerHTML = '';
  const list = [...typing.values()].map((x) => x.name);
  el.classList.toggle('on', list.length > 0);
  if (!list.length) return;
  const text = list.length === 1 ? [h('strong', null, list[0]), ' está digitando…']
    : list.length === 2 ? [h('strong', null, list[0]), ' e ', h('strong', null, list[1]), ' estão digitando…']
      : ['Várias pessoas estão digitando…'];
  el.append(h('span', { class: 'dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', null, text));
}
function sendTyping() {
  if (!roomChannel || !me || myStatus === 'invisible') return;
  if (Date.now() - lastTypingSent < 2500) return;
  lastTypingSent = Date.now();
  roomChannel.send({ type: 'broadcast', event: 'typing', payload: { id: me.id, name: me.display_name } }).catch(() => {});
}

async function appendMessage(m, live) {
  if (!current || current.id !== m.room_id) return;
  if (chatCache) chatCache.append(m.room_id, m).catch(() => {});
  if (document.querySelector(`[data-mid="${m.id}"]`)) return;
  const mentioned = [...String(m.content || '').matchAll(MENTION_RE)].map((x) => x[1].toLowerCase());
  await ensureNames([m.user_id, ...mentioned]);
  if (!current || current.id !== m.room_id) return;
  if (document.querySelector(`[data-mid="${m.id}"]`)) return;
  const box = $('messages');
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const el = messageEl(m, lastMsg);
  if (live) el.classList.add('enter');
  box.append(el);
  lastMsg = m;
  if (near || m.user_id === me.id) box.scrollTop = box.scrollHeight;
  hydrateImages(el);
}

let pendingImage = null; // { blob, type, ext, url }
function saveImageDraft(roomId, img) {
  const old = imageDrafts.get(roomId);
  if (old && old !== img && old.url) URL.revokeObjectURL(old.url);
  imageDrafts.delete(roomId);
  if (img) imageDrafts.set(roomId, img);
  if (imageDrafts.size > 3) {
    const first = imageDrafts.keys().next().value;
    const removed = imageDrafts.get(first);
    imageDrafts.delete(first);
    if (removed && removed.url) URL.revokeObjectURL(removed.url);
    toast('O rascunho de imagem mais antigo foi removido para liberar memória.', 5000);
  }
}
function switchImageDraft(previousRoom, nextRoom) {
  if (previousRoom && pendingImage) saveImageDraft(previousRoom, pendingImage);
  pendingImage = null;
  const next = imageDrafts.get(nextRoom) || null;
  imageDrafts.delete(nextRoom);
  setPendingImage(next);
}
function setPendingImage(img) {
  if (pendingImage && pendingImage.url) URL.revokeObjectURL(pendingImage.url);
  pendingImage = img;
  const box = $('attach-preview');
  box.innerHTML = '';
  box.hidden = !img;
  if (!img) return;
  const remove = h('button', { type: 'button', class: 'icon-btn', title: 'Tirar imagem', 'aria-label': 'Tirar imagem', html: ICON.close });
  remove.addEventListener('click', () => setPendingImage(null));
  box.append(h('img', { src: img.url, alt: 'Prévia da imagem' }), h('span', { class: 'attach-name' }, img.type === 'image/gif' ? 'GIF' : 'Imagem'), remove);
}
async function attachFile(file) {
  if (!file || !current) return;
  const roomId = current.id;
  try {
    const out = await prepareChatImage(file);
    const image = { ...out, url: URL.createObjectURL(out.blob) };
    if (current && current.id === roomId) { setPendingImage(image); $('chat-input').focus(); }
    else saveImageDraft(roomId, image);
  } catch (err) { toast(err.message, 4000); }
}

function wireChat() {
  const input = $('chat-input');
  const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px'; };
  input.addEventListener('input', () => {
    autosize();
    updateMentionPopup();
    const v = input.value.trim();
    if (v && !v.startsWith('/')) sendTyping();
  });
  input.addEventListener('click', updateMentionPopup);
  input.addEventListener('blur', () => setTimeout(closeMentionPopup, 150));
  input.addEventListener('keydown', (e) => {
    if (mentionState) {
      if (e.key === 'ArrowDown') { e.preventDefault(); mentionState.index = (mentionState.index + 1) % mentionState.items.length; renderMentionPopup(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); mentionState.index = (mentionState.index - 1 + mentionState.items.length) % mentionState.items.length; renderMentionPopup(); return; }
      // Comando já completo (ex.: "/moeda"): Enter envia direto
      if (e.key === 'Enter' && mentionState.cmd && COMMANDS.some((c) => c.cmd === input.value.trim().toLowerCase())) {
        closeMentionPopup();
      } else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mentionState.index); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeMentionPopup(); return; }
    }
    if (e.key === 'Escape' && replyTo) { e.preventDefault(); clearReply(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
  });
  input.addEventListener('paste', (e) => {
    const file = [...(e.clipboardData ? e.clipboardData.files : [])].find((f) => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); attachFile(file); }
  });
  // Blur do topo só aparece quando tem mensagem escondida lá em cima
  const box = $('messages');
  const markScroll = () => box.classList.toggle('scrolled', box.scrollTop > 8);
  box.addEventListener('scroll', markScroll, { passive: true });
  new MutationObserver(markScroll).observe(box, { childList: true });
  const view = $('chat-view');
  view.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); view.classList.add('dropping'); } });
  view.addEventListener('dragleave', (e) => { if (e.target === view || !view.contains(e.relatedTarget)) view.classList.remove('dropping'); });
  view.addEventListener('drop', (e) => {
    view.classList.remove('dropping');
    const file = e.dataTransfer && [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); attachFile(file); }
  });
  $('attach-btn').addEventListener('click', () => $('attach-input').click());
  $('attach-input').addEventListener('change', () => { const f = $('attach-input').files[0]; $('attach-input').value = ''; attachFile(f); });
  $('draw-btn').addEventListener('click', () => openDrawModal('teams'));
  $('emoji-btn').addEventListener('click', () => openEmojiPicker($('emoji-btn'), (emo) => {
    const a = input.selectionStart ?? input.value.length;
    const b = input.selectionEnd ?? a;
    input.value = input.value.slice(0, a) + emo + input.value.slice(b);
    input.setSelectionRange(a + emo.length, a + emo.length);
    input.focus();
    autosize();
  }));
  $('chat-form').addEventListener('submit', (e) => { e.preventDefault(); sendMessage(); });

  let sending = false;
  async function sendMessage() {
    if (sending || !current) return;
    const raw = input.value.trim();
    const img = pendingImage;
    if (!raw && !img) return;
    if (raw.startsWith('/') && !img) {
      const req = parseCommand(raw);
      if (req) {
        if (req.error) { toast(req.error, 4500); return; }
        input.value = '';
        autosize();
        closeMentionPopup();
        if (['teams', 'people', 'order'].includes(req.kind)) {
          const people = defaultDrawPeople();
          if (people.length < 2) { openDrawModal(req.kind, req.count); return; }
          runDraw({ ...req, people });
        } else {
          runDraw(req);
        }
        return;
      }
    }
    sending = true;
    const roomId = current.id;
    const row = { room_id: roomId, user_id: me.id, content: encodeMentions(raw).slice(0, 2000) };
    const replying = replyTo;
    if (replying) row.reply_to = replying.id;
    clearReply();
    input.value = '';
    autosize();
    closeMentionPopup();
    try {
      if (img) {
        const path = `${roomId}/${me.id}/${Date.now()}.${img.ext}`;
        const up = await sb.storage.from('chat').upload(path, img.blob, { contentType: img.type, cacheControl: '31536000', upsert: false });
        if (up.error) throw new Error('Não consegui enviar a imagem (rodou o SQL da v2.3?).');
        row.attachment_path = path;
        row.attachment_type = img.type;
      }
      const { data, error } = await sb.from('messages').insert(row).select(MSG_FIELDS).single();
      if (error) {
        if (row.attachment_path) sb.storage.from('chat').remove([row.attachment_path]).catch(() => {});
        throw new Error(traduzir(error.message));
      }
      if (img && pendingImage === img) setPendingImage(null);
      else if (img && imageDrafts.get(roomId) === img) { imageDrafts.delete(roomId); if (img.url) URL.revokeObjectURL(img.url); }
      appendMessage(data, true);
    } catch (err) {
      toast(err.message, 4000);
      const stillHere = current && current.id === roomId;
      const existing = stillHere ? input.value : (textDrafts.get(roomId) || '');
      const recovered = [raw, existing].filter(Boolean).join('\n');
      if (stillHere) {
        input.value = recovered;
        if (replying) { const orig = msgById.get(replying.id); if (orig) startReply(orig); }
        autosize();
      } else textDrafts.set(roomId, recovered);
    } finally {
      sending = false;
    }
  }
}

// ---------- Visões (chat / call) ----------
function setView(v) {
  view = v;
  $('ch-updates').classList.toggle('active', v === 'updates');
  $('ch-chat').classList.toggle('active', v === 'chat');
  $('ch-call').classList.toggle('active', v === 'call');
  $('updates-view').hidden = v !== 'updates';
  $('chat-view').hidden = v !== 'chat';
  $('call-view').hidden = v !== 'call';
  $('chat-search-btn').hidden = v !== 'chat' || !current;
  $('pins-btn').hidden = v !== 'chat' || !current;
  const icons = { updates: ICON.megaphone, chat: '#', call: ICON.mic };
  const titles = { updates: 'atualizações', chat: 'chat', call: 'Call' };
  const dm = isDm(current);
  $('top-icon').innerHTML = dm && v !== 'updates' ? '@' : icons[v];
  $('top-title').textContent = dm && v !== 'updates' ? dmTitle(current) + (v === 'call' ? ' · ligação' : '') : titles[v];
  if (!dm) $('top-sub').textContent = '';
  $('app').classList.remove('show-side');
  $('side-toggle').setAttribute('aria-expanded', 'false');
  if (v === 'updates') renderUpdates();
  if (v === 'chat' && current) clearUnread(current.id);
  onCallChange();
}

// ---------- Canal de atualizações ----------
let updates = [];
async function loadUpdates() {
  try {
    const res = await fetch('/atualizacoes.json', { cache: 'no-cache' });
    updates = await res.json();
  } catch (_) { updates = []; }
  const latest = updates[0] && updates[0].versao;
  const seen = localStorage.getItem('resenha:versao-vista');
  $('updates-badge').hidden = !latest || seen === latest;
}

function renderUpdates() {
  const list = $('updates-list');
  list.innerHTML = '';
  list.append(h('div', { class: 'updates-head' },
    h('h2', null, 'O que há de novo no Resenha'),
    h('p', null, 'Toda atualização aparece aqui. Para pegar a versão nova, recarregue a página ou reabra o app.')));
  updates.forEach((u, i) => {
    const date = new Date(u.data + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    list.append(h('article', { class: 'update-card' + (i === 0 ? ' latest' : '') },
      h('div', { class: 'update-meta' },
        h('span', { class: 'update-version' }, 'v' + u.versao),
        i === 0 ? h('span', { class: 'new-badge' }, 'ATUAL') : null,
        h('span', { class: 'update-date' }, date)),
      h('h3', null, u.titulo),
      h('ul', null, u.itens.map((t) => h('li', null, t)))));
  });
  if (updates[0]) {
    localStorage.setItem('resenha:versao-vista', updates[0].versao);
    $('updates-badge').hidden = true;
  }
}

// ---------- Call: prévia de quem está lá ----------
function startPreviewPolling() {
  clearInterval(previewTimer);
  const tick = async () => {
    if (!current || (call.room && call.roomId === current.id) || !cfg.livekitReady) { callPreview = []; renderCallList(); return; }
    try {
      const id = current.id;
      const { participants: list } = await api(`/api/call-participants?roomId=${id}`);
      if (current && current.id === id) { callPreview = list || []; renderCallList(); renderCallEmpty(); }
    } catch (_) {}
  };
  tick();
  previewTimer = setInterval(tick, 15000);
}

// Card "Call da sala" na lateral: fica vivo (feixe de luz) quando tem gente
function renderCallCard() {
  const card = $('call-card');
  const join = $('call-card-join');
  card.hidden = !current;
  if (!current) { card.classList.remove('live'); join.hidden = true; return; }
  const inThis = Boolean(call.room && call.roomId === current.id);
  const count = inThis ? participants().length : callPreview.length;
  card.classList.toggle('live', count > 0);
  const dm = isDm(current);
  $('call-card-title').textContent = count > 0 ? `${dm ? 'Ligação rolando' : 'Call rolando'} · ${count}` : dm ? 'Ligação' : 'Call da sala';
  join.hidden = inThis || !cfg.livekitReady;
  join.disabled = call.connecting;
  join.lastChild.textContent = call.connecting ? ' Conectando…' : call.room ? ' Trocar pra esta call' : dm ? (count > 0 ? ' Entrar na ligação' : ' Ligar') : ' Entrar na call';
}

function renderCallList() {
  const ul = $('call-list');
  ul.innerHTML = '';
  renderCallCard();
  if (!current) return;
  const inThis = call.room && call.roomId === current.id;
  if (inThis) {
    for (const x of participants()) {
      const li = h('li', { 'data-identity': x.identity, class: x.speaking ? 'speaking' : '' },
        avatarOf(x.identity, x.name, 'sm ring'),
        h('span', { class: 'name', style: { color: nameColor(members.find((m) => m.user_id === x.identity)) || '' } }, x.name),
        h('span', { class: 'badges' },
          x.screen && !x.screen.isMuted ? h('span', { class: 'live-badge' }, 'AO VIVO') : null,
          x.camera && !x.camera.isMuted ? h('span', { html: ICON.smallCam, style: { display: 'inline-flex' } }) : null,
          x.muted ? h('span', { html: ICON.smallMicOff, style: { display: 'inline-flex' } }) : null,
          x.deafened ? h('span', { html: ICON.smallHeadOff, style: { display: 'inline-flex' } }) : null));
      if (!x.local) {
        li.style.cursor = 'pointer';
        li.addEventListener('click', () => memberMenu(li, x.identity));
      }
      ul.append(li);
    }
  } else {
    for (const p of callPreview) {
      ul.append(h('li', null, avatarOf(p.identity, p.name, 'sm'), h('span', { class: 'name' }, p.name)));
    }
  }
}

function renderCallEmpty() {
  const inThis = call.room && call.roomId === current?.id;
  $('call-empty').hidden = inThis;
  $('stage-bar').hidden = !inThis;
  if (inThis || !current) return;
  const btn = $('join-call-btn');
  btn.disabled = call.connecting;
  if (!cfg.livekitReady) {
    $('call-empty-sub').textContent = 'A call ainda não foi configurada no servidor (faltam as chaves do LiveKit).';
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  if (call.connecting) btn.textContent = 'Conectando…';
  else if (call.room) btn.textContent = `Sair de ${call.roomName} e entrar aqui`;
  else btn.textContent = 'Entrar na call';
  $('call-empty-sub').textContent = callPreview.length
    ? `${callPreview.map((p) => p.name).join(', ')} ${callPreview.length === 1 ? 'está' : 'estão'} na call.`
    : 'Ninguém na call ainda. Que tal começar?';
}

function setBtn(el, on, iconOn, iconOff, labelOn, labelOff) {
  el.innerHTML = on ? iconOn : iconOff;
  el.title = on ? labelOn : labelOff;
  el.setAttribute('aria-label', el.title);
}

function onCallChange() {
  // Controles do painel do usuário
  setBtn($('mic-btn'), !call.muted, ICON.mic, ICON.micOff, 'Desativar microfone', 'Ativar microfone');
  $('mic-btn').classList.toggle('off', call.muted);
  setBtn($('deaf-btn'), !call.deafened, ICON.head, ICON.headOff, 'Desativar áudio', 'Ativar áudio');
  $('deaf-btn').classList.toggle('off', call.deafened);
  $('settings-btn').innerHTML = ICON.gear;

  const connected = Boolean(call.room);
  $('voice-bar').hidden = !connected && !call.connecting;
  if (connected || call.connecting) {
    const state = call.room ? call.room.state : 'connecting';
    const ok = state === 'connected';
    $('vb-title').className = 'vb-title' + (ok ? '' : ' warn');
    $('vb-title').innerHTML = '';
    $('vb-title').append(h('span', { class: 'dot' }), ok ? 'Voz conectada' : state === 'reconnecting' ? 'Reconectando…' : 'Conectando…');
    $('vb-sub').textContent = `Call / ${call.roomName}`;
    $('hangup-btn').innerHTML = ICON.hangup;
    const lp = call.room ? call.room.localParticipant : null;
    const camOn = Boolean(lp && lp.isCameraEnabled);
    const scrOn = Boolean(lp && lp.isScreenShareEnabled);
    setBtn($('cam-btn'), !camOn, ICON.cam, ICON.camOff, 'Ligar câmera', 'Desligar câmera');
    $('cam-btn').classList.toggle('on', camOn);
    setBtn($('screen-btn'), !scrOn, ICON.screen, ICON.screenOff, 'Transmitir tela', 'Parar transmissão');
    $('screen-btn').classList.toggle('on', scrOn);
    // Barra do palco
    setBtn($('mic-btn-2'), !call.muted, ICON.mic, ICON.micOff, 'Desativar microfone', 'Ativar microfone');
    $('mic-btn-2').classList.toggle('off', call.muted);
    setBtn($('cam-btn-2'), !camOn, ICON.cam, ICON.camOff, 'Ligar câmera', 'Desligar câmera');
    $('cam-btn-2').classList.toggle('on', camOn);
    setBtn($('screen-btn-2'), !scrOn, ICON.screen, ICON.screenOff, 'Transmitir tela', 'Parar transmissão');
    $('screen-btn-2').classList.toggle('on', scrOn);
    setBtn($('speaker-btn-2'), !call.deafened, ICON.head, ICON.headOff, 'Desativar áudio', 'Ativar áudio');
    $('speaker-btn-2').classList.toggle('off', call.deafened);
    $('hangup-btn-2').innerHTML = ICON.hangup;
  }
  const inThis = connected && call.roomId === current?.id;
  $('return-call-btn').hidden = !(inThis && view !== 'call');
  $('call-chat-btn').hidden = !inThis || view !== 'call';
  if (!current) return;
  if (view === 'call' && inThis) $('top-sub').textContent = `${participants().length} na call`;
  else if (!isDm(current)) $('top-sub').textContent = '';
  renderCallList();
  renderCallEmpty();
  if (view === 'call' && inThis) {
    renderStage();
    const screens = participants().filter((person) => person.screen && person.screen.track && !person.screen.isMuted)
      .map((person) => `${person.identity}:screen`);
    $('stage-nav').hidden = screens.length < 2;
  } else {
    $('stage').innerHTML = '';
    $('stage-nav').hidden = true;
  }
  renderRail();
}

function moveStageFocus(direction) {
  const screens = participants().filter((person) => person.screen && person.screen.track && !person.screen.isMuted)
    .map((person) => `${person.identity}:screen`);
  const focusKey = moveFocus(screens, call.focusKey, direction);
  if (!focusKey) return;
  call.focusKey = focusKey;
  renderStage();
}

async function enterCall() {
  if (!current) return;
  if (!cfg.livekitReady) { toast('A call ainda não foi configurada no servidor.'); return; }
  setView('call');
  await joinCall(current.id, current.name, (roomId) => api('/api/livekit-token', { roomId }));
  startPreviewPolling();
}

// ---------- Modais ----------
function createRoomModal() {
  const name = h('input', { maxlength: '50', placeholder: 'Ex.: Resenha dos amigos', required: true });
  const pub = h('input', { type: 'checkbox' });
  const msg = h('p', { class: 'msg' });
  const ok = h('button', { class: 'btn primary' }, 'Criar sala');
  openModal({
    title: 'Criar uma sala',
    body: [field('Nome da sala', name), h('label', { class: 'check' }, pub, 'Sala pública (aparece em Explorar)'), msg],
    actions: [h('button', { class: 'btn secondary', onClick: closeModal }, 'Cancelar'), ok]
  });
  const submit = async () => {
    if (!name.value.trim()) { msg.textContent = 'Dê um nome para a sala.'; return; }
    ok.disabled = true;
    try {
      const room = await rpc('create_room', { p_name: name.value.trim(), p_public: pub.checked });
      closeModal();
      await loadRooms();
      await openRoom(room.id);
      inviteModal();
    } catch (err) { msg.textContent = err.message; ok.disabled = false; }
  };
  ok.addEventListener('click', submit);
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

async function exploreModal() {
  const list = h('div', { class: 'list' }, h('p', { class: 'muted' }, 'Carregando…'));
  openModal({ title: 'Salas públicas', body: list });
  const { data } = await sb.from('rooms').select('id, name').eq('is_public', true).order('created_at', { ascending: false }).limit(50);
  list.innerHTML = '';
  const others = (data || []).filter((r) => !rooms.some((x) => x.id === r.id));
  if (!others.length) { list.append(h('p', { class: 'muted' }, 'Nenhuma sala pública nova por enquanto.')); return; }
  for (const r of others) {
    const b = h('button', { class: 'btn primary' }, 'Entrar');
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await rpc('join_room', { p_room: r.id, p_code: null }); closeModal(); await loadRooms(); openRoom(r.id); }
      catch (err) { toast(err.message); b.disabled = false; }
    });
    list.append(h('div', { class: 'list-item' }, avatar(r.id, r.name), h('div', { class: 'grow' }, h('div', { class: 'title' }, r.name)), b));
  }
}

function inviteLink() { return `${location.origin}/?convite=${current.invite_code}`; }

function inviteModal() {
  if (!current) return;
  const input = h('input', { readonly: true, value: inviteLink(), 'aria-label': 'Link de convite' });
  const copy = h('button', { class: 'btn primary' }, 'Copiar');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(input.value); copy.textContent = 'Copiado!'; }
    catch (_) { input.select(); document.execCommand('copy'); copy.textContent = 'Copiado!'; }
  });
  const body = [h('p', { class: 'muted', style: { margin: 0 } }, 'Mande este link para a galera. Quem abrir entra na sala depois de fazer login.'), h('div', { class: 'invite-box' }, input, copy)];
  const mine = myMember();
  if (mine && RANK[mine.base_role] >= 2) {
    const reset = h('button', { class: 'link' }, 'Gerar um link novo (o antigo para de funcionar)');
    reset.addEventListener('click', async () => {
      try {
        const code = await rpc('reset_invite', { p_room: current.id });
        current.invite_code = code;
        input.value = inviteLink();
        copy.textContent = 'Copiar';
        toast('Novo link gerado.');
      } catch (err) { toast(err.message); }
    });
    body.push(reset);
  }
  openModal({ title: `Convidar para ${current.name}`, body });
}

async function handleInvite(code) {
  try {
    const data = await rpc('invite_preview', { p_code: code });
    const info = Array.isArray(data) ? data[0] : null;
    if (!info) { toast('Esse convite não existe mais.'); return; }
    if (info.already_member) { await loadRooms(); openRoom(info.room_id); return; }
    if (info.banned) { toast('Você foi banido dessa sala.'); return; }
    const ok = h('button', { class: 'btn primary' }, 'Entrar na sala');
    openModal({
      title: 'Você foi convidado!',
      body: h('div', { class: 'list-item' }, avatar(info.room_id, info.name, 'lg'), h('div', { class: 'grow' }, h('div', { class: 'title' }, info.name), h('div', { class: 'sub' }, `${info.member_count} ${info.member_count == 1 ? 'membro' : 'membros'}`))),
      actions: [h('button', { class: 'btn secondary', onClick: closeModal }, 'Agora não'), ok]
    });
    ok.addEventListener('click', async () => {
      ok.disabled = true;
      try { const id = await rpc('join_room', { p_room: null, p_code: code }); closeModal(); await loadRooms(); openRoom(id); }
      catch (err) { toast(err.message); ok.disabled = false; }
    });
  } catch (err) { toast(err.message); }
}

function roomSettingsModal() {
  const name = h('input', { maxlength: '50', value: current.name });
  const pub = h('input', { type: 'checkbox', checked: current.is_public });
  const save = h('button', { class: 'btn primary' }, 'Salvar');
  const del = h('button', { class: 'btn danger', style: { marginRight: 'auto' } }, 'Excluir sala');
  openModal({
    title: 'Configurações da sala',
    body: [field('Nome da sala', name), h('label', { class: 'check' }, pub, 'Sala pública (aparece em Explorar)')],
    actions: [del, h('button', { class: 'btn secondary', onClick: closeModal }, 'Cancelar'), save]
  });
  save.addEventListener('click', async () => {
    try {
      await rpc('update_room', { p_room: current.id, p_name: name.value.trim(), p_public: pub.checked });
      closeModal(); await loadRooms(); openRoom(current.id); toast('Sala atualizada.');
    } catch (err) { toast(err.message); }
  });
  del.addEventListener('click', async () => {
    const ok = await confirmModal({ title: `Excluir ${current.name}?`, text: 'Todas as mensagens e cargos serão apagados. Isso não tem volta.', confirm: 'Excluir', danger: true });
    if (!ok) return;
    try {
      const id = current.id;
      if (call.roomId === id) await leaveCall();
      await rpc('delete_room', { p_room: id });
      await loadRooms();
      if (rooms[0]) openRoom(rooms[0].id); else renderEmpty();
      toast('Sala excluída.');
    } catch (err) { toast(err.message); }
  });
}

const ROLE_COLORS = ['#99aab5', '#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63', '#f1c40f', '#e67e22', '#e74c3c', '#607d8b'];

function rolesModal() {
  const list = h('div', { class: 'list' });
  const render = () => {
    list.innerHTML = '';
    if (!roles.length) list.append(h('p', { class: 'muted', style: { margin: 0 } }, 'Nenhum cargo ainda. Crie um para organizar a galera.'));
    for (const r of roles) {
      const perms = [r.can_kick && 'expulsar', r.can_ban && 'banir', r.can_manage_roles && 'gerenciar cargos', r.can_delete_messages && 'apagar mensagens'].filter(Boolean);
      const count = members.filter((m) => m.role_id === r.id).length;
      const edit = h('button', { class: 'btn secondary' }, 'Editar');
      edit.addEventListener('click', () => roleEditModal(r));
      list.append(h('div', { class: 'list-item' },
        h('span', { class: 'swatch', style: { background: r.color, width: '16px', height: '16px' } }),
        h('div', { class: 'grow' }, h('div', { class: 'title', style: { color: r.color } }, r.name),
          h('div', { class: 'sub' }, `${count} ${count === 1 ? 'pessoa' : 'pessoas'} · ${perms.length ? perms.join(', ') : 'sem permissões extras'}`)),
        edit));
    }
  };
  render();
  const add = h('button', { class: 'btn primary' }, 'Criar cargo');
  add.addEventListener('click', () => roleEditModal(null));
  openModal({
    title: 'Cargos', wide: true,
    body: [h('p', { class: 'hint' }, 'Para dar um cargo a alguém, clique no nome da pessoa na lista de membros.'), list],
    actions: [h('button', { class: 'btn secondary', onClick: closeModal }, 'Fechar'), add]
  });
}

function roleEditModal(role) {
  const name = h('input', { maxlength: '32', value: role ? role.name : '', placeholder: 'Ex.: Veterano' });
  let color = role ? role.color : ROLE_COLORS[1];
  const row = h('div', { class: 'color-row' });
  const custom = h('input', { type: 'color', value: color, 'aria-label': 'Cor personalizada' });
  const paint = () => row.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.c === color));
  for (const c of ROLE_COLORS) {
    const b = h('button', { type: 'button', 'data-c': c, style: { background: c }, 'aria-label': `Cor ${c}` });
    b.addEventListener('click', () => { color = c; custom.value = c; paint(); });
    row.append(b);
  }
  custom.addEventListener('input', () => { color = custom.value; paint(); });
  row.append(custom);
  paint();
  const perm = (label, key, permName) => {
    const cb = h('input', { type: 'checkbox', checked: role ? role[key] : false, disabled: !can(permName) });
    return { cb, el: h('label', { class: 'check', title: can(permName) ? '' : 'Você não tem essa permissão para dar' }, cb, label) };
  };
  const pk = perm('Expulsar membros', 'can_kick', 'kick');
  const pb = perm('Banir membros', 'can_ban', 'ban');
  const pm = perm('Gerenciar cargos', 'can_manage_roles', 'manage_roles');
  const pd = perm('Apagar mensagens dos outros', 'can_delete_messages', 'delete_messages');
  const save = h('button', { class: 'btn primary' }, role ? 'Salvar' : 'Criar');
  const actions = [h('button', { class: 'btn secondary', onClick: rolesModal }, 'Voltar'), save];
  if (role) {
    const del = h('button', { class: 'btn danger', style: { marginRight: 'auto' } }, 'Apagar cargo');
    del.addEventListener('click', async () => {
      try { await rpc('delete_role', { p_role: role.id }); await loadMembers(); rolesModal(); toast('Cargo apagado.'); }
      catch (err) { toast(err.message); }
    });
    actions.unshift(del);
  }
  openModal({
    title: role ? `Editar ${role.name}` : 'Novo cargo',
    body: [field('Nome do cargo', name), h('div', { class: 'field' }, h('span', { class: 'label' }, 'Cor'), row),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Permissões'), h('div', { class: 'perm-grid' }, pk.el, pb.el, pm.el, pd.el))],
    actions
  });
  save.addEventListener('click', async () => {
    if (!name.value.trim()) { toast('Dê um nome para o cargo.'); return; }
    const args = { p_name: name.value.trim(), p_color: color, p_kick: pk.cb.checked, p_ban: pb.cb.checked, p_manage: pm.cb.checked, p_delete: pd.cb.checked };
    try {
      if (role) await rpc('update_role', { p_role: role.id, ...args });
      else await rpc('create_role', { p_room: current.id, ...args });
      await loadMembers();
      rolesModal();
      toast(role ? 'Cargo salvo.' : 'Cargo criado.');
    } catch (err) { toast(err.message); }
  });
}

async function bansModal() {
  const list = h('div', { class: 'list' }, h('p', { class: 'muted' }, 'Carregando…'));
  openModal({ title: 'Banidos', body: list });
  try {
    const data = await rpc('list_bans', { p_room: current.id });
    list.innerHTML = '';
    if (!data.length) { list.append(h('p', { class: 'muted', style: { margin: 0 } }, 'Ninguém foi banido.')); return; }
    for (const b of data) {
      const un = h('button', { class: 'btn secondary' }, 'Desbanir');
      un.addEventListener('click', async () => {
        try { await rpc('unban_member', { p_room: current.id, p_user: b.user_id }); bansModal(); toast('Desbanido.'); }
        catch (err) { toast(err.message); }
      });
      list.append(h('div', { class: 'list-item' }, avatarOf(b.user_id, b.display_name),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, b.display_name), h('div', { class: 'sub' }, b.reason || 'Sem motivo')), un));
    }
  } catch (err) { list.innerHTML = ''; list.append(h('p', { class: 'msg' }, err.message)); }
}

// Cartão de perfil (aparece no menu ao clicar em alguém)
function profileCard(userId, name, m) {
  const p = profs.get(userId) || {};
  const st = statusOf(userId);
  const banner = h('div', { class: 'pcard-banner', style: { background: p.banner_url ? 'var(--bg-0)' : colorFor(userId) } },
    p.banner_url ? h('img', { src: p.banner_url, alt: '', referrerpolicy: 'no-referrer' }) : null);
  const role = m ? `${ROLE_LABEL[m.base_role]}${roleOf(m) ? ' · ' + roleOf(m).name : ''}` : null;
  return h('div', { class: 'pcard' },
    banner,
    h('div', { class: 'pcard-body' },
      avatar(userId, name, 'xl', p.avatar_url, st),
      h('div', { class: 'pcard-name', style: { color: m ? nameColor(m) || '' : '' } }, name),
      h('div', { class: 'pcard-status' }, statusDot(st), STATUS[st].label),
      role ? h('div', { class: 'pcard-role' }, role) : null,
      badgeSlot(userId)));
}

// ---------- Insígnias ----------
let badgeDefs = [];
const userBadges = new Map(); // userId -> { at, list }
async function loadBadgeDefs() {
  const { data } = await sb.from('badges').select('*').order('sort');
  badgeDefs = data || [];
}
async function getUserBadges(userId, fresh) {
  const c = userBadges.get(userId);
  if (c && !fresh && Date.now() - c.at < 60000) return c.list;
  const { data } = await sb.from('user_badges').select('badge_id, earned_at').eq('user_id', userId);
  const list = data || [];
  userBadges.set(userId, { at: Date.now(), list });
  return list;
}
// Espaço no cartão que se preenche quando as insígnias chegam
function badgeSlot(userId) {
  const slot = h('div', { class: 'badge-slot' });
  getUserBadges(userId).then((list) => {
    const row = badgeRow(badgeDefs, list);
    if (row) slot.append(row);
  }).catch(() => {});
  return slot;
}
function onBadgeEarned(row) {
  if (!row) return;
  userBadges.delete(me.id);
  const def = badgeDefs.find((d) => d.id === row.badge_id);
  if (!def) return;
  beep(660, 990);
  setTimeout(() => beep(990, 1320), 180);
  toast(`🏅 Nova insígnia: ${def.name}! ${def.description}.`, 5000);
}

// Todas as insígnias: as conquistadas coloridas, as que faltam apagadas com a dica de como ganhar
function allBadgesSection() {
  const grid = h('div', { class: 'badge-grid' }, h('p', { class: 'hint' }, 'Carregando…'));
  const box = h('div', { class: 'field' }, h('span', { class: 'label' }, 'Insígnias'), grid);
  getUserBadges(me.id, true).then((list) => {
    grid.innerHTML = '';
    const got = new Map(list.map((x) => [x.badge_id, x.earned_at]));
    for (const d of badgeDefs) {
      grid.append(h('div', { class: 'badge-cell' + (got.has(d.id) ? '' : ' locked') },
        badgeIcon(d, got.get(d.id)),
        h('div', { class: 'badge-info' },
          h('div', { class: 'badge-name' }, d.name, h('span', { class: 'rarity r-' + d.rarity }, RARITY_LABEL[d.rarity] || d.rarity)),
          h('div', { class: 'badge-desc' }, got.has(d.id) ? `${d.description} · ${new Date(got.get(d.id)).toLocaleDateString('pt-BR')}` : d.description))));
    }
    if (!badgeDefs.length) grid.append(h('p', { class: 'hint' }, 'As insígnias aparecem depois de rodar o SQL da v2.3.'));
  }).catch(() => { grid.innerHTML = ''; });
  return box;
}

function profileModal() {
  const draft = { avatar_url: me.avatar_url || null, banner_url: me.banner_url || null };
  const pending = { avatar: null, banner: null };    // arquivos novos escolhidos
  const remove = { avatar: false, banner: false };
  const urls = [];
  const name = h('input', { maxlength: '32', value: me.display_name });
  const preview = h('div', { class: 'pcard pcard-preview' });
  const msg = h('p', { class: 'msg' });

  const render = () => {
    preview.innerHTML = '';
    const av = pending.avatar ? pending.avatar.url : remove.avatar ? null : draft.avatar_url;
    const bn = pending.banner ? pending.banner.url : remove.banner ? null : draft.banner_url;
    preview.append(
      h('div', { class: 'pcard-banner', style: { background: bn ? 'var(--bg-0)' : colorFor(me.id) } }, bn ? h('img', { src: bn, alt: '' }) : null),
      h('div', { class: 'pcard-body' },
        avatar(me.id, name.value || me.display_name, 'xl', av, statusOf(me.id)),
        h('div', { class: 'pcard-name' }, name.value || me.display_name),
        h('div', { class: 'pcard-status' }, statusDot(statusOf(me.id)), STATUS[statusOf(me.id)].label)));
  };
  name.addEventListener('input', render);

  const picker = (kind) => {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true });
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      msg.textContent = '';
      try {
        const out = await prepareImage(file, kind);
        const url = URL.createObjectURL(out.blob);
        urls.push(url);
        pending[kind] = { ...out, url };
        remove[kind] = false;
        render();
      } catch (err) { msg.textContent = err.message; }
    });
    return input;
  };
  const avIn = picker('avatar');
  const bnIn = picker('banner');
  const btnRow = (label, input, kind) => h('div', { class: 'pbtn-row' },
    h('span', { class: 'label' }, label),
    h('button', { type: 'button', class: 'btn secondary', onClick: () => input.click() }, 'Trocar'),
    h('button', { type: 'button', class: 'btn secondary', onClick: () => { pending[kind] = null; remove[kind] = true; render(); } }, 'Remover'),
    input);

  const save = h('button', { class: 'btn primary' }, 'Salvar');
  openModal({
    title: 'Seu perfil',
    body: [
      preview,
      btnRow('Foto de perfil', avIn, 'avatar'),
      btnRow('Banner', bnIn, 'banner'),
      h('p', { class: 'hint' }, 'PNG, JPG, WebP ou GIF. Foto até 4 MB e banner até 8 MB. GIF continua animado.'),
      field('Nome de exibição', name),
      allBadgesSection(),
      msg
    ],
    actions: [h('button', { class: 'btn secondary', onClick: closeModal }, 'Cancelar'), save]
  });
  render();

  save.addEventListener('click', async () => {
    const v = name.value.trim();
    if (!v) { msg.textContent = 'Coloque um nome.'; return; }
    save.disabled = true;
    save.textContent = 'Salvando…';
    msg.textContent = '';
    const patch = { display_name: v };
    const toDelete = [];
    try {
      for (const kind of ['avatar', 'banner']) {
        const col = kind + '_url';
        if (pending[kind]) {
          const path = `${me.id}/${kind}-${Date.now()}.${pending[kind].ext}`;
          const up = await sb.storage.from('perfis').upload(path, pending[kind].blob, { contentType: pending[kind].type, cacheControl: '31536000', upsert: false });
          if (up.error) throw new Error('Falha ao enviar a imagem: ' + up.error.message);
          patch[col] = sb.storage.from('perfis').getPublicUrl(path).data.publicUrl;
          if (me[col]) toDelete.push(storagePath(me[col]));
        } else if (remove[kind]) {
          patch[col] = null;
          if (me[col]) toDelete.push(storagePath(me[col]));
        }
      }
      const { error } = await sb.from('profiles').update(patch).eq('id', me.id);
      if (error) throw new Error('Não foi possível salvar o perfil.');
      const old = toDelete.filter(Boolean);
      if (old.length) sb.storage.from('perfis').remove(old).catch(() => {});
      Object.assign(me, patch);
      setProf(me);
      renderMe();
      closeModal();
      urls.forEach((u) => URL.revokeObjectURL(u));
      loadMembers();
      toast('Perfil atualizado!');
    } catch (err) {
      msg.textContent = err.message;
      save.disabled = false;
      save.textContent = 'Salvar';
    }
  });
}

function notifModal() {
  const prefs = notifPrefs();
  const supported = 'Notification' in window;
  const desktop = h('input', { type: 'checkbox', checked: prefs.desktop && supported && Notification.permission === 'granted', disabled: !supported });
  const sound = h('input', { type: 'checkbox', checked: prefs.sound });
  const msg = h('p', { class: 'msg' });
  const modes = [['all', 'Todas as mensagens'], ['mentions', 'Só quando me marcarem (@)'], ['none', 'Nada']];
  const radios = modes.map(([v, label]) => {
    const r = h('input', { type: 'radio', name: 'notif-mode', value: v, checked: prefs.mode === v });
    return h('label', { class: 'check' }, r, label);
  });
  const save = () => {
    const mode = (document.querySelector('input[name="notif-mode"]:checked') || {}).value || 'mentions';
    saveNotifPrefs({ desktop: desktop.checked, mode, sound: sound.checked });
  };
  desktop.addEventListener('change', async () => {
    if (desktop.checked && Notification.permission !== 'granted') {
      const res = await Notification.requestPermission();
      if (res !== 'granted') {
        desktop.checked = false;
        msg.textContent = 'O navegador bloqueou as notificações. Libere no cadeado ao lado do endereço do site.';
      }
    }
    save();
  });
  sound.addEventListener('change', save);
  radios.forEach((l) => l.querySelector('input').addEventListener('change', save));
  openModal({
    title: 'Notificações',
    body: [
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Me avisar de'), ...radios),
      h('label', { class: 'check' }, desktop, 'Mostrar aviso no computador quando o Resenha estiver em segundo plano'),
      h('label', { class: 'check' }, sound, 'Tocar som'),
      supported ? null : h('p', { class: 'hint' }, 'Este navegador não suporta avisos no computador.'),
      h('p', { class: 'hint' }, 'No status "Não perturbe" nada toca nem aparece, só o contador nas salas.'),
      msg
    ],
    actions: [h('button', { class: 'btn primary', onClick: closeModal }, 'Pronto')]
  });
}

async function settingsModal() {
  const s = loadSettings();
  const mk = async (kind, label) => {
    const sel = h('select');
    sel.append(h('option', { value: '' }, 'Padrão do sistema'));
    for (const d of await listDevices(kind)) {
      if (d.deviceId === 'default') continue;
      sel.append(h('option', { value: d.deviceId }, d.label || `${label} ${sel.options.length}`));
    }
    sel.value = s[kind] || '';
    sel.addEventListener('change', () => switchDevice(kind, sel.value));
    return field(label, sel);
  };
  const filters = [['echoCancellation', 'Cancelamento de eco'], ['noiseSuppression', 'Supressão de ruído'], ['autoGainControl', 'Ajuste automático de volume do microfone']]
    .map(([k, label]) => {
      const cb = h('input', { type: 'checkbox', checked: s[k] });
      cb.addEventListener('change', async () => {
        const cur = loadSettings(); cur[k] = cb.checked; saveSettings(cur);
        await applyAudioFilters();
      });
      return h('label', { class: 'check' }, cb, label);
    });
  const meter = h('div', { class: 'meter' }, h('div'));
  const body = [
    await mk('audioinput', 'Microfone'),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Teste do microfone'), meter),
    await mk('audiooutput', 'Saída de áudio'),
    await mk('videoinput', 'Câmera'),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Processamento de voz'), ...filters),
    h('p', { class: 'hint' }, 'Se os nomes dos dispositivos não aparecerem, permita o microfone no navegador e abra de novo.')
  ];
  openModal({ title: 'Áudio e vídeo', body, actions: [h('button', { class: 'btn primary', onClick: closeModal }, 'Pronto')] });
  // Medidor de volume do microfone
  let stream, raf, actx;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: s.audioinput || undefined } });
    actx = new AudioContext();
    const an = actx.createAnalyser();
    an.fftSize = 512;
    actx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const bar = meter.firstChild;
    const loop = () => {
      if (!meter.isConnected) { stream.getTracks().forEach((t) => t.stop()); actx.close(); return; }
      an.getByteTimeDomainData(buf);
      let sum = 0; for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
      bar.style.width = Math.min(100, Math.sqrt(sum / buf.length) * 400) + '%';
      raf = requestAnimationFrame(loop);
    };
    loop();
  } catch (_) {}
}

function dmMenu() {
  const items = [{ label: 'Nova conversa ou grupo', onClick: newDmModal }];
  if (current && isDm(current)) {
    items.push({ label: 'Sorteios', onClick: () => openDrawModal('teams') });
    const mine = myMember();
    const leave = async (label) => {
      if (!(await confirmModal({ title: `${label}?`, text: current.kind === 'group' ? 'Você sai do grupo e para de receber as mensagens.' : 'A conversa some da sua lista. Se alguém mandar mensagem de novo, ela volta.', confirm: label, danger: true }))) return;
      try {
        const id = current.id;
        if (call.roomId === id) await leaveCall();
        await rpc(mine && mine.base_role === 'owner' ? 'delete_room' : 'leave_room', { p_room: id });
        await loadRooms();
        if (dms[0]) openRoom(dms[0].id); else renderEmptyDm();
      } catch (err) { toast(err.message); }
    };
    items.push('sep');
    if (current.kind === 'group') items.push({ label: mine && mine.base_role === 'owner' ? 'Apagar grupo' : 'Sair do grupo', danger: true, onClick: () => leave(mine && mine.base_role === 'owner' ? 'Apagar grupo' : 'Sair do grupo') });
    else items.push({ label: 'Fechar conversa', danger: true, onClick: () => leave('Fechar conversa') });
  }
  openMenu($('room-menu-btn'), items);
}

function roomMenu() {
  if (mode === 'dms') { dmMenu(); return; }
  if (!current) return;
  const mine = myMember();
  const items = [{ label: 'Convidar pessoas', onClick: inviteModal }, { label: 'Sorteios', onClick: () => openDrawModal('teams') }];
  if (mine && mine.base_role === 'owner') items.push({ label: 'Configurações da sala', onClick: roomSettingsModal });
  if (can('manage_roles')) items.push({ label: 'Cargos', onClick: rolesModal });
  if (can('ban')) items.push({ label: 'Banidos', onClick: bansModal });
  if (mine && mine.base_role !== 'owner') {
    items.push('sep', { label: 'Sair da sala', danger: true, onClick: async () => {
      if (!(await confirmModal({ title: `Sair de ${current.name}?`, text: 'Você pode voltar depois com um convite.', confirm: 'Sair', danger: true }))) return;
      try {
        if (call.roomId === current.id) await leaveCall();
        await rpc('leave_room', { p_room: current.id });
        await loadRooms();
        if (rooms[0]) openRoom(rooms[0].id); else renderEmpty();
      } catch (err) { toast(err.message); }
    } });
  }
  openMenu($('room-menu-btn'), items);
}

function meMenu() {
  const items = [{ node: profileCard(me.id, me.display_name, myMember()) }, { title: 'Status' }];
  for (const k of ['online', 'idle', 'dnd', 'invisible']) {
    const b = h('button', { class: 'menu-item status-item' + (myStatus === k ? ' selected' : ''), role: 'menuitemradio', 'aria-checked': String(myStatus === k) },
      statusDot(k === 'invisible' ? 'offline' : k),
      h('span', { class: 'status-text' }, h('span', null, STATUS[k].label), STATUS[k].hint ? h('small', null, STATUS[k].hint) : null));
    b.addEventListener('click', () => { closeMenu(); setMyStatus(k); });
    items.push({ node: b });
  }
  items.push('sep',
    { label: 'Editar perfil', onClick: profileModal },
    { label: 'Notificações', onClick: notifModal },
    { label: 'Áudio e vídeo', onClick: settingsModal });
  if (installPrompt) items.push({ label: 'Instalar app no PC', onClick: installApp });
  items.push('sep', { label: 'Sair da conta', danger: true, onClick: async () => { if (call.room) await leaveCall(true); await sb.auth.signOut(); location.reload(); } });
  openMenu($('me-btn'), items, { above: true });
}

// ---------- Botões fixos ----------
function wireStatic() {
  wireChat();
  $('create-room-btn').addEventListener('click', createRoomModal);
  $('explore-btn').addEventListener('click', exploreModal);
  $('room-menu-btn').addEventListener('click', roomMenu);
  $('me-btn').addEventListener('click', meMenu);
  $('ch-chat').addEventListener('click', () => current && setView('chat'));
  $('ch-updates').addEventListener('click', () => setView('updates'));
  loadUpdates();
  $('ch-call').addEventListener('click', () => {
    if (!current) return;
    if (call.room && call.roomId === current.id) setView('call');
    else enterCall();
  });
  $('join-call-btn').addEventListener('click', enterCall);
  $('call-card-join').addEventListener('click', enterCall);
  $('invite-btn').addEventListener('click', () => {
    if (mode === 'dms') { newDmModal(); return; }
    if (current) inviteModal(); else toast('Entre numa sala primeiro.');
  });
  $('dm-btn').addEventListener('click', () => {
    if (innerWidth <= 560 && mode === 'dms') { $('app').classList.toggle('show-side'); return; }
    showDms();
    if (innerWidth <= 560) $('app').classList.add('show-side');
  });
  $('dm-new').addEventListener('click', newDmModal);
  $('dm-search').addEventListener('input', renderDmList);
  $('chat-search-btn').addEventListener('click', openMessageSearch);
  $('pins-btn').addEventListener('click', openPinsModal);
  $('shop-btn').hidden = false;
  $('shop-btn').addEventListener('click', openShop);
  setupThemeToggle($('theme-btn'));
  $('mic-btn').addEventListener('click', toggleMic);
  $('mic-btn-2').addEventListener('click', toggleMic);
  $('deaf-btn').addEventListener('click', () => setDeafened(!call.deafened));
  $('settings-btn').addEventListener('click', settingsModal);
  $('cam-btn').addEventListener('click', toggleCam);
  $('cam-btn-2').addEventListener('click', toggleCam);
  $('speaker-btn-2').addEventListener('click', () => setDeafened(!call.deafened));
  $('screen-btn').addEventListener('click', toggleScreen);
  $('screen-btn-2').addEventListener('click', toggleScreen);
  $('hangup-btn').addEventListener('click', () => leaveCall().then(startPreviewPolling));
  $('hangup-btn-2').addEventListener('click', () => leaveCall().then(startPreviewPolling));
  $('stage-prev').addEventListener('click', () => moveStageFocus(-1));
  $('stage-next').addEventListener('click', () => moveStageFocus(1));
  $('call-chat-btn').addEventListener('click', () => current && setView('chat'));
  $('return-call-btn').addEventListener('click', () => call.room && setView('call'));
  $('members-toggle').addEventListener('click', () => {
    const p = $('members-panel');
    if (innerWidth <= 1100) p.classList.toggle('open');
    else p.classList.toggle('closed');
    const shown = innerWidth <= 1100 ? p.classList.contains('open') : !p.classList.contains('closed');
    $('members-toggle').classList.toggle('pressed', shown);
  });
  if (innerWidth <= 1100) $('members-toggle').classList.remove('pressed');
  $('side-toggle').addEventListener('click', () => {
    const app = $('app');
    const open = app.classList.toggle('show-side');
    $('side-toggle').setAttribute('aria-expanded', String(open));
  });
  $('mobile-backdrop').addEventListener('click', () => {
    $('app').classList.remove('show-side');
    $('side-toggle').setAttribute('aria-expanded', 'false');
  });
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !$('app').classList.contains('show-side')) return;
    $('app').classList.remove('show-side');
    $('side-toggle').setAttribute('aria-expanded', 'false');
    $('side-toggle').focus();
  });
  $('vb-sub').addEventListener('click', () => { if (call.roomId) { openRoom(call.roomId); } });
  window.addEventListener('beforeunload', () => { if (call.room) call.room.disconnect(); });
}
