// Resenha v2 — app principal: login, salas, cargos, chat salvo e call.
import { createClient } from '@supabase/supabase-js';
import {
  $, h, ICON, avatar, colorFor, toast, openMenu, closeMenu, openModal, closeModal, confirmModal,
  field, linkify, fmtTime, STATUS, statusDot, setBeepsMuted, beep, initRipple, setupThemeToggle, fxHook
} from './ui.js';
import { prepareImage, prepareChatImage, storagePath } from './profile.js';
import { openEmojiPicker } from './emoji.js';
import { badgeIcon, badgeRow, RARITY_LABEL } from './badges.js';
import { COMMANDS, parseCommand, resultCard, BOT_ICON } from './draw.js';
import { createChatCache } from './chat-cache.js';
import { initTheme, attachAccount, resolvedTheme, setPrefs } from './theme.js';
import { openConfig, openShell, closeConfig } from './config.js';
import { initShopFx, onShopFx, shopRoom, shopLeave, owns, nickFor, isPink, decorateAvatar, getVaquinha, loadVaquinha, fire, CHAT_EFFECTS, SOUNDS, VOICES } from './shop-fx.js';
import { canZoeira } from './zoeira-rules.js';
import { initMusic, musicJoin, musicLeave, mountMusicPanel, setPanelOpen, setPanelView, setModerator, parseMusic, runChatCommand, musicCard, MUSIC_COMMANDS, onMusic, setMusicHooks, refreshMusicPanel } from './music.js';
import { moveFocus } from './focus-navigation.js';
import {
  call, joinCall, leaveCall, toggleMic, setDeafened, toggleCam, toggleScreen, participants, renderStage, togglePin,
  getVolume, setVolume, loadSettings, saveSettings, switchDevice, applyAudioFilters, listDevices, sendZoeira, setVoiceEffect, applyMicChain
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
class NickMap extends Map { get(id) { return nickFor(id) || super.get(id); } } // apelido forçado (Loja) vale em todo lugar
const names = new NickMap();    // id -> display_name
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
  initTheme();
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
  $('auth-screen').classList.toggle('auth-solo', isForgot || isReset);
  $('auth-title').textContent = isSignup ? 'Criar conta' : isForgot ? 'Esqueceu a senha?' : isReset ? 'Nova senha' : 'Bem-vindo de volta';
  $('auth-sub').textContent = isSignup ? 'É de graça e leva 30 segundos.' : isForgot ? 'Acontece. Coloca seu e-mail que a gente manda um link pra criar outra.' : isReset ? 'Escolha uma senha nova.' : 'Entre para ver suas salas.';
  $('auth-email-label').textContent = isForgot ? 'E-mail da conta' : 'E-mail';
  $('pass-meter').hidden = !(isSignup || isReset);
  $('auth-pass').minLength = isSignup || isReset ? 8 : 6;
  $('auth-pass').placeholder = isSignup || isReset ? 'Pelo menos 8 caracteres' : 'Sua senha';
  $('auth-pass').type = 'password';
  $('pass-eye').setAttribute('aria-pressed', 'false');
  $('name-field').hidden = !isSignup;
  $('auth-name').required = isSignup;
  $('email-field').hidden = isReset;
  $('auth-email').required = !isReset;
  $('pass-field').hidden = isForgot;
  $('auth-pass').required = !isForgot;
  $('auth-pass').autocomplete = isSignup || isReset ? 'new-password' : 'current-password';
  $('forgot-link').hidden = mode !== 'login';
  $('auth-submit').textContent = isSignup ? 'Criar conta' : isForgot ? 'Mandar link' : isReset ? 'Salvar senha' : 'Entrar';
  $('switch-text').textContent = isSignup ? 'Já tem conta?' : isForgot || isReset ? '' : 'Ainda não tem conta?';
  $('switch-btn').textContent = isSignup ? 'Entrar' : isForgot || isReset ? 'Voltar pro login' : 'Criar conta';
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
$('pass-eye').addEventListener('click', () => {
  const shown = $('auth-pass').type === 'text';
  $('auth-pass').type = shown ? 'password' : 'text';
  $('pass-eye').setAttribute('aria-pressed', String(!shown));
  $('pass-eye').setAttribute('aria-label', shown ? 'Mostrar a senha' : 'Esconder a senha');
});
$('auth-pass').addEventListener('input', () => {
  const v = $('auth-pass').value;
  let score = 0;
  if (v.length >= 8) score += 1;
  if (v.length >= 12) score += 1;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score += 1;
  if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) score += 1;
  $('pass-meter').dataset.score = String(v ? score : 0);
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

  attachAccount(sb, session.user);
  const uid = session.user.id;
  let prof = null;
  for (let i = 0; i < 5 && !prof; i++) {
    const { data } = await sb.from('profiles').select('id, display_name, avatar_url, banner_url, bio, accent_color').eq('id', uid).maybeSingle();
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
  fxHook.avatar = decorateAvatar;
  initShopFx({ sb, me });
  onShopFx(() => { if (members.length) renderMembers(); if (view === 'shop') renderShop(); paintCallTools(); });
  initMusic({ sb, api, me, participants: () => participants().map((x) => ({ identity: x.identity, name: x.name })), nameOf: (id) => names.get(id) || (profs.get(id) || {}).display_name || 'alguém' });
  mountMusicPanel(document.body);
  setMusicHooks({
    isPinned: () => call.pinned.includes('watch'),
    togglePin: () => { togglePin('watch'); setTimeout(refreshMusicPanel, 400); },
    onClose: () => { actOpen = false; for (const o of document.querySelectorAll('.act-tab')) o.classList.toggle('on', o.dataset.act === 'call'); applyAct(); }
  });
  // Vídeo do "Assistir junto" vira um quadro da call (dá para fixar como principal). Ao começar, já entra fixado para todo mundo.
  let wasWatching = false;
  onMusic((state) => {
    const watching = Boolean(state && state.current && state.mode === 'watch');
    call.watch = watching;
    if (watching && !wasWatching) { if (!call.pinned.includes('watch')) call.pinned = [...call.pinned, 'watch'].slice(-4); }
    if (!watching) call.pinned = call.pinned.filter((k) => k !== 'watch');
    wasWatching = watching;
    if (view === 'call' && call.room) renderStage();
    refreshMusicPanel();
  });
  call.avatarUrl = (id) => (profs.get(id) || {}).avatar_url || null;
  call.onPersonClick = (tile, id) => memberMenu(tile, id);
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
  maybeOnboard();
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
  const a = avatar(id, name || p.display_name || names.get(id), cls, p.avatar_url, withStatus ? statusOf(id) : null);
  if (!p.avatar_url && p.accent_color) a.style.background = p.accent_color;
  return a;
}

function renderMe() {
  $('me-name').textContent = me.display_name;
  const a = avatarOf(me.id, me.display_name, '', true);
  a.id = 'me-avatar';
  $('me-avatar').replaceWith(a);
  paintMeSub();
}
// Rodapé: Online / Mutado / Sem áudio (o status escolhido aparece quando o áudio está normal)
function paintMeSub() {
  const el = document.querySelector('.me-sub');
  if (!el || !me) return;
  el.textContent = call.deafened ? 'Sem áudio' : call.muted ? 'Mutado' : STATUS[shownStatus()].label;
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
    .select('joined_at, rooms(id, name, is_public, invite_code, owner_id, kind, description, category, color, icon_url, vaquinha_goal_cents)')
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

// ---------- Loja ----------
let bannerTimer = null;
let shopCategory = 'Destaques';
let shopSelectedId = 'chapeu';
let shopTargetId = null;
let shopReturnView = 'chat';
const SHOP_CATEGORIES = ['Destaques', 'Zoeira', 'Efeitos de tela', 'Telão', 'Call', 'Sala · vaquinha', 'Estilo'];
const SHOP_PRODUCTS = [
  { id: 'chapeu', name: 'Chapéu de palhaço', category: 'Zoeira', description: 'Coloca um chapéu de palhaço na foto do amigo por 24 horas.', cents: 99, period: '24 H', art: '🤡', featured: true, target: 'member' },
  { id: 'nome-rosa', name: 'Nome rosa-chiclete', category: 'Zoeira', description: 'O nome do amigo fica rosa-chiclete no chat e na lista por 24 horas.', cents: 49, period: '24 H', art: 'Caio', featured: true, target: 'member' },
  { id: 'apelido', name: 'Apelido forçado', category: 'Zoeira', description: 'O amigo vira Pé-frio, ou o que você escrever, por 1 hora.', cents: 99, period: '1 H', art: 'Pé-frio', featured: true, target: 'member' },
  { id: 'fantasma', name: 'Modo fantasma', category: 'Zoeira', description: 'A foto do amigo some e vira um fantasminha por 1 hora.', cents: 49, period: '1 H', art: '👻', featured: true, target: 'member' },
  { id: 'espelho', name: 'Espelho', category: 'Zoeira', description: 'A próxima zoeira que mandarem pra você volta pra quem mandou.', cents: 99, period: 'DEFESA', art: '🛡️', featured: true, target: 'self' },
  { id: 'gol', name: '/gol', category: 'Efeitos de tela', description: 'A tela de todo mundo treme, explode GOOOL e cai confete.', cents: 99, art: 'GOOOL', featured: true, target: 'room' },
  { id: 'parabens', name: '/parabéns', category: 'Efeitos de tela', description: 'Balões sobem na tela da sala inteira.', cents: 99, art: '🎈', target: 'room' },
  { id: 'f', name: '/F', category: 'Efeitos de tela', description: 'Chuva de flores pra quem perdeu a aposta.', cents: 99, art: 'F', target: 'room' },
  { id: 'terremoto', name: '/terremoto', category: 'Efeitos de tela', description: 'A sala inteira chacoalha por 3 segundos.', cents: 99, art: '〰️', target: 'room' },
  { id: 'pacote-efeitos', name: 'Pacote de efeitos', category: 'Efeitos de tela', description: 'Os quatro efeitos de tela por um preço só.', cents: 249, art: '/gol · /parabéns · /F · /terremoto', badge: 'MAIS VANTAJOSO', target: 'room' },
  { id: 'telao', name: 'Telão da sala', category: 'Telão', description: 'Sua mensagem num letreiro animado no topo da sala por 24 horas.', cents: 50, period: '24 H', art: '★ CAIO DEVE 20 CONTO ★', featured: true, target: 'room' },
  { id: 'entrada', name: 'Entrada triunfal', category: 'Call', description: 'Quando você entra na call, todo mundo vê seu card com holofote.', cents: 199, art: 'CHEGOU O CRAQUE', target: 'self' },
  { id: 'voz', name: 'Voz zoada', category: 'Call', description: 'Robô, esquilo, monstro ou rádio de pinga. Liga e desliga na call.', cents: 149, art: '🤖 🐿️ 📻', target: 'self' },
  { id: 'soundboard', name: 'Soundboard', category: 'Call', description: 'Buzina de estádio, tambor de suspense, risada de plateia e mais sons.', cents: 199, art: '🔊', target: 'self' },
  { id: 'mascote', name: 'Mascote da sala', category: 'Sala · vaquinha', description: 'Ajude a vaquinha coletiva a alimentar o mascote da sala.', cents: 50, art: '🐝', target: 'room' },
  { id: 'estilo', name: 'Moldura brilhante', category: 'Estilo', description: 'Uma moldura especial para destacar seu perfil.', cents: 99, art: '✦', target: 'self' }
];
const shopMoney = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

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

let shopMonthTotal = null;   // arrecadado no mês (centavos), vindo do banco
let shopOwnedCount = null;   // quantos itens pagos eu tenho
async function startCheckout(item, extra = {}) {
  if (!cfg.shopReady) { toast('Pagamento ainda não configurado; nenhuma cobrança foi feita.'); return; }
  if (!current || isDm(current)) { toast('Entre em uma sala primeiro.'); return; }
  try {
    const { url } = await api('/api/checkout', { roomId: current.id, itemId: item.id, ...extra });
    location.assign(url);
  } catch (err) { toast(err.message, 4500); }
}
let shopNickText = '';
const OWNABLE = (item) => !['chapeu', 'nome-rosa', 'apelido', 'fantasma', 'telao', 'mascote'].includes(item.id);

function openShop() {
  if (view !== 'shop') shopReturnView = view;
  setView('shop');
  renderShop();
  sb.rpc('shop_month_total').then(({ data }) => { if (typeof data === 'number' || typeof data === 'string') { shopMonthTotal = Number(data); if (view === 'shop') renderShop(); } }, () => {});
  sb.from('purchases').select('id', { count: 'exact', head: true }).eq('buyer_id', me.id).eq('status', 'paid').then(({ count }) => { if (count != null) { shopOwnedCount = count; if (view === 'shop') renderShop(); } }, () => {});
}

// Anel de custos do mês: só mostra número quando o custo mensal foi informado no servidor
function shopCostRing() {
  const cost = cfg.shopMonthlyCostCents || 0;
  if (!cost || shopMonthTotal == null) {
    return h('div', { class: 'shop-cost' }, h('div', { class: 'shop-cost-ring', 'aria-label': 'Custos do mês em breve' }, '—'),
      h('div', null, h('strong', null, 'Custos deste mês'), h('span', null, 'Os valores da comunidade aparecem aqui quando estiverem disponíveis.')));
  }
  const pct = Math.max(0, Math.min(100, Math.round((shopMonthTotal / cost) * 100)));
  const C = 2 * Math.PI * 46;
  const ring = h('div', { class: 'shop-ring2', role: 'img', 'aria-label': `${pct}% dos custos do mês cobertos`,
    html: `<svg viewBox="0 0 108 108" width="108" height="108"><circle cx="54" cy="54" r="46" fill="none" stroke="var(--bg-active)" stroke-width="8"/><circle cx="54" cy="54" r="46" fill="none" stroke="var(--green)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct / 100)).toFixed(1)}" transform="rotate(-90 54 54)"/></svg><span><b>${pct}%</b><small>do mês</small></span>` });
  return h('div', { class: 'shop-cost' }, ring,
    h('div', null, h('strong', null, 'Custos deste mês'), h('code', null, `${shopMoney(shopMonthTotal)} de ${shopMoney(cost)}`), h('span', null, 'Servidor, banco e call. Atualiza sozinho.')));
}

// Compra em janela (celular e quando a coluna do item não aparece)
function openShopItemModal(item) {
  let targetId = shopTargetId;
  const people = members.filter((m) => m.user_id !== me?.id);
  const art = shopArt(item);
  const buy = h('button', { class: 'btn primary block shop-buy', type: 'button' });
  const pills = h('div', { class: 'shop-recipients' });
  const paint = () => {
    const target = people.find((m) => m.user_id === targetId) || people[0];
    if (target) targetId = target.user_id;
    pills.replaceChildren(...people.map((person) => {
      const pill = h('button', { class: 'shop-recipient' + (target && target.user_id === person.user_id ? ' active' : ''), type: 'button', 'aria-pressed': String(Boolean(target && target.user_id === person.user_id)) }, avatarOf(person.user_id, person.name, 'sm'), person.name);
      pill.addEventListener('click', () => { targetId = person.user_id; shopTargetId = targetId; paint(); });
      return pill;
    }));
    buy.textContent = item.target === 'member' ? `Zoar ${target ? target.name : ''} por ${shopMoney(item.cents)}` : item.id === 'telao' ? `Destacar por ${shopMoney(item.cents)}` : `Escolher por ${shopMoney(item.cents)}`;
  };
  paint();
  buy.addEventListener('click', () => {
    if (item.id === 'telao') { closeModal(); if (!current || isDm(current)) { toast('Entre em uma sala para personalizar o Telão.'); return; } openTelaoPurchase({ name: item.name, price_cents: item.cents }); return; }
    if (OWNABLE(item) && owns(item.id)) { toast('Você já tem esse item.'); return; }
    closeModal();
    startCheckout(item, { recipientId: item.target === 'member' ? targetId : undefined, text: item.id === 'apelido' ? shopNickText : undefined });
  });
  openModal({
    title: item.name,
    body: [art, h('div', { class: 'shop-modal-price' }, h('span', { class: 'muted' }, item.description), h('strong', { class: 'shop-price' }, shopMoney(item.cents))),
      item.id === 'apelido' ? field('Qual apelido?', Object.assign(h('input', { maxlength: '20', placeholder: 'Pé-frio', value: shopNickText }), { oninput(e) { shopNickText = e.target.value; } })) : null,
      item.target === 'member' ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Quem vai ser zoado?'), people.length ? pills : h('span', { class: 'shop-empty' }, 'Entre em uma sala para escolher alguém.')) : null,
      buy,
      h('p', { class: 'shop-payment-note' }, cfg.shopReady ? 'Pagamento único.' : 'O pagamento ainda não está configurado: nenhuma cobrança é feita.')]
  });
}

function renderShop() {
  const root = $('shop-view');
  if (!root) return;
  root.replaceChildren();
  const selected = SHOP_PRODUCTS.find((x) => x.id === shopSelectedId) || SHOP_PRODUCTS[0];
  const head = h('header', { class: 'shop-page-head' },
    h('button', { class: 'btn secondary shop-back', onClick: () => setView(shopReturnView) }, '‹ Voltar'),
    h('h1', null, 'Loja'),
    h('span', { class: 'shop-head-spacer' }),
    h('button', { class: 'btn secondary', onClick: openMyShopItems }, `♧ Meus itens${shopOwnedCount != null ? ' · ' + shopOwnedCount : ''}`));

  const fund = h('section', { class: 'shop-fund' },
    h('div', { class: 'shop-fund-copy' },
      h('span', { class: 'shop-eyebrow' }, 'VALORES SIMBÓLICOS'),
      h('h2', null, 'Zoar os amigos custa trocado'),
      h('p', null, 'O Resenha é feito por amigos e continua de graça. Tudo aqui é opcional: quem compra ajuda a pagar o servidor e a call enquanto o projeto cresce. Nada dá vantagem, é só diversão. Paga uma vez, sem assinatura.')),
    shopCostRing());

  const tabs = h('nav', { class: 'shop-tabs', 'aria-label': 'Categorias da Loja' });
  for (const category of SHOP_CATEGORIES) {
    const tab = h('button', { class: 'shop-tab' + (shopCategory === category ? ' active' : ''), type: 'button', 'aria-pressed': shopCategory === category }, category);
    tab.addEventListener('click', () => {
      shopCategory = category;
      const first = category === 'Destaques' ? SHOP_PRODUCTS.find((x) => x.featured) : SHOP_PRODUCTS.find((x) => x.category === category);
      if (first) shopSelectedId = first.id;
      renderShop();
    });
    tabs.append(tab);
  }
  const rule = h('div', { class: 'shop-rule' }, h('strong', null, 'Zoeira tem regra.'), ' Toda zoeira mostra quem mandou e some sozinha. Quem não curte desliga no perfil, de graça.');
  const list = h('div', { class: 'shop-catalog' });
  const products = shopCategory === 'Destaques' ? SHOP_PRODUCTS.filter((x) => x.featured) : SHOP_PRODUCTS.filter((x) => x.category === shopCategory);
  if (!products.length) list.append(h('p', { class: 'shop-empty' }, 'Novos itens dessa categoria aparecem aqui em breve.'));
  for (const item of products) {
    const card = h('button', { class: 'shop-card' + (selected.id === item.id ? ' selected' : ''), type: 'button', 'aria-pressed': selected.id === item.id },
      shopArt(item),
      h('span', { class: 'shop-card-name' }, item.name),
      h('span', { class: 'shop-card-desc' }, item.description),
      OWNABLE(item) && owns(item.id) ? h('strong', { class: 'shop-price shop-owned' }, 'Já é seu') : h('strong', { class: 'shop-price' }, shopMoney(item.cents)));
    card.addEventListener('click', () => { shopSelectedId = item.id; if (innerWidth <= 720) { openShopItemModal(item); return; } renderShop(); });
    list.append(card);
  }
  const content = h('div', { class: 'shop-content' },
    h('div', { class: 'shop-browse' }, tabs, rule, list),
    h('aside', { class: 'shop-detail-column' }, renderShopDetail(selected), renderShopActivity()));
  root.append(head, fund, content);
  if (current && !isDm(current)) loadShopActivity(root.querySelector('.shop-activity'), current.id);
}

function shopArt(item) {
  return h('span', { class: `shop-art shop-art-${item.id}`, 'aria-hidden': 'true' },
    item.period ? h('small', { class: 'shop-period' }, item.period) : null,
    item.badge ? h('small', { class: 'shop-art-badge' }, item.badge) : null,
    h('span', { class: 'shop-art-label' }, item.art));
}

// Vaquinha da sala: mascote, barra da meta e quem mais ajudou
function vaquinhaBlock() {
  const box = h('div', { class: 'vaq' });
  const v = getVaquinha();
  if (!v) { box.append(h('p', { class: 'shop-empty' }, current && !isDm(current) ? 'Carregando a vaquinha…' : 'Entre em uma sala para ver a vaquinha.')); if (current && !isDm(current)) loadVaquinha(); return box; }
  const pct = Math.round((v.progress / v.goal) * 100);
  box.append(h('div', { class: 'vaq-mascot', 'aria-hidden': 'true' }, '🐝'),
    h('div', { class: 'vaq-bar', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('i', { style: { width: pct + '%' } })),
    h('div', { class: 'vaq-meta' }, h('code', null, `${shopMoney(v.progress)} de ${shopMoney(v.goal)}`), h('span', null, v.level ? `${v.level}x batida` : 'Ajude a bater a meta')),
    ...(v.top || []).slice(0, 3).map((t) => h('small', { class: 'vaq-top' }, `${t.name} · ${shopMoney(t.cents)}`)));
  return box;
}

// Soundboard e voz zoada na barra da call (só para quem comprou)
function paintCallTools() {
  const bar = $('stage-bar');
  if (!bar) return;
  let sb_ = $('sb-btn'), vz = $('voice-btn');
  const ensure = (id, label, html, onClick) => {
    let b = $(id);
    if (!b) { b = h('button', { class: 'round', id, 'aria-label': label, title: label, html }); b.addEventListener('click', onClick); $('screen-btn-2').after(b); }
    return b;
  };
  sb_ = ensure('sb-btn', 'Soundboard', '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12"/></svg>', () => soundboardMenu($('sb-btn')));
  vz = ensure('voice-btn', 'Voz zoada', '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8"/></svg>', () => voiceMenu($('voice-btn')));
  sb_.hidden = !owns('soundboard');
  vz.hidden = !owns('voz');
}
function soundboardMenu(anchor) {
  const items = SOUNDS.map(([id, label]) => ({ label, onClick: () => fire(call.roomId, 'soundboard', { sound: id }).catch((err) => toast(err.message, 3000)) }));
  openMenu(anchor, items, { above: true });
}
let currentVoice = 'normal';
function voiceMenu(anchor) {
  openMenu(anchor, VOICES.map(([id, label]) => ({ label: (currentVoice === id ? '✓ ' : '') + label, onClick: async () => {
    if (await setVoiceEffect(id)) { currentVoice = id; toast(id === 'normal' ? 'Voz normal.' : `Voz: ${label}`); }
  } })), { above: true });
}

function renderShopDetail(item) {
  const detail = h('section', { class: 'shop-detail' }, shopArt(item),
    h('span', { class: 'shop-detail-category' }, item.category.toUpperCase()),
    h('h2', null, item.name),
    h('p', null, item.description));
  let targetName = 'sua sala';
  if (item.target === 'member') {
    const people = members.filter((m) => m.user_id !== me?.id);
    const target = people.find((m) => m.user_id === shopTargetId) || people[0];
    if (target) { shopTargetId = target.user_id; targetName = target.name; }
    detail.append(h('strong', { class: 'shop-field-title' }, 'Quem vai ser zoado?'));
    const recipients = h('div', { class: 'shop-recipients' });
    if (people.length) for (const person of people) {
      const pill = h('button', { class: 'shop-recipient' + (target && target.user_id === person.user_id ? ' active' : ''), type: 'button', 'aria-pressed': Boolean(target && target.user_id === person.user_id) }, avatarOf(person.user_id, person.name, 'sm'), person.name);
      pill.addEventListener('click', () => { shopTargetId = person.user_id; renderShop(); });
      recipients.append(pill);
    } else recipients.append(h('span', { class: 'shop-empty' }, 'Entre em uma sala para escolher alguém.'));
    detail.append(recipients);
  } else if (item.target === 'room') {
    detail.append(h('strong', { class: 'shop-field-title' }, 'Sala'));
    detail.append(h('span', { class: 'shop-detail-context' }, current && !isDm(current) ? current.name : 'Entre em uma sala para usar este item.'));
    targetName = current && !isDm(current) ? current.name : 'sua sala';
  } else {
    detail.append(h('strong', { class: 'shop-field-title' }, 'Para quem?'), h('span', { class: 'shop-detail-context' }, me?.display_name || 'Você'));
  }
  const buyLabel = item.target === 'member' ? `Zoar ${targetName} por ${shopMoney(item.cents)}` : item.id === 'telao' ? `Destacar por ${shopMoney(item.cents)}` : `Escolher por ${shopMoney(item.cents)}`;
  const buy = h('button', { class: 'btn primary block shop-buy', type: 'button' }, buyLabel);
  buy.addEventListener('click', () => {
    if (item.id === 'telao') {
      if (!current || isDm(current)) { toast('Entre em uma sala para personalizar o Telão.'); return; }
      openTelaoPurchase({ name: item.name, price_cents: item.cents });
      return;
    }
    if (item.id === 'apelido' && !shopNickText.trim()) { toast('Escreva o apelido primeiro.'); return; }
    if (OWNABLE(item) && owns(item.id)) { toast('Você já tem esse item.'); return; }
    startCheckout(item, { recipientId: item.target === 'member' ? shopTargetId : undefined, text: item.id === 'apelido' ? shopNickText : undefined });
  });
  if (item.id === 'apelido') {
    const nick = h('input', { maxlength: '20', placeholder: 'Pé-frio', value: shopNickText, 'aria-label': 'Apelido' });
    nick.addEventListener('input', () => { shopNickText = nick.value; });
    detail.append(h('strong', { class: 'shop-field-title' }, 'Qual apelido?'), nick);
  }
  if (item.category === 'Sala · vaquinha') detail.append(vaquinhaBlock());
  detail.append(buy, h('p', { class: 'shop-payment-note' }, item.target === 'member' ? `Aparece “zoeira de ${me?.display_name || 'você'}” junto. Pagamento único por Pix.` : 'Pagamento único. O pagamento ainda não está configurado.'));
  return detail;
}

function renderShopActivity() {
  return h('section', { class: 'shop-activity' },
    h('div', { class: 'shop-activity-head' }, h('strong', null, '● Acontecendo agora'), h('span', null, 'na sala')),
    h('p', { class: 'shop-empty' }, current && !isDm(current) ? 'Carregando atividades da sala…' : 'Entre em uma sala para ver os itens ativos.'));
}

async function loadShopActivity(container, roomId) {
  if (!container || !current || current.id !== roomId) return;
  const { data, error } = await sb.from('purchases').select('item_id,buyer_id,extra,expires_at,paid_at')
    .eq('room_id', roomId).eq('status', 'paid').gt('expires_at', new Date().toISOString())
    .order('paid_at', { ascending: false }).limit(4);
  if (!container.isConnected || !current || current.id !== roomId) return;
  container.replaceChildren(h('div', { class: 'shop-activity-head' }, h('strong', null, '● Acontecendo agora'), h('span', null, 'na sala')));
  if (error || !data?.length) { container.append(h('p', { class: 'shop-empty' }, 'Nenhum item ativo nesta sala ainda.')); return; }
  await ensureNames(data.map((x) => x.buyer_id));
  if (!container.isConnected || !current || current.id !== roomId) return;
  for (const purchase of data) {
    const product = SHOP_PRODUCTS.find((x) => x.id === purchase.item_id);
    container.append(h('div', { class: 'shop-activity-item' }, shopArt(product || { id: 'active', art: '✦' }),
      h('span', null, h('strong', null, names.get(purchase.buyer_id) || 'Alguém'), h('small', null, product?.name || 'Item da loja'))));
  }
}

async function openMyShopItems() {
  const list = h('div', { class: 'shop-owned-list' }, h('p', { class: 'muted' }, 'Carregando…'));
  openModal({ title: 'Meus itens', body: list });
  const { data, error } = await sb.from('purchases').select('item_id,expires_at,paid_at').eq('buyer_id', me.id).eq('status', 'paid').order('paid_at', { ascending: false }).limit(30);
  list.replaceChildren();
  if (error) { list.append(h('p', { class: 'muted' }, 'Não consegui carregar seus itens agora.')); return; }
  if (!data?.length) { list.append(h('p', { class: 'muted' }, 'Suas compras confirmadas vão aparecer aqui.')); return; }
  for (const purchase of data) {
    const product = SHOP_PRODUCTS.find((x) => x.id === purchase.item_id);
    list.append(h('div', { class: 'list-item' }, h('span', { class: 'grow' }, product?.name || 'Item do Resenha'), h('span', { class: 'sub' }, purchase.expires_at ? new Date(purchase.expires_at).toLocaleDateString('pt-BR') : 'Ativo')));
  }
}

function openTelaoPurchase(item) {
  const select = h('select', null, rooms.map((r) => h('option', { value: r.id }, r.name)));
  if (current && !isDm(current)) select.value = current.id;
  const message = h('input', { maxlength: '40', placeholder: 'Sua mensagem para a sala' });
  const buy = h('button', { class: 'btn primary' }, 'Ir para o pagamento');
  const price = (item.price_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  openModal({ title: 'Telão da sala', body: [h('p', { class: 'muted' }, `Sua mensagem aparece no topo do chat por 24 horas. ${price}. Modo de teste.`), field('Sala', select), field('Mensagem (até 40 caracteres)', message)], actions: [h('button', { class: 'btn secondary', onClick: closeModal }, 'Cancelar'), buy] });
  buy.addEventListener('click', async () => {
    if (!cfg.shopReady) { toast('Pagamento ainda não configurado; nenhuma cobrança foi feita.'); return; }
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
  $('shop-btn')?.classList.toggle('active', view === 'shop');
  let dmUnread = 0;
  for (const d of dms) { const u = unread.get(d.id); if (u) dmUnread += u.n; }
  $('dm-count').hidden = !dmUnread;
  $('dm-count').textContent = dmUnread > 99 ? '99+' : String(dmUnread);
  const box = $('rail-rooms');
  box.innerHTML = '';
  const railRooms = rooms.length ? rooms : cachedRailRooms;
  for (const r of railRooms) {
    const b = h('button', {
      class: 'rail-room' + (mode === 'rooms' && current && current.id === r.id ? ' active' : '') + (r.icon_url ? ' has-icon' : ''),
      title: r.name, 'aria-label': r.name, disabled: !rooms.length, style: r.icon_url ? { backgroundImage: `url("${r.icon_url}")` } : (r.color ? { '--room-color': r.color } : {})
    }, r.icon_url ? '' : r.name.trim().charAt(0).toUpperCase());
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
      textDrafts.set(channelKey(current.id, channel), input.value || '');
      members = []; roles = []; callPreview = []; oldestId = null; lastMsg = null;
      $('members-panel').replaceChildren();
      $('messages').replaceChildren(h('div', { class: 'empty-chat' }, 'Carregando mensagens…'));
    }
    channel = null; channels = []; voicePeople = {};
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
  $('chat-input').placeholder = dm ? `Mensagem para ${dmTitle(r)}` : `Conversar em #${channel ? channel.name : 'chat'}`;
  renderRail();
  renderDmList();
  setView(call.room && call.roomId === id ? 'call' : 'chat');
  await Promise.all([loadMembers(), loadMessages(true), loadChannels()]);
  if (!current || current.id !== id || roomRevision !== revision) return;
  renderChannels();
  subscribeRoom(id);
  shopRoom(dm ? null : id);
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
    sb.from('room_members').select('user_id, base_role, role_id, joined_at, profiles(display_name, avatar_url, banner_url, bio, accent_color)').eq('room_id', id),
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
  return { kick: r.can_kick, ban: r.can_ban, manage_roles: r.can_manage_roles, delete_messages: r.can_delete_messages, manage_channels: r.can_manage_channels }[perm] || false;
}
function canActOn(target, perm) {
  const mine = myMember();
  if (!mine || !target || target.user_id === me.id || !can(perm)) return false;
  if (target.base_role === 'owner') return false;
  return RANK[mine.base_role] > RANK[target.base_role] || target.base_role === 'member';
}
function nameColor(m) { if (m && isPink(m.user_id)) return '#FF69B4'; const r = roleOf(m); return r ? r.color : null; }

// Conversa 1:1: o painel da direita mostra o perfil da outra pessoa
function renderDmProfile(panel) {
  const other = dmOthers(current)[0];
  if (!other) return;
  const id = other.id;
  const p = profs.get(id) || {};
  const name = p.display_name || names.get(id) || other.display_name || 'Alguém';
  const st = statusOf(id);
  const since = h('div', { class: 'dmp-since' });
  const common = h('div', { class: 'dmp-common' }, h('div', { class: 'dmp-label' }, 'SALAS EM COMUM'), h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'Procurando…'));
  panel.append(h('div', { class: 'pcard dmp' },
    h('div', { class: 'pcard-banner', style: { background: p.banner_url ? 'var(--bg-0)' : (p.accent_color || colorFor(id)) } }, p.banner_url ? h('img', { src: p.banner_url, alt: '', referrerpolicy: 'no-referrer' }) : null),
    h('div', { class: 'pcard-body' },
      avatarOf(id, name, 'xl', true),
      h('div', { class: 'pcard-name' }, name),
      p.bio ? h('div', { class: 'pcard-bio' }, p.bio) : null,
      h('div', { class: 'pcard-status' }, statusDot(st), STATUS[st].label),
      badgeSlot(id)),
    common, since));
  sb.from('room_members').select('rooms(id, name, color, icon_url, kind)').eq('user_id', id).then(({ data }) => {
    const shared = (data || []).map((x) => x.rooms).filter((r) => r && r.kind === 'room' && rooms.some((m) => m.id === r.id));
    common.replaceChildren(h('div', { class: 'dmp-label' }, 'SALAS EM COMUM'),
      ...(shared.length ? shared.map((r) => h('div', { class: 'dmp-room' }, roomAvatar(r, ''), h('b', null, r.name))) : [h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'Nenhuma sala em comum.')]));
  }, () => {});
  sb.from('profiles').select('created_at').eq('id', id).maybeSingle().then(({ data }) => {
    if (data && data.created_at) since.textContent = 'No Resenha desde ' + new Date(data.created_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }, () => {});
}

// Cabeçalho do celular: nome da sala e "# canal · N online"
function paintTopRoom() {
  const nameEl = $('top-room-name'), subEl = $('top-room-sub');
  if (!nameEl || !current) return;
  if (isDm(current)) { nameEl.textContent = dmTitle(current); subEl.textContent = current.kind === 'group' ? `${members.length} pessoas` : (STATUS[statusOf((dmOthers(current)[0] || {}).id)] || STATUS.offline).label; return; }
  const online = members.filter((m) => statusOf(m.user_id) !== 'offline').length;
  const where = view === 'call' ? 'Call' : view === 'shop' ? 'Loja' : view === 'updates' ? 'atualizações' : `# ${channel ? channel.name : 'chat'}`;
  nameEl.textContent = current.name;
  subEl.textContent = `${where} · ${online} online`;
}

// Faixa "N na call · Entrar" no topo do chat (celular)
function paintCallBanner() {
  const el = $('call-banner');
  if (!el) return;
  const inThis = Boolean(call.room && current && call.roomId === current.id && !call.channelId);
  const people = !current ? [] : inThis ? participants().map((x) => ({ identity: x.identity, name: x.name })) : callPreview;
  el.hidden = !current || !people.length || view !== 'chat';
  if (el.hidden) return;
  $('call-banner-faces').replaceChildren(...people.slice(0, 3).map((x) => avatarOf(x.identity, x.name, 'sm')));
  $('call-banner-text').textContent = `${people.length} na call`;
  $('call-banner-join').hidden = inThis;
}

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
  paintTopRoom();
  if (isDm(current) && current.kind === 'dm') { renderDmProfile(panel); return; }
  const owner = online.filter((m) => m.base_role === 'owner');
  const mods = online.filter((m) => m.base_role === 'moderator');
  groups.push(['Dono', owner], ['Moderadores', mods]);
  const rest = online.filter((m) => m.base_role === 'member');
  for (const r of roles) groups.push([r.name, rest.filter((m) => m.role_id === r.id)]);
  groups.push(['Online', rest.filter((m) => !m.role_id || !roles.some((r) => r.id === m.role_id))]);
  groups.push(['Offline', offline]);
  let idx = 0;
  const cascade = () => ({ '--i': String(Math.min(idx++, 16)) });
  for (const [title, list] of groups) {
    if (!list.length) continue;
    panel.append(h('div', { class: 'mem-group', style: cascade() }, `${title} — ${list.length}`));
    for (const m of list.sort((a, b) => a.name.localeCompare(b.name))) {
      const st = statusOf(m.user_id);
      const b = h('button', { class: 'mem' + (st === 'offline' ? ' offline' : ''), 'data-uid': m.user_id, style: cascade() },
        avatarOf(m.user_id, m.name, '', true),
        h('span', { class: 'mem-text' },
          h('span', { class: 'name', style: { color: nameColor(m) || '' } }, nickFor(m.user_id) || m.name),
          h('span', { class: 'mem-act' }, activityOf(m.user_id) || (STATUS[st] || STATUS.offline).label)),
        m.base_role === 'owner' ? h('span', { class: 'crown', html: ICON.crown, title: 'Dono' }) : null,
        m.base_role === 'moderator' ? h('span', { class: 'crown', html: ICON.shield, title: 'Moderador', style: { color: 'var(--accent)' } }) : null);
      b.addEventListener('click', () => memberMenu(b, m.user_id));
      panel.append(b);
    }
  }
}

// O que a pessoa está fazendo agora (aparece embaixo do nome no painel de membros)
function activityOf(id) {
  if (typing.has(id)) return 'Digitando…';
  if (!current) return null;
  if (call.room && call.roomId === current.id) {
    const x = participants().find((p) => p.identity === id);
    if (x) return x.screen && !x.screen.isMuted ? 'Transmitindo a tela' : 'Na call';
  } else if (callPreview.some((p) => p.identity === id)) return 'Na call';
  return null;
}
function updateMemberActivity() {
  for (const b of document.querySelectorAll('#members-panel .mem[data-uid]')) {
    const el = b.querySelector('.mem-act');
    const id = b.dataset.uid;
    const st = statusOf(id);
    const text = activityOf(id) || (STATUS[st] || STATUS.offline).label;
    if (el && el.textContent !== text) el.textContent = text;
  }
}

function memberMenu(anchor, userId, at) {
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
    items.push({ label: 'Mandar pra privada', onClick: () => sendZoeira('privada', userId) });
    if (canZoeira('agua', me.id)) items.push({ label: 'Jogar água', onClick: () => sendZoeira('agua', userId) });
    if (canZoeira('chicote', me.id)) items.push({ label: 'Dar chicotada', onClick: () => sendZoeira('chicote', userId) });
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
  openMenu(anchor, items, at ? { at } : { side: anchor.closest('.members-panel') ? undefined : 'right' });
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_channels', filter: `room_id=eq.${id}` }, (p) => { if (current && current.id === id) onChannelEvent(p); })
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
  if (chatCache) chatCache.append(msgKey(m), m).catch(() => {});
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
  const seeing = seeingRoom(m.room_id) && (m.channel_id || null) === (channel ? channel.id : null);
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
  const mm = input.value.match(/^m!(\S*)$/i);
  if (mm) {
    const q = mm[1].toLowerCase();
    const items = MUSIC_COMMANDS.filter((c) => c.cmd.slice(2).startsWith(q) || c.alias.some((a) => a.slice(2).startsWith(q)));
    if (!items.length) { closeMentionPopup(); return; }
    mentionState = { cmd: true, music: true, items, index: 0 };
    renderMentionPopup();
    pop.hidden = false;
    return;
  }
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
    pop.append(h('div', { class: 'mention-head' }, mentionState.music ? 'Comandos do DJ Resenha' : 'Comandos do Sorteador'));
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
const MSG_FIELDS = 'id, room_id, user_id, content, created_at, attachment_path, attachment_type, kind, payload, reply_to, channel_id';
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
  const ck = channelKey(id, channel);
  if (reset && !throughId && chatCache) chatCache.read(ck).then((list) => {
    if (list) return renderCachedMessages(list, id, () => fresh || roomRevision !== revision);
  }).catch(() => {});
  let q = sb.from('messages').select(MSG_FIELDS).eq('room_id', id);
  q = (channel ? q.eq('channel_id', channel.id) : q.is('channel_id', null)).order('id', { ascending: false }).limit(50);
  if (reset && throughId) q = q.lte('id', throughId);
  if (!reset && oldestId) q = q.lt('id', oldestId);
  const { data, error } = await q;
  if (error || !current || current.id !== id || roomRevision !== revision) return;
  fresh = true;
  const list = (data || []).reverse();
  if (reset && !throughId && chatCache) chatCache.write(ck, list).catch(() => {});
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
      let sq = sb.from('messages').select('id,user_id,content,created_at').eq('room_id', roomId);
      sq = channel ? sq.eq('channel_id', channel.id) : sq.is('channel_id', null);
      const { data, error } = await sq.ilike('content', `%${escaped}%`).order('id', { ascending: false }).limit(30);
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
  const { data } = await sb.from('profiles').select('id, display_name, avatar_url, banner_url, bio, accent_color').in('id', missing);
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
function djMessageEl(m) {
  msgById.set(m.id, m);
  const body = h('div', { class: 'msg-body' },
    h('div', { class: 'msg-meta' }, h('span', { class: 'msg-name bot-name dj-name' }, 'DJ Resenha'), h('span', { class: 'bot-tag' }, 'BOT'), h('span', { class: 'msg-time' }, fmtTime(m.created_at))),
    musicCard(m.payload),
    h('div', { class: 'reactions', 'data-rx': String(m.id), hidden: true }));
  const row = h('div', { class: 'msg-row bot dj', 'data-mid': String(m.id) },
    h('span', { class: 'avatar bot-avatar dj-avatar', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>' }), body);
  row.append(msgTools(m, row, true));
  return row;
}

function botMessageEl(m) {
  if (m.payload && String(m.payload.type || '').startsWith('music')) return djMessageEl(m);
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
      h('span', { class: 'msg-name', 'data-uid': m.user_id, style: { color: nameColor(mem) || '' } }, name),
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
  const row = h('div', { class: 'msg-row' + (cont ? ' cont' : '') + (mentionsMe(m.content) ? ' mentioned' : ''), 'data-mid': String(m.id) }, (() => { const av = avatarOf(m.user_id, name); av.dataset.uid = m.user_id; return av; })(), body);
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
  updateMemberActivity();
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
  if (chatCache) chatCache.append(msgKey(m), m).catch(() => {});
  if ((m.channel_id || null) !== (channel ? channel.id : null)) return;
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
      if (e.key === 'Enter' && mentionState.cmd && (COMMANDS.some((c) => c.cmd === input.value.trim().toLowerCase()) || MUSIC_COMMANDS.some((c) => c.cmd === input.value.trim().toLowerCase()))) {
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
    const effectItem = !img && CHAT_EFFECTS[raw.toLowerCase().split(/\s+/)[0]];
    if (effectItem) {
      input.value = ''; autosize(); closeMentionPopup();
      if (isDm(current)) { toast('Efeitos de tela só funcionam em salas.'); return; }
      if (!owns(effectItem)) { toast('Esse efeito está na Loja. Compre para usar.', 4500); return; }
      fire(current.id, effectItem).catch((err) => toast(err.message, 4000));
      return;
    }
    if (/^m!/i.test(raw) && !img) {
      const mreq = parseMusic(raw);
      input.value = '';
      autosize();
      closeMentionPopup();
      if (mreq.error) { toast(mreq.error, 4500); return; }
      if (!call.room || call.roomId !== current.id) { toast('Entre numa call desta sala para usar o DJ.'); return; }
      runChatCommand(mreq).catch((err) => toast(err.message, 4500));
      return;
    }
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
    if (channel && !isDm(current)) row.channel_id = channel.id;
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

// Painel de música/assistir junto: só aparece na visão da call, mas o som continua em qualquer tela
let actOpen = false;
let membersHiddenByAct = false;
function applyAct() {
  const open = actOpen && view === 'call' && Boolean(call.room);
  const wasOpen = $('call-view').classList.contains('act-open');
  setPanelOpen(open);
  $('call-view').classList.toggle('act-open', open);
  // O painel de música cobre a lista de membros: some com ela enquanto estiver aberto (senão o espaço do palco é descontado duas vezes)
  const mp = $('members-panel');
  if (innerWidth > 1100 && mp) {
    if (open && !wasOpen && !mp.classList.contains('closed')) {
      mp.classList.add('closed'); membersHiddenByAct = true; $('members-toggle').classList.remove('pressed');
    } else if (!open && wasOpen && membersHiddenByAct) {
      mp.classList.remove('closed'); membersHiddenByAct = false; $('members-toggle').classList.add('pressed');
    }
  }
}

// ---------- Visões (chat / call) ----------
function setView(v) {
  view = v;
  $('ch-updates').classList.toggle('active', v === 'updates');
  $('ch-shop').classList.toggle('active', v === 'shop');
  $('ch-call').classList.toggle('active', v === 'call' && !call.channelId);
  $('updates-view').hidden = v !== 'updates';
  $('chat-view').hidden = v !== 'chat';
  $('call-view').hidden = v !== 'call';
  $('shop-view').hidden = v !== 'shop';
  $('members-panel').hidden = v === 'shop';
  $('chat-search-btn').hidden = v !== 'chat' || !current;
  $('pins-btn').hidden = v !== 'chat' || !current;
  $('members-toggle').hidden = v === 'shop';
  const icons = { updates: ICON.megaphone, chat: '#', call: ICON.mic, shop: '♧' };
  const titles = { updates: 'atualizações', chat: channel ? channel.name : 'chat', call: 'Call', shop: 'Loja' };
  const dm = isDm(current);
  $('top-icon').innerHTML = dm && v !== 'updates' ? '@' : icons[v];
  $('top-title').textContent = dm && v !== 'updates' ? dmTitle(current) + (v === 'call' ? ' · ligação' : '') : titles[v];
  if (!dm) $('top-sub').textContent = '';
  $('app').classList.remove('show-side');
  $('app').classList.toggle('shop-open', v === 'shop');
  $('side-toggle').setAttribute('aria-expanded', 'false');
  if (v === 'updates') renderUpdates();
  if (v === 'chat' && current) clearUnread(current.id);
  paintChannelActive();
  applyAct();
  paintTopRoom();
  paintCallBanner();
  renderRail();
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

// ---------- Canais de texto e de voz ----------
let channels = [];          // canais que eu vejo na sala aberta
let channel = null;         // canal de texto aberto (null = o chat padrão da sala)
let voicePeople = {};       // id do canal de voz -> quem está nele (prévia)
let newChannelId = null;    // canal recém-criado, para o destaque animado
const HASH_LOCK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const SPEAKER = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12"/></svg>';

const channelKey = (roomId, ch) => (ch ? `${roomId}:${ch.id}` : roomId);
const msgKey = (m) => (m.channel_id ? `${m.room_id}:${m.channel_id}` : m.room_id);
function canManageChannels() {
  const m = myMember();
  return Boolean(current && !isDm(current) && m && can('manage_channels'));
}

async function loadChannels() {
  if (!current || isDm(current)) { channels = []; channel = null; voicePeople = {}; renderChannels(); return; }
  const id = current.id;
  const revision = roomRevision;
  const { data } = await sb.from('room_channels').select('id, room_id, kind, name, is_private, role_ids, created_by, created_at').eq('room_id', id).order('created_at');
  if (!current || current.id !== id || roomRevision !== revision) return;
  channels = data || [];
  renderChannels();
  // O canal aberto sumiu (apagado ou ficou privado para mim): volta para o chat padrão
  if (channel && !channels.some((c) => c.id === channel.id)) selectTextChannel(null);
}

function paintChannelActive() {
  $('ch-chat').classList.toggle('active', view === 'chat' && !channel);
  for (const b of document.querySelectorAll('#text-channels [data-channel]')) b.classList.toggle('active', view === 'chat' && channel && b.dataset.channel === channel.id);
  for (const b of document.querySelectorAll('#voice-channels [data-channel]')) b.classList.toggle('active', Boolean(call.room && call.roomId === (current && current.id) && call.channelId === b.dataset.channel));
}

function channelPeople(c) {
  if (call.room && current && call.roomId === current.id && call.channelId === c.id) return participants().map((p) => ({ identity: p.identity, name: p.name }));
  return voicePeople[c.id] || [];
}

function renderChannels() {
  const manage = canManageChannels();
  $('add-text-ch').hidden = !manage;
  $('add-voice-ch').hidden = !manage;
  const del = (c) => {
    const b = h('button', { class: 'ch-del', title: 'Apagar canal', 'aria-label': `Apagar o canal ${c.name}`, html: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>' });
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!(await confirmModal({ title: `Apagar ${c.kind === 'text' ? '#' : ''}${c.name}?`, text: c.kind === 'text' ? 'As mensagens deste canal também são apagadas. Não dá para desfazer.' : 'Quem estiver na call do canal sai dela.', confirm: 'Apagar', danger: true }))) return;
      try { await rpc('delete_channel', { p_channel: c.id }); toast('Canal apagado.'); loadChannels(); } catch (err) { toast(err.message); }
    });
    return b;
  };
  const row = (c, inner, onClick) => {
    const b = h('button', { class: 'channel' + (newChannelId === c.id ? ' ch-new' : ''), 'data-channel': c.id }, ...inner);
    b.addEventListener('click', onClick);
    return h('div', { class: 'ch-wrap' }, b, manage ? del(c) : null);
  };
  $('text-channels').replaceChildren(...channels.filter((c) => c.kind === 'text').map((c) => row(c,
    [h('span', { class: 'hash ic-hash' }, '#'), h('span', { class: 'ch-name' }, c.name), c.is_private ? h('span', { class: 'ch-lock', html: HASH_LOCK, title: 'Canal privado' }) : null],
    () => selectTextChannel(c))));
  $('voice-channels').replaceChildren(...channels.filter((c) => c.kind === 'voice').map((c) => {
    const people = channelPeople(c);
    return row(c,
      [h('span', { class: 'ch-ico', html: SPEAKER }), h('span', { class: 'ch-name' }, c.name), c.is_private ? h('span', { class: 'ch-lock', html: HASH_LOCK, title: 'Canal privado' }) : null,
        h('span', { class: 'ch-count' + (people.length ? ' on' : '') }, people.length ? String(people.length) : 'vazio')],
      () => (call.room && call.roomId === current.id && call.channelId === c.id ? setView('call') : enterCall(c)));
  }));
  paintChannelActive();
  if (newChannelId) { const id = newChannelId; setTimeout(() => { if (newChannelId === id) { newChannelId = null; for (const b of document.querySelectorAll('.ch-new')) b.classList.remove('ch-new'); } }, 2400); }
}

async function selectTextChannel(c) {
  if (!current || isDm(current)) return;
  const same = (channel && channel.id) === (c && c.id);
  if (!same) {
    const input = $('chat-input');
    textDrafts.set(channelKey(current.id, channel), input.value || '');
    channel = c;
    input.value = textDrafts.get(channelKey(current.id, channel)) || '';
    roomRevision += 1;
    oldestId = null; lastMsg = null;
    clearReply();
    $('messages').replaceChildren(h('div', { class: 'empty-chat' }, 'Carregando mensagens…'));
    $('chat-input').placeholder = `Conversar em #${c ? c.name : 'chat'}`;
  }
  setView('chat');
  if (!same) await loadMessages(true);
}

function onChannelEvent(p) {
  if (p.eventType === 'INSERT' && p.new) {
    newChannelId = p.new.id;
    if (p.new.created_by !== me.id) toast(`Canal ${p.new.kind === 'text' ? '#' : ''}${p.new.name} criado`);
  }
  loadChannels();
}

function createChannelModal(kind = 'text') {
  if (!canManageChannels()) { toast('Só o dono e os moderadores criam canais.'); return; }
  let picked = kind;
  const msg = h('p', { class: 'msg' });
  const name = h('input', { maxlength: '40', placeholder: 'Ex.: memes', autocomplete: 'off' });
  const hint = h('p', { class: 'hint' });
  const priv = h('input', { type: 'checkbox', class: 'cfg-switch', 'aria-label': 'Canal privado' });
  const roleBox = h('div', { class: 'role-pick', hidden: true });
  const chosen = new Set();
  const opt = (id, icon, title, desc) => {
    const b = h('button', { type: 'button', class: 'ch-opt', role: 'radio', 'data-kind': id },
      h('span', { class: 'ch-opt-ico', html: icon }), h('span', { class: 'ch-opt-text' }, h('b', null, title), h('small', null, desc)), h('span', { class: 'ch-opt-radio' }));
    b.addEventListener('click', () => { picked = id; paint(); name.focus(); });
    return b;
  };
  const opts = [
    opt('text', '<span style="font-size:22px;font-weight:800">#</span>', 'Texto', 'Mensagens, imagens, GIFs e enquetes. Fica salvo.'),
    opt('voice', SPEAKER, 'Voz', 'Call com voz, câmera, tela, música e vídeo junto.')
  ];
  const norm = (v) => v.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9à-ÿ-]/g, '').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
  const paint = () => {
    for (const b of opts) b.setAttribute('aria-checked', String(b.dataset.kind === picked));
    name.placeholder = picked === 'text' ? 'Ex.: memes' : 'Ex.: Cinema, Jogatina, Estudo';
    const n = norm(name.value);
    hint.textContent = picked === 'text' ? (n ? `Vai ficar #${n}` : 'Sem espaços: vira minúsculo com hífen.') : 'Ex.: Cinema, Jogatina, Estudo';
  };
  name.addEventListener('input', paint);
  priv.addEventListener('change', () => {
    roleBox.hidden = !priv.checked;
    if (priv.checked) {
      roleBox.replaceChildren(roles.length
        ? h('div', { class: 'hint' }, 'Quem tem estes cargos também vê (dono e moderadores sempre veem):')
        : h('div', { class: 'hint' }, 'Só dono e moderadores veem. Crie cargos em "Cargos" para liberar outras pessoas.'),
      ...roles.map((r) => {
        const cb = h('input', { type: 'checkbox' });
        cb.addEventListener('change', () => { if (cb.checked) chosen.add(r.id); else chosen.delete(r.id); });
        return h('label', { class: 'check' }, cb, h('span', { style: { color: r.color } }, r.name));
      }));
    }
  });
  const ok = h('button', { class: 'btn primary' }, 'Criar canal');
  const cancel = h('button', { class: 'btn secondary', onClick: closeModal }, 'Cancelar');
  openModal({
    title: 'Criar canal',
    body: [h('p', { class: 'muted', style: { margin: '-6px 0 0' } }, 'Pode criar quantos quiser.'),
      h('div', { class: 'ch-opts', role: 'radiogroup', 'aria-label': 'Tipo de canal' }, ...opts),
      field('Nome do canal', name), hint,
      h('label', { class: 'cfg-row' }, h('span', { class: 'cfg-row-text' }, h('b', null, 'Canal privado'), h('small', null, 'Só quem tem os cargos que você escolher vê e entra.')), priv),
      roleBox, msg],
    actions: [cancel, ok]
  });
  paint();
  const submit = async () => {
    if (!norm(name.value) && picked === 'text') { msg.textContent = 'Dê um nome ao canal.'; return; }
    if (!name.value.trim()) { msg.textContent = 'Dê um nome ao canal.'; return; }
    ok.disabled = true; ok.textContent = 'Criando…'; msg.textContent = '';
    try {
      const row = await rpc('create_channel', { p_room: current.id, p_kind: picked, p_name: name.value, p_private: priv.checked, p_roles: [...chosen] });
      newChannelId = row.id;
      closeModal();
      await loadChannels();
      toast(`Canal ${row.kind === 'text' ? '#' : ''}${row.name} criado`);
      if (row.kind === 'text') selectTextChannel(channels.find((c) => c.id === row.id) || null);
    } catch (err) { msg.textContent = err.message; ok.disabled = false; ok.textContent = 'Criar canal'; }
  };
  ok.addEventListener('click', submit);
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
}

// ---------- Transmitir tela: pop-up nosso antes do seletor do navegador ----------
function shareAction() {
  if (!call.room) return;
  if (call.room.localParticipant.isScreenShareEnabled) toggleScreen(); // já transmitindo: para direto
  else shareModal();
}

function shareModal() {
  const saved = loadSettings();
  const state = { surface: saved.screenSurface || 'browser', quality: saved.screenQuality || 'nitida', audio: saved.screenAudio !== false };
  const SURFACES = [
    ['monitor', 'Tela inteira', 'Tudo que aparece no monitor', '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'],
    ['window', 'Janela', 'Só um programa (no Chrome vai sem som)', '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>'],
    ['browser', 'Aba do navegador', 'Melhor pra vídeo com som', '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>']
  ];
  const QUALITIES = [['leve', 'Leve', '720p · 30', 'Gasta menos internet'], ['nitida', 'Nítida', '1080p · 30', 'O melhor pra quase tudo'], ['fluida', 'Fluida', '1080p · 60', 'Para jogos e movimento']];
  const surfaceBtns = SURFACES.map(([id, title, desc, icon]) => {
    const b = h('button', { type: 'button', class: 'sh-surface', role: 'radio', 'data-id': id },
      h('span', { class: 'sh-ico', html: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>` }),
      h('span', { class: 'sh-text' }, h('b', null, title), h('small', null, desc)));
    b.addEventListener('click', () => { state.surface = id; paint(); });
    return b;
  });
  const qualityBtns = QUALITIES.map(([id, title, spec]) => {
    const b = h('button', { type: 'button', class: 'sh-quality', role: 'radio', 'data-id': id }, h('b', null, title), h('code', null, spec));
    b.addEventListener('click', () => { state.quality = id; paint(); });
    return b;
  });
  const qualityHint = h('p', { class: 'hint' });
  const audioWarn = h('p', { class: 'hint', style: { color: 'var(--danger, #e5484d)' } });
  const audio = h('input', { type: 'checkbox', class: 'cfg-switch', 'aria-label': 'Transmitir o som' });
  audio.addEventListener('change', () => { state.audio = audio.checked; });
  const go = h('button', { class: 'btn primary' }, h('span', { html: ICON.screen, style: { display: 'inline-flex' } }), 'Transmitir');
  const cancel = h('button', { class: 'btn secondary', onClick: closeModal }, 'Cancelar');
  const paint = () => {
    for (const b of surfaceBtns) b.setAttribute('aria-checked', String(b.dataset.id === state.surface));
    for (const b of qualityBtns) b.setAttribute('aria-checked', String(b.dataset.id === state.quality));
    qualityHint.textContent = (QUALITIES.find((q) => q[0] === state.quality) || [])[3] || '';
    audio.checked = state.audio;
    audioWarn.textContent = state.audio && state.surface === 'window' ? 'O Chrome não manda o som de uma janela. Para o pessoal ouvir, escolha Aba do navegador (vídeo do YouTube) ou Tela inteira.' : '';
    audioWarn.hidden = !audioWarn.textContent;
    const s = SURFACES.find((x) => x[0] === state.surface);
    go.lastChild.textContent = `Transmitir ${s ? s[1].toLowerCase() : ''}`;
  };
  const others = Math.max(0, participants().length - 1);
  openModal({
    title: 'Transmitir tela',
    wide: true,
    body: [
      h('p', { class: 'muted', style: { margin: '-6px 0 0' } }, others ? `${others} ${others === 1 ? 'pessoa' : 'pessoas'} na call ${others === 1 ? 'vai' : 'vão'} ver o que você escolher.` : 'Ninguém mais está na call ainda.'),
      h('div', { class: 'sh-surfaces', role: 'radiogroup', 'aria-label': 'O que transmitir' }, ...surfaceBtns),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Qualidade'), h('div', { class: 'sh-qualities', role: 'radiogroup', 'aria-label': 'Qualidade' }, ...qualityBtns), qualityHint),
      h('label', { class: 'cfg-row sh-audio' }, h('span', { class: 'cfg-row-text' }, h('b', null, 'Transmitir o som'), h('small', null, 'O pessoal ouve o jogo ou o vídeo')), audio),
      audioWarn,
      h('p', { class: 'hint' }, 'No navegador, depois de clicar, o próprio Chrome confirma a tela: é uma proteção dele que nenhum site consegue esconder. O som só vai junto se você marcar a opção de compartilhar áudio nessa confirmação.')
    ],
    actions: [cancel, go]
  });
  paint();
  go.addEventListener('click', () => {
    const cur = loadSettings();
    cur.screenSurface = state.surface; cur.screenQuality = state.quality; cur.screenAudio = state.audio;
    saveSettings(cur);
    closeModal();
    toggleScreen({ surface: state.surface, quality: state.quality, audio: state.audio });
  });
}

// ---------- Onboarding (primeiro acesso) ----------
const ONB_COLORS = ['#7FB2F0', '#F2A65A', '#8BD3A8', '#C9A7F5', '#F28FAA', '#FFD166', '#FF6B3D'];
const ONB_INTERESTS = [['Jogos', 'jogos'], ['Estudo', 'estudo'], ['Música', 'musica'], ['Papo', 'papo'], ['Filmes', 'papo'], ['Esportes', 'papo'], ['Código', 'estudo'], ['Arte', 'musica']];
let onbEl = null;

async function markOnboarded() {
  try { await sb.auth.updateUser({ data: { resenha_onboarded: true } }); } catch (_) {}
}

function maybeOnboard() {
  const meta = (session && session.user && session.user.user_metadata) || {};
  if (meta.resenha_onboarded) return;
  if (rooms.length || dms.length) { markOnboarded(); return; } // quem já usa o app não precisa
  showOnboarding();
}

function showOnboarding() {
  if (onbEl) return;
  const state = { step: 0, color: me.accent_color || ONB_COLORS[0], bio: me.bio || '', likes: new Set(), joined: new Set(), list: null };
  const LAST = 5;
  const card = h('div', { class: 'onb-card beam' });
  const ring = h('div', { class: 'onb-ring', role: 'img' });
  const skip = h('button', { class: 'onb-skip', type: 'button' }, 'Pular tudo');
  onbEl = h('div', { class: 'onb', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Boas-vindas' },
    h('header', { class: 'onb-head' },
      h('span', { class: 'onb-brand' }, h('span', { class: 'logo-mark', html: '<svg viewBox="0 0 48 48" width="22" height="22"><circle cx="24" cy="24" r="13" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="24" cy="11" r="5.5" fill="currentColor"/><circle cx="35.3" cy="30.5" r="5.5" fill="currentColor"/><circle cx="12.7" cy="30.5" r="5.5" fill="currentColor"/></svg>' }), h('b', null, 'resenha')),
      h('span', { class: 'onb-head-right' }, skip, ring)),
    h('div', { class: 'onb-stage' }, card));
  document.body.append(onbEl);
  $('app').setAttribute('inert', '');

  const finish = async (openAdd) => {
    await markOnboarded();
    onbEl.remove(); onbEl = null;
    $('app').removeAttribute('inert');
    await loadRooms();
    if (rooms[0]) await openRoom(rooms[0].id); else renderEmpty();
    if (openAdd) addRoomModal();
  };
  skip.addEventListener('click', () => finish(false));

  const paintRing = () => {
    const pct = state.step / LAST;
    const C = 2 * Math.PI * 16;
    ring.setAttribute('aria-label', `Progresso: ${Math.round(pct * 100)}%`);
    ring.innerHTML = `<svg viewBox="0 0 40 40" width="44" height="44"><circle cx="20" cy="20" r="16" fill="none" stroke="var(--bg-active)" stroke-width="3"/><circle cx="20" cy="20" r="16" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(2)}" transform="rotate(-90 20 20)"/></svg><span>${Math.round(pct * 100)}%</span>`;
    skip.hidden = state.step >= LAST;
  };

  const saveProfile = async () => {
    const patch = { accent_color: state.color, bio: state.bio.trim().slice(0, 60) || null };
    const { error } = await sb.from('profiles').update(patch).eq('id', me.id);
    if (!error) { Object.assign(me, patch); setProf(me); renderMe(); }
  };

  const draw = async () => {
    paintRing();
    const s = state.step;
    const next = h('button', { class: 'btn primary onb-next', type: 'button' }, ['Bora começar', 'Continuar', 'Continuar', 'Continuar', 'Concluir'][s] || 'Entrar no Resenha');
    const back = s > 0 && s < LAST ? h('button', { class: 'btn secondary onb-back', type: 'button', onClick: () => { state.step -= 1; draw(); } }, 'Voltar') : null;
    let body;
    if (s === 0) {
      body = [h('h1', null, `Bem-vindo, ${me.display_name}!`), h('p', { class: 'muted' }, 'Sua conta está pronta. Em um minuto a gente deixa tudo com a sua cara.'),
        h('div', { class: 'onb-points' },
          ...[['Chat que fica salvo', 'Nada some. Dá pra buscar e fixar o que importa.'], ['Call com voz, câmera e tela', 'Fixe quem você quer ver e transmita com som.'], ['Sorteador que ninguém rouba', 'Times, ordem e dado feitos no servidor.']]
            .map(([t, d]) => h('div', { class: 'onb-point' }, h('b', null, t), h('span', null, d))))];
    } else if (s === 1) {
      const prev = h('div', { class: 'onb-preview' });
      const bio = h('input', { maxlength: '60', value: state.bio, placeholder: 'Ex.: goleiro reserva e DJ de churrasco' });
      const paintPrev = () => {
        prev.replaceChildren(h('div', { class: 'onb-prev-banner', style: { background: state.color } }),
          h('div', { class: 'onb-prev-body' }, h('span', { class: 'onb-prev-av', style: { background: state.color } }, (me.display_name || '?').trim().charAt(0).toUpperCase()),
            h('span', { class: 'onb-prev-text' }, h('b', null, me.display_name), h('small', null, state.bio.trim() || 'Sem recado ainda'))));
        swatches.replaceChildren(...ONB_COLORS.map((hex) => h('button', { type: 'button', class: 'cfg-swatch', role: 'radio', 'aria-label': `Cor ${hex}`, 'aria-checked': String(state.color === hex), style: { background: hex, '--ring': hex, width: '34px', height: '34px' }, onClick: () => { state.color = hex; paintPrev(); } },
          h('span', { html: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>' }))));
      };
      const swatches = h('div', { class: 'cfg-swatches', role: 'radiogroup', 'aria-label': 'Cor' });
      bio.addEventListener('input', () => { state.bio = bio.value; paintPrev(); });
      paintPrev();
      body = [h('h1', null, 'Bota sua cara'), h('p', { class: 'muted' }, 'É assim que a galera vai te ver.'), prev, swatches, field('Uma frase sobre você', bio)];
    } else if (s === 2) {
      const grid = h('div', { class: 'onb-interests' });
      const paintI = () => grid.replaceChildren(...ONB_INTERESTS.map(([name]) => {
        const on = state.likes.has(name);
        const b = h('button', { type: 'button', class: 'onb-interest', 'aria-pressed': String(on) }, name);
        b.addEventListener('click', () => { if (on) state.likes.delete(name); else state.likes.add(name); paintI(); });
        return b;
      }));
      paintI();
      body = [h('h1', null, 'Do que você curte?'), h('p', { class: 'muted' }, 'A gente usa pra achar salas pra você.'), grid];
    } else if (s === 3) {
      const opts = h('div', { class: 'cfg-modes onb-modes', role: 'radiogroup', 'aria-label': 'Tema' });
      const paintT = () => {
        const mode = resolvedTheme();
        opts.replaceChildren(...[['dark', 'Escuro', 'cfg-prev dark'], ['light', 'Claro', 'cfg-prev light']].map(([id, name, cls]) =>
          h('button', { type: 'button', class: 'cfg-mode', role: 'radio', 'aria-checked': String(mode === id), onClick: () => { setPrefs({ mode: id }); paintT(); } },
            h('span', { class: cls }, h('i'), h('span', null, h('u'), h('u'), h('em'))), h('b', null, name))));
      };
      paintT();
      body = [h('h1', null, 'Escuro ou claro?'), h('p', { class: 'muted' }, 'Clica e vê a mudança. Dá pra trocar quando quiser nas Configurações.'), opts];
    } else if (s === 4) {
      const listEl = h('div', { class: 'onb-rooms' }, h('p', { class: 'muted' }, 'Procurando salas…'));
      body = [h('h1', null, 'Salas pra você'), h('p', { class: 'muted' }, 'Entre nas que quiser. Dá pra entrar em mais depois, em Explorar.'), listEl];
      if (!state.list) {
        try { state.list = (await rpc('explore_rooms')) || []; } catch (_) { state.list = []; }
        const likedCats = new Set(ONB_INTERESTS.filter(([n]) => state.likes.has(n)).map(([, c]) => c));
        state.list = state.list.slice().sort((a, b) => (likedCats.has(b.category) ? 1 : 0) - (likedCats.has(a.category) ? 1 : 0));
      }
      const paintR = () => {
        if (!state.list.length) { listEl.replaceChildren(h('p', { class: 'muted' }, 'Ainda não há salas públicas. Você pode criar a sua ou entrar com um convite.')); return; }
        listEl.replaceChildren(...state.list.slice(0, 8).map((r) => {
          const joined = state.joined.has(r.id);
          const b = h('button', { type: 'button', class: 'btn ' + (joined ? 'secondary' : 'primary'), disabled: joined }, joined ? 'Entrou ✓' : 'Entrar');
          b.addEventListener('click', async () => {
            b.disabled = true;
            try { await rpc('join_room', { p_room: r.id, p_code: null }); state.joined.add(r.id); paintR(); } catch (err) { toast(err.message); b.disabled = false; }
          });
          return h('div', { class: 'onb-room' }, roomAvatar(r, 'lg'), h('span', { class: 'onb-room-text' }, h('b', null, r.name), h('small', null, `${r.member_count} ${Number(r.member_count) === 1 ? 'membro' : 'membros'}${r.category ? ' · ' + catLabel(r.category) : ''}`)), b);
        }));
      };
      paintR();
      const more = h('button', { type: 'button', class: 'link', onClick: () => finish(true) }, 'Tenho um convite ou quero criar minha sala');
      body.push(more);
    } else {
      next.textContent = 'Entrar no Resenha';
      body = [h('div', { class: 'onb-done' },
        h('span', { class: 'onb-prev-av big', style: { background: state.color } }, (me.display_name || '?').trim().charAt(0).toUpperCase()),
        h('h1', null, 'Tudo pronto!'), h('p', { class: 'muted' }, state.joined.size ? `Você entrou em ${state.joined.size} ${state.joined.size === 1 ? 'sala' : 'salas'}. Bora resenhar.` : 'Sua conta está do seu jeito. Crie uma sala ou entre com um convite para começar.'))];
    }
    card.replaceChildren(h('div', { class: 'onb-step' }, ...body), h('div', { class: 'onb-actions' }, back, h('span', { style: { flex: '1' } }), next));
    next.addEventListener('click', async () => {
      next.disabled = true;
      if (state.step === 1) await saveProfile();
      if (state.step === LAST) { await finish(false); return; }
      state.step += 1;
      draw();
    });
    const f = card.querySelector('input'); if (f) f.focus();
  };
  draw();
}

// ---------- Call: prévia de quem está lá ----------
function startPreviewPolling() {
  clearInterval(previewTimer);
  const tick = async () => {
    if (!current || !cfg.livekitReady) { callPreview = []; voicePeople = {}; renderCallList(); renderChannels(); return; }
    try {
      const id = current.id;
      const out = await api(`/api/call-participants?roomId=${id}${isDm(current) ? '' : '&all=1'}`);
      if (current && current.id === id) {
        const inDefault = Boolean(call.room && call.roomId === id && !call.channelId);
        callPreview = inDefault ? [] : (out.participants || []);
        voicePeople = out.channels || {};
        renderCallList(); renderCallEmpty(); renderChannels();
      }
    } catch (_) {}
  };
  tick();
  previewTimer = setInterval(tick, 15000);
}

// Card "Call da sala" na lateral: fica vivo (feixe de luz) quando tem gente
function renderCallCard() {
  paintCallBanner();
  const card = $('call-card');
  const join = $('call-card-join');
  card.hidden = !current;
  $('voice-cat').hidden = !current || mode === 'dms';
  if (!current) { card.classList.remove('live'); join.hidden = true; return; }
  const inThis = Boolean(call.room && call.roomId === current.id && !call.channelId);
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
  updateMemberActivity();
  if (!current) return;
  const inThis = call.room && call.roomId === current.id && !call.channelId;
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
  paintMeSub();

  const connected = Boolean(call.room);
  $('voice-bar').hidden = !connected && !call.connecting;
  if (connected || call.connecting) {
    const state = call.room ? call.room.state : 'connecting';
    const ok = state === 'connected';
    $('vb-title').className = 'vb-title' + (ok ? '' : ' warn');
    $('vb-title').innerHTML = '';
    $('vb-title').append(h('span', { class: 'dot' }), ok ? 'Voz conectada' : state === 'reconnecting' ? 'Reconectando…' : 'Conectando…');
    $('vb-sub').textContent = `${call.channelName || 'Call'} / ${call.serverName || call.roomName}`;
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
  if (connected) { setModerator(can('delete_messages') || can('kick')); musicJoin(call.roomId, call.channelId); } else { musicLeave(); actOpen = false; for (const o of document.querySelectorAll('.act-tab')) o.classList.toggle('on', o.dataset.act === 'call'); }
  applyAct();
  paintCallTools();
  const inThis = connected && call.roomId === current?.id;
  if (view === 'call' && inThis && !isDm(current)) $('top-title').textContent = call.channelName || 'Call';
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
  if (channels.length) renderChannels();
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

async function enterCall(ch = null) {
  if (!current) return;
  if (!cfg.livekitReady) { toast('A call ainda não foi configurada no servidor.'); return; }
  setView('call');
  await joinCall(current.id, current.name, (roomId, channelId) => api('/api/livekit-token', { roomId, channelId }), ch ? ch.id : null, ch ? ch.name : '');
  startPreviewPolling();
  if (call.room && owns('entrada')) fire(current.id, 'entrada').catch(() => {});
}

// ---------- Modais ----------
// ---------- Explorar salas e criar sala ----------
const CATEGORIES = [['jogos', 'Jogos'], ['estudo', 'Estudo'], ['musica', 'Música'], ['papo', 'Papo']];
const catLabel = (id) => (CATEGORIES.find((c) => c[0] === id) || [])[1] || '';
let exploreEl = null;
function closeExplore() {
  if (!exploreEl) return;
  exploreEl.remove();
  exploreEl = null;
  document.removeEventListener('keydown', exploreKey, true);
  $('app').removeAttribute('inert');
}
function exploreKey(e) {
  if (e.key === 'Escape' && !document.querySelector('#modal-layer .modal-bg')) { e.stopPropagation(); closeExplore(); }
}

async function exploreModal() {
  closeExplore();
  const state = { cat: 'all', term: '' };
  const grid = h('div', { class: 'ex-grid' }, h('p', { class: 'muted' }, 'Carregando…'));
  const search = h('input', { placeholder: 'Buscar sala', 'aria-label': 'Buscar sala', autocomplete: 'off' });
  const tabs = h('nav', { class: 'ex-tabs', 'aria-label': 'Categorias' });
  const create = h('button', { class: 'btn primary', onClick: () => createRoomModal() }, '+ Criar sala');
  const close = h('button', { class: 'cfg-close', 'aria-label': 'Fechar', title: 'Fechar (Esc)', onClick: closeExplore, html: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>' });
  exploreEl = h('div', { class: 'cfg explore', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Explorar salas' },
    h('div', { class: 'ex-main' },
      h('header', { class: 'ex-head' },
        h('div', { class: 'ex-title' }, h('h1', { class: 'cfg-title' }, 'Explorar salas'), h('p', { class: 'cfg-desc' }, 'Salas públicas da galera do Resenha. Entra quem quiser.')),
        h('label', { class: 'ex-search' }, h('span', { html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' }), search),
        create),
      tabs, grid),
    close);
  document.body.append(exploreEl);
  document.addEventListener('keydown', exploreKey, true);
  $('app').setAttribute('inert', '');

  let list = [];
  let live = new Set();
  const paintTabs = () => tabs.replaceChildren(...[['all', 'Todas'], ...CATEGORIES].map(([id, label]) => {
    const b = h('button', { class: 'ex-tab', 'aria-pressed': String(state.cat === id) }, label);
    b.addEventListener('click', () => { state.cat = id; paintTabs(); paintGrid(); });
    return b;
  }));
  const paintGrid = () => {
    const term = state.term.trim().toLowerCase();
    const shown = list.filter((r) => (state.cat === 'all' || r.category === state.cat) && (!term || r.name.toLowerCase().includes(term) || (r.description || '').toLowerCase().includes(term)));
    if (!shown.length) { grid.replaceChildren(h('p', { class: 'muted' }, list.length ? 'Nenhuma sala encontrada.' : 'Nenhuma sala pública por enquanto. Que tal criar a primeira?')); return; }
    grid.replaceChildren(...shown.map((r, i) => {
      const joined = rooms.some((x) => x.id === r.id);
      const btn = h('button', { class: 'btn secondary block' }, joined ? 'Abrir' : 'Entrar');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          if (!joined) { await rpc('join_room', { p_room: r.id, p_code: null }); await loadRooms(); }
          closeExplore();
          openRoom(r.id);
        } catch (err) { toast(err.message); btn.disabled = false; }
      });
      return h('article', { class: 'ex-card', style: { '--i': String(Math.min(i, 12)) } },
        h('div', { class: 'ex-card-top' }, roomAvatar(r, 'lg'), h('div', { class: 'ex-card-title' }, h('b', null, r.name), r.category ? h('small', null, catLabel(r.category)) : null)),
        r.description ? h('p', { class: 'ex-card-desc' }, r.description) : null,
        h('div', { class: 'ex-card-meta' }, h('span', null, `${r.member_count} ${Number(r.member_count) === 1 ? 'membro' : 'membros'}`), live.has(r.id) ? h('span', { class: 'live-badge' }, 'CALL AO VIVO') : null),
        btn);
    }));
  };
  search.addEventListener('input', () => { state.term = search.value; paintGrid(); });
  paintTabs();
  search.focus();
  try { list = (await rpc('explore_rooms')) || []; } catch (err) { grid.replaceChildren(h('p', { class: 'muted' }, 'Não deu para carregar as salas: ' + err.message)); return; }
  paintGrid();
  api('/api/live-rooms').then((out) => { live = new Set(out.rooms || []); if (exploreEl) paintGrid(); }).catch(() => {});
}

// Modelos de sala: já criam os canais (usa create_channel)
const ROOM_TEMPLATES = [
  { id: 'galera', name: 'Galera', desc: 'Papo e call', category: 'papo', has: '#memes e a voz Resenha', channels: [['text', 'memes'], ['voice', 'Resenha']] },
  { id: 'jogos', name: 'Jogos', desc: 'Times e partidas', category: 'jogos', has: '#clipes e duas vozes de time', channels: [['text', 'clipes'], ['voice', 'Time 1'], ['voice', 'Time 2']] },
  { id: 'estudo', name: 'Estudo', desc: 'Foco e calma', category: 'estudo', has: '#dúvidas e a voz Estudo silencioso', channels: [['text', 'dúvidas'], ['voice', 'Estudo silencioso']] }
];

function createRoomModal() {
  let tpl = ROOM_TEMPLATES[0];
  const name = h('input', { maxlength: '50', placeholder: 'Ex.: Resenha dos amigos', required: true });
  const pub = h('input', { type: 'checkbox', class: 'cfg-switch', 'aria-label': 'Aparecer em Explorar' });
  const msg = h('p', { class: 'msg' });
  const has = h('p', { class: 'hint' });
  const ok = h('button', { class: 'btn primary block' }, 'Criar e pegar o convite');
  const opts = ROOM_TEMPLATES.map((t) => {
    const b = h('button', { type: 'button', class: 'tpl-opt', role: 'radio' }, h('b', null, t.name), h('small', null, t.desc));
    b.addEventListener('click', () => { tpl = t; paint(); });
    b._t = t;
    return b;
  });
  const paint = () => { for (const b of opts) b.setAttribute('aria-checked', String(b._t === tpl)); has.textContent = 'Já vem com: ' + tpl.has; };
  openModal({
    title: 'Criar sala',
    body: [h('p', { class: 'muted', style: { margin: '-6px 0 0' } }, 'Escolha um ponto de partida. Dá pra mudar tudo depois.'),
      h('div', { class: 'tpl-opts', role: 'radiogroup', 'aria-label': 'Tipo de sala' }, ...opts),
      field('Nome da sala', name), has,
      h('label', { class: 'cfg-row' }, h('span', { class: 'cfg-row-text' }, h('b', null, 'Aparecer em Explorar'), h('small', null, 'Sem marcar, só entra quem tiver o convite')), pub),
      msg],
    actions: [ok]
  });
  paint();
  const submit = async () => {
    if (!name.value.trim()) { msg.textContent = 'Dê um nome para a sala.'; return; }
    ok.disabled = true; ok.textContent = 'Criando…'; msg.textContent = '';
    try {
      const room = await rpc('create_room', { p_name: name.value.trim(), p_public: pub.checked });
      // Perfil e canais do modelo: se algo falhar aqui a sala já existe, então só avisa.
      try { await rpc('set_room_profile', { p_room: room.id, p_description: null, p_category: tpl.category, p_color: null, p_icon: null }); } catch (_) {}
      for (const [kind, nm] of tpl.channels) { try { await rpc('create_channel', { p_room: room.id, p_kind: kind, p_name: nm, p_private: false, p_roles: [] }); } catch (_) {} }
      closeModal();
      closeExplore();
      await loadRooms();
      await openRoom(room.id);
      inviteModal();
    } catch (err) { msg.textContent = err.message; ok.disabled = false; ok.textContent = 'Criar e pegar o convite'; }
  };
  ok.addEventListener('click', submit);
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
}

// "+ adicionar sala": criar uma nova ou entrar com convite
function addRoomModal() {
  const code = h('input', { placeholder: 'Cole o link ou o código do convite', autocomplete: 'off' });
  const msg = h('p', { class: 'msg' });
  const go = h('button', { class: 'btn primary block' }, 'Entrar com convite');
  const enter = () => {
    const raw = code.value.trim();
    const m = raw.match(/convite=([a-z0-9]+)/i);
    const c = m ? m[1] : raw;
    if (!c) { msg.textContent = 'Cole o convite primeiro.'; return; }
    closeModal();
    handleInvite(c);
  };
  go.addEventListener('click', enter);
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); enter(); } });
  const create = h('button', { type: 'button', class: 'ch-opt', onClick: () => { closeModal(); createRoomModal(); } },
    h('span', { class: 'ch-opt-ico', html: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' }),
    h('span', { class: 'ch-opt-text' }, h('b', null, 'Criar uma sala'), h('small', null, 'Comece do zero ou de um modelo.')));
  openModal({ title: 'Adicionar sala', body: [create, h('div', { class: 'divider' }, h('span', null, 'OU')), field('Tem um convite?', code), go, msg] });
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
  presentPanel({ title: `Convidar para ${current.name}`, body });
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

// ---------- Configurações da sala (tela cheia) ----------
const ROOM_COLORS = ['#FF6B3D', '#FFD166', '#8BD3A8', '#7FB2F0', '#C9A7F5', '#F28FAA'];
function roomAvatar(r, cls) {
  const a = avatar(r.id, r.name, cls, r.icon_url || null);
  if (!r.icon_url && r.color) a.style.background = r.color;
  return a;
}

function roomSettingsModal(start) { roomSettingsScreen(start || 'overview'); }

function roomSettingsScreen(start = 'overview') {
  if (!current || isDm(current)) return;
  const mine = myMember();
  const owner = Boolean(mine && mine.base_role === 'owner');
  const sections = [];
  const mountPanel = (fn) => (body) => { configPane = body; Promise.resolve(fn()).catch(() => {}); };

  if (owner) sections.push({ id: 'overview', name: 'Visão geral', title: 'Visão geral', paint: paintRoomOverview });
  if (canManageChannels()) sections.push({ id: 'channels', name: 'Canais', count: () => channels.length, title: 'Canais', desc: 'Texto e voz. Só dono e moderadores criam e apagam.', paint: paintRoomChannels });
  if (can('manage_roles')) sections.push({ id: 'roles', name: 'Cargos', count: () => roles.length, title: 'Cargos', paint: mountPanel(rolesModal) });
  sections.push({ id: 'members', name: 'Membros', count: () => members.length, title: 'Membros', desc: 'Clique em alguém para dar cargo, expulsar ou banir.', paint: paintRoomMembers });
  sections.push({ id: 'invites', name: 'Convites', title: 'Convites', paint: mountPanel(inviteModal) });
  if (can('ban')) sections.push({ id: 'bans', name: 'Banidos', title: 'Banidos', paint: mountPanel(bansModal) });

  const header = h('div', { class: 'cfg-me' }, roomAvatar(current, ''), h('span', { class: 'cfg-me-text' }, h('b', null, current.name)));
  openShell({
    label: 'Configurações da sala',
    header,
    sections,
    start,
    back: { label: '← Voltar pra sala' },
    onClose: () => { configPane = null; }
  });
}

function paintRoomOverview(body) {
  const r = current;
  const draft = { icon: r.icon_url || null, color: r.color || null, pendingIcon: null, removeIcon: false };
  const name = h('input', { maxlength: '50', value: r.name });
  const desc = h('textarea', { maxlength: '140', rows: '2', placeholder: 'Sobre o que é a sala' }, r.description || '');
  const cat = h('select', null, h('option', { value: '' }, 'Sem categoria'), ...CATEGORIES.map(([id, label]) => h('option', { value: id }, label)));
  cat.value = r.category || '';
  const pub = h('input', { type: 'checkbox', class: 'cfg-switch', 'aria-label': 'Sala pública', checked: r.is_public });
  const goal = h('input', { type: 'number', min: '5', max: '10000', step: '1', value: String(Math.round((r.vaquinha_goal_cents || 2000) / 100)), 'aria-label': 'Meta da vaquinha em reais' });
  const msg = h('p', { class: 'msg' });
  const dirtyLabel = h('span', { class: 'cfg-dirty', hidden: true }, 'Alterações não salvas');
  const markDirty = () => { dirtyLabel.hidden = false; dirtyLabel.textContent = 'Alterações não salvas'; dirtyLabel.classList.remove('ok'); };
  const iconBox = h('div', { class: 'rs-icon' });
  const colors = h('div', { class: 'cfg-swatches' });
  let preview = null;
  const paint = () => {
    const view = { id: r.id, name: name.value || r.name, icon_url: draft.pendingIcon ? draft.pendingIcon.url : draft.removeIcon ? null : draft.icon, color: draft.color };
    iconBox.replaceChildren(roomAvatar(view, 'xl'));
    colors.replaceChildren(...ROOM_COLORS.map((hex) => h('button', {
      type: 'button', class: 'cfg-swatch', role: 'radio', 'aria-label': `Cor ${hex}`, 'aria-checked': String((draft.color || '').toLowerCase() === hex.toLowerCase()),
      style: { background: hex, '--ring': hex, width: '32px', height: '32px' }, onClick: () => { draft.color = hex; markDirty(); paint(); }
    }, h('span', { html: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>' }))));
  };
  name.addEventListener('input', paint);
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true });
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    file.value = '';
    if (!f) return;
    try {
      const out = await prepareImage(f, 'avatar');
      draft.pendingIcon = { ...out, url: URL.createObjectURL(out.blob) };
      draft.removeIcon = false;
      markDirty();
      paint();
    } catch (err) { msg.textContent = err.message; }
  });
  const change = h('button', { type: 'button', class: 'btn secondary', onClick: () => file.click() }, 'Trocar ícone');
  const clear = h('button', { type: 'button', class: 'btn secondary', onClick: () => { draft.pendingIcon = null; draft.removeIcon = true; markDirty(); paint(); } }, 'Tirar ícone');
  const save = h('button', { class: 'btn primary' }, 'Salvar alterações');
  save.addEventListener('click', async () => {
    if (!name.value.trim()) { msg.textContent = 'Dê um nome para a sala.'; return; }
    save.disabled = true; save.textContent = 'Salvando…'; msg.textContent = '';
    try {
      let icon = draft.removeIcon ? null : draft.icon;
      if (draft.pendingIcon) {
        const path = `${me.id}/room-${r.id}-${Date.now()}.${draft.pendingIcon.ext}`;
        const up = await sb.storage.from('perfis').upload(path, draft.pendingIcon.blob, { contentType: draft.pendingIcon.type, cacheControl: '31536000', upsert: false });
        if (up.error) throw new Error('Falha ao enviar o ícone: ' + up.error.message);
        icon = sb.storage.from('perfis').getPublicUrl(path).data.publicUrl;
      }
      await rpc('update_room', { p_room: r.id, p_name: name.value.trim(), p_public: pub.checked });
      await rpc('set_vaquinha_goal', { p_room: r.id, p_goal: Math.round(Number(goal.value || 20) * 100) });
      await rpc('set_room_profile', { p_room: r.id, p_description: desc.value, p_category: cat.value || null, p_color: draft.color, p_icon: icon });
      if (draft.pendingIcon) URL.revokeObjectURL(draft.pendingIcon.url);
      draft.icon = icon; draft.pendingIcon = null; draft.removeIcon = false;
      await loadRooms();
      if (current && current.id === r.id) { $('room-title').textContent = findChat(r.id).name; current = findChat(r.id); }
      renderRail();
      toast('Sala atualizada.');
      dirtyLabel.hidden = false; dirtyLabel.textContent = 'Salvo'; dirtyLabel.classList.add('ok');
    } catch (err) { msg.textContent = err.message; toast(err.message, 4000); }
    save.disabled = false; save.textContent = 'Salvar alterações';
  });
  const del = h('button', { class: 'btn danger' }, 'Excluir sala');
  del.addEventListener('click', async () => {
    const ok = await confirmModal({ title: `Excluir ${r.name}?`, text: 'Todas as mensagens, canais e cargos serão apagados. Isso não tem volta.', confirm: 'Excluir', danger: true });
    if (!ok) return;
    try {
      if (call.roomId === r.id) await leaveCall();
      await rpc('delete_room', { p_room: r.id });
      closeConfig();
      await loadRooms();
      if (rooms[0]) openRoom(rooms[0].id); else renderEmpty();
      toast('Sala excluída.');
    } catch (err) { toast(err.message); }
  });
  paint();
  body.append(
    h('section', { class: 'cfg-card' },
      h('div', { class: 'rs-top' },
        h('div', { class: 'rs-icon-col' }, iconBox, change, draft.icon ? clear : null, file),
        h('div', { class: 'rs-fields' }, field('Nome da sala', name), field('Descrição', desc), field('Categoria em Explorar', cat),
          h('div', { class: 'field' }, h('span', { class: 'label' }, 'Cor da sala'), colors))),
      msg),
    h('section', { class: 'cfg-card' }, h('label', { class: 'cfg-row' }, h('span', { class: 'cfg-row-text' }, h('b', null, 'Meta da vaquinha (R$)'), h('small', null, 'Quando a barra enche, a sala inteira vê a explosão.')), goal)),
    h('section', { class: 'cfg-card' }, h('label', { class: 'cfg-row' }, h('span', { class: 'cfg-row-text' }, h('b', null, 'Sala pública'), h('small', null, 'Aparece em Explorar. Qualquer pessoa entra sem convite.')), pub)),
    h('section', { class: 'cfg-card' }, h('div', { class: 'cfg-row' }, h('span', { class: 'cfg-row-text' }, h('b', null, 'Excluir sala'), h('small', null, 'Apaga mensagens, canais e cargos de todo mundo. Não tem volta.')), del)),
    h('div', { class: 'cfg-savebar' }, dirtyLabel, save));
  body.addEventListener('input', markDirty);
  body.addEventListener('change', markDirty);
  void preview;
}

function paintRoomChannels(body) {
  const list = h('div', { class: 'cfg-card' });
  const paint = () => {
    list.replaceChildren(
      h('div', { class: 'cfg-row' }, h('h2', null, 'Canais da sala'), h('button', { class: 'btn primary', onClick: () => createChannelModal('text') }, '+ Criar canal')),
      ...(channels.length ? channels : []).map((c) => {
        const del = h('button', { class: 'btn secondary' }, 'Apagar');
        del.addEventListener('click', async () => {
          if (!(await confirmModal({ title: `Apagar ${c.kind === 'text' ? '#' : ''}${c.name}?`, text: c.kind === 'text' ? 'As mensagens do canal também são apagadas.' : 'Quem estiver na call do canal sai dela.', confirm: 'Apagar', danger: true }))) return;
          try { await rpc('delete_channel', { p_channel: c.id }); await loadChannels(); paint(); toast('Canal apagado.'); } catch (err) { toast(err.message); }
        });
        return h('div', { class: 'cfg-row' }, h('span', { class: 'cfg-row-text' }, h('b', null, (c.kind === 'text' ? '# ' : '🔊 ') + c.name), h('small', null, `${c.kind === 'text' ? 'Texto' : 'Voz'}${c.is_private ? ' · privado' : ''}`)), del);
      }),
      ...(channels.length ? [] : [h('p', { class: 'cfg-hint' }, 'Nenhum canal além do chat e da call padrão da sala.')]));
  };
  paint();
  body.append(list);
  const off = setInterval(() => { if (!list.isConnected) { clearInterval(off); return; } paint(); }, 4000);
}

function paintRoomMembers(body) {
  const list = h('div', { class: 'cfg-card' });
  const paint = () => {
    list.replaceChildren(...members.slice().sort((a, b) => a.name.localeCompare(b.name)).map((m) => {
      const role = roleOf(m);
      const b = h('button', { class: 'cfg-row cfg-member', type: 'button' },
        h('span', { class: 'cfg-member-who' }, avatarOf(m.user_id, m.name, '', true), h('b', { style: { color: nameColor(m) || '' } }, m.name)),
        h('small', null, m.base_role === 'owner' ? 'Dono' : m.base_role === 'moderator' ? 'Moderador' : role ? role.name : 'Membro'));
      b.addEventListener('click', () => memberMenu(b, m.user_id));
      return b;
    }));
  };
  paint();
  body.append(list);
}

const ROLE_COLORS = ['#99aab5', '#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63', '#f1c40f', '#e67e22', '#e74c3c', '#607d8b'];

function rolesModal() {
  if (configPane) closeModal();
  const list = h('div', { class: 'list' });
  const render = () => {
    list.innerHTML = '';
    if (!roles.length) list.append(h('p', { class: 'muted', style: { margin: 0 } }, 'Nenhum cargo ainda. Crie um para organizar a galera.'));
    for (const r of roles) {
      const perms = [r.can_manage_channels && 'gerenciar canais', r.can_kick && 'expulsar', r.can_ban && 'banir', r.can_manage_roles && 'gerenciar cargos', r.can_delete_messages && 'apagar mensagens'].filter(Boolean);
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
  presentPanel({
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
  const pc = perm('Gerenciar canais (criar e apagar)', 'can_manage_channels', 'manage_channels');
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
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Permissões'), h('div', { class: 'perm-grid' }, pk.el, pb.el, pm.el, pd.el, pc.el))],
    actions
  });
  save.addEventListener('click', async () => {
    if (!name.value.trim()) { toast('Dê um nome para o cargo.'); return; }
    const args = { p_name: name.value.trim(), p_color: color, p_kick: pk.cb.checked, p_ban: pb.cb.checked, p_manage: pm.cb.checked, p_delete: pd.cb.checked };
    try {
      let saved = role;
      if (role) await rpc('update_role', { p_role: role.id, ...args });
      else saved = await rpc('create_role', { p_room: current.id, ...args });
      if (saved && saved.id && pc.cb.checked !== Boolean(role && role.can_manage_channels)) await rpc('set_role_channels', { p_role: saved.id, p_value: pc.cb.checked });
      await loadMembers();
      rolesModal();
      toast(role ? 'Cargo salvo.' : 'Cargo criado.');
    } catch (err) { toast(err.message); }
  });
}

async function bansModal() {
  if (configPane) closeModal();
  const list = h('div', { class: 'list' }, h('p', { class: 'muted' }, 'Carregando…'));
  presentPanel({ title: 'Banidos', body: list });
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
  const banner = h('div', { class: 'pcard-banner', style: { background: p.banner_url ? 'var(--bg-0)' : (p.accent_color || colorFor(userId)) } },
    p.banner_url ? h('img', { src: p.banner_url, alt: '', referrerpolicy: 'no-referrer' }) : null);
  const role = m ? `${ROLE_LABEL[m.base_role]}${roleOf(m) ? ' · ' + roleOf(m).name : ''}` : null;
  return h('div', { class: 'pcard' },
    banner,
    h('div', { class: 'pcard-body' },
      (() => { const a = avatar(userId, name, 'xl', p.avatar_url, st); if (!p.avatar_url && p.accent_color) a.style.background = p.accent_color; return a; })(),
      h('div', { class: 'pcard-name', style: { color: m ? nameColor(m) || '' : '' } }, name),
      p.bio ? h('div', { class: 'pcard-bio' }, p.bio) : null,
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

// Dentro da tela de Configurações, os formulários de perfil, áudio e notificações aparecem no painel (não em janela).
let configPane = null;
function presentPanel(opts) {
  if (!configPane) return openModal(opts);
  const keep = (opts.actions || []).filter((b) => !['Pronto', 'Cancelar', 'Fechar'].includes(b.textContent));
  const kids = [].concat(opts.body).filter(Boolean);
  configPane.replaceChildren(h('section', { class: 'cfg-card cfg-form' }, ...kids), ...(keep.length ? [h('div', { class: 'cfg-actions' }, keep)] : []));
  return configPane;
}
const panelDone = () => { if (!configPane) closeModal(); };

function openConfigScreen(start) {
  openConfig({
    sb,
    getMe: () => me,
    getSession: () => session,
    avatarEl: () => { const a = avatarOf(me.id, me.display_name, '', true); a.classList.add('cfg-me-av'); return a; },
    mount: (name, container) => {
      const fn = { profile: profileModal, audio: settingsModal, notif: notifModal }[name];
      if (!fn) return;
      configPane = container;
      Promise.resolve(fn()).catch(() => {}).finally(() => { if (configPane === container) configPane = null; });
    },
    signOut: async () => { if (call.room) await leaveCall(true); await sb.auth.signOut(); location.reload(); },
    updates: async () => { if (!updates.length) await loadUpdates(); return updates; }
  }, start);
}

function profileModal() {
  const draft = { avatar_url: me.avatar_url || null, banner_url: me.banner_url || null };
  const pending = { avatar: null, banner: null };    // arquivos novos escolhidos
  const remove = { avatar: false, banner: false };
  const urls = [];
  const name = h('input', { maxlength: '32', value: me.display_name });
  const bio = h('input', { maxlength: '60', value: me.bio || '', placeholder: 'Ex.: goleiro reserva e DJ de churrasco' });
  let accent = me.accent_color || null;
  const colorRow = h('div', { class: 'cfg-swatches', role: 'radiogroup', 'aria-label': 'Cor do cartão' });
  const preview = h('div', { class: 'pcard pcard-preview' });
  const msg = h('p', { class: 'msg' });

  const render = () => {
    preview.innerHTML = '';
    const av = pending.avatar ? pending.avatar.url : remove.avatar ? null : draft.avatar_url;
    const bn = pending.banner ? pending.banner.url : remove.banner ? null : draft.banner_url;
    preview.append(
      h('div', { class: 'pcard-banner', style: { background: bn ? 'var(--bg-0)' : (accent || colorFor(me.id)) } }, bn ? h('img', { src: bn, alt: '' }) : null),
      h('div', { class: 'pcard-body' },
        (() => { const a = avatar(me.id, name.value || me.display_name, 'xl', av, statusOf(me.id)); if (!av && accent) a.style.background = accent; return a; })(),
        h('div', { class: 'pcard-name' }, name.value || me.display_name),
        bio.value.trim() ? h('div', { class: 'pcard-bio' }, bio.value.trim()) : null,
        h('div', { class: 'pcard-status' }, statusDot(statusOf(me.id)), STATUS[statusOf(me.id)].label)));
  };
  name.addEventListener('input', render);
  bio.addEventListener('input', render);
  const paintColors = () => colorRow.replaceChildren(...ONB_COLORS.map((hex) => h('button', { type: 'button', class: 'cfg-swatch', role: 'radio', 'aria-label': `Cor ${hex}`, 'aria-checked': String((accent || '').toLowerCase() === hex.toLowerCase()), style: { background: hex, '--ring': hex, width: '32px', height: '32px' }, onClick: () => { accent = (accent || '').toLowerCase() === hex.toLowerCase() ? null : hex; paintColors(); render(); } },
    h('span', { html: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>' }))));
  paintColors();

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
  presentPanel({
    title: 'Perfil',
    body: [
      preview,
      btnRow('Foto de perfil', avIn, 'avatar'),
      btnRow('Banner', bnIn, 'banner'),
      h('p', { class: 'hint' }, 'PNG, JPG, WebP ou GIF. Foto até 4 MB e banner até 8 MB. GIF continua animado.'),
      field('Nome de exibição', name),
      field('Recado', bio),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Cor do cartão'), colorRow),
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
    const patch = { display_name: v, bio: bio.value.trim().slice(0, 60) || null, accent_color: accent };
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
      panelDone();
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
  presentPanel({
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
  const filters = [['echoCancellation', 'Cancelamento de eco'], ['autoGainControl', 'Ajuste automático de volume do microfone']]
    .map(([k, label]) => {
      const cb = h('input', { type: 'checkbox', checked: s[k] });
      cb.addEventListener('change', async () => {
        const cur = loadSettings(); cur[k] = cb.checked; saveSettings(cur);
        await applyAudioFilters();
      });
      return h('label', { class: 'check' }, cb, label);
    });
  const noiseSel = h('select', { 'aria-label': 'Supressão de ruído' },
    h('option', { value: 'rnnoise' }, 'Forte (recomendado): tira ventilador, teclado e barulho de fundo'),
    h('option', { value: 'browser' }, 'Padrão do navegador'),
    h('option', { value: 'off' }, 'Desligado'));
  noiseSel.value = s.noiseMode;
  noiseSel.addEventListener('change', async () => {
    const cur = loadSettings(); cur.noiseMode = noiseSel.value; cur.noiseChosen = true; saveSettings(cur);
    await applyAudioFilters();
    if (testing) { await stopTest(); await startTest(); }
  });
  let testing = null;
  const testMsg = h('p', { class: 'hint' }, 'O teste toca a sua voz já filtrada no seu fone. Use fone de ouvido para não dar eco.');
  const testBtn = h('button', { type: 'button', class: 'btn secondary' }, 'Ouvir meu microfone com o filtro');
  async function stopTest() { if (testing) { const t = testing; testing = null; await t.stop(); } testBtn.textContent = 'Ouvir meu microfone com o filtro'; testBtn.classList.remove('on'); }
  async function startTest() {
    testBtn.disabled = true;
    try {
      const cur = loadSettings();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: cur.audioinput || undefined, echoCancellation: false, noiseSuppression: cur.noiseMode === 'browser', autoGainControl: false } });
      const { startMicTest } = await import('./mic.js');
      testing = await startMicTest(stream, { noise: cur.noiseMode === 'rnnoise', voice: 'normal' }, (lvl) => { meter.firstChild.style.width = Math.round(lvl * 100) + '%'; });
      testBtn.textContent = 'Parar o teste'; testBtn.classList.add('on');
    } catch (err) { testMsg.textContent = 'Não consegui abrir o teste: ' + (err && err.message ? err.message : 'sem acesso ao microfone.'); }
    testBtn.disabled = false;
  }
  testBtn.addEventListener('click', () => (testing ? stopTest() : startTest()));
  const mirror = h('input', { type: 'checkbox', checked: s.mirrorCam });
  mirror.addEventListener('change', () => {
    const cur = loadSettings(); cur.mirrorCam = mirror.checked; saveSettings(cur);
    call.onChange();
  });
  const meter = h('div', { class: 'meter' }, h('div'));
  const body = [
    await mk('audioinput', 'Microfone'),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Teste do microfone'), meter),
    await mk('audiooutput', 'Saída de áudio'),
    await mk('videoinput', 'Câmera'),
    h('label', { class: 'check' }, mirror, 'Espelhar minha câmera (só para você; os outros veem normal)'),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Supressão de ruído'), noiseSel, h('div', { class: 'ns-test' }, testBtn), testMsg),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Processamento de voz'), ...filters),
    h('p', { class: 'hint' }, 'Se os nomes dos dispositivos não aparecerem, permita o microfone no navegador e abra de novo.')
  ];
  presentPanel({ title: 'Áudio e vídeo', body, actions: [h('button', { class: 'btn primary', onClick: closeModal }, 'Pronto')] });
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
  items.push({ label: 'Configurações da sala', onClick: () => roomSettingsScreen(mine && mine.base_role === 'owner' ? 'overview' : 'members') });
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
    { label: 'Editar perfil', onClick: () => openConfigScreen('profile') },
    { label: 'Notificações', onClick: () => openConfigScreen('notif') },
    { label: 'Áudio e vídeo', onClick: () => openConfigScreen('audio') },
    { label: 'Configurações', onClick: () => openConfigScreen('look') });
  if (installPrompt) items.push({ label: 'Instalar app no PC', onClick: installApp });
  items.push('sep', { label: 'Sair da conta', danger: true, onClick: async () => { if (call.room) await leaveCall(true); await sb.auth.signOut(); location.reload(); } });
  openMenu($('me-btn'), items, { above: true });
}

// ---------- Botões fixos ----------
function wireStatic() {
  wireChat();
  $('create-room-btn').addEventListener('click', addRoomModal);
  $('explore-btn').addEventListener('click', exploreModal);
  $('room-menu-btn').addEventListener('click', roomMenu);
  $('me-btn').addEventListener('click', meMenu);
  $('ch-chat').addEventListener('click', () => current && selectTextChannel(null));
  $('ch-updates').addEventListener('click', () => setView('updates'));
  loadUpdates();
  $('ch-call').addEventListener('click', () => {
    if (!current) return;
    if (call.room && call.roomId === current.id && !call.channelId) setView('call');
    else enterCall();
  });
  $('join-call-btn').addEventListener('click', () => enterCall());
  $('call-card-join').addEventListener('click', () => enterCall());
  $('call-banner-join').addEventListener('click', () => enterCall());
  $('add-text-ch').addEventListener('click', () => createChannelModal('text'));
  $('add-voice-ch').addEventListener('click', () => createChannelModal('voice'));
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
  $('ch-shop').addEventListener('click', openShop);
  setupThemeToggle($('theme-btn'));
  $('mic-btn').addEventListener('click', toggleMic);
  $('mic-btn-2').addEventListener('click', toggleMic);
  $('deaf-btn').addEventListener('click', () => setDeafened(!call.deafened));
  $('settings-btn').addEventListener('click', () => openConfigScreen('look'));
  $('cam-btn').addEventListener('click', toggleCam);
  $('cam-btn-2').addEventListener('click', toggleCam);
  $('speaker-btn-2').addEventListener('click', () => setDeafened(!call.deafened));
  // Celular sem transmissão de tela (iPhone e a maioria dos Android): esconde o botão em vez de dar erro.
  if (!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) { $('screen-btn').hidden = true; $('screen-btn-2').hidden = true; }
  $('screen-btn').addEventListener('click', shareAction);
  $('screen-btn-2').addEventListener('click', shareAction);
  $('hangup-btn').addEventListener('click', () => leaveCall().then(startPreviewPolling));
  $('hangup-btn-2').addEventListener('click', () => leaveCall().then(startPreviewPolling));
  $('stage-prev').addEventListener('click', () => moveStageFocus(-1));
  $('stage-next').addEventListener('click', () => moveStageFocus(1));
  $('call-chat-btn').addEventListener('click', () => current && setView('chat'));
  for (const b of document.querySelectorAll('.act-tab')) {
    b.addEventListener('click', () => {
      const act = b.dataset.act;
      for (const o of document.querySelectorAll('.act-tab')) o.classList.toggle('on', o === b);
      actOpen = act !== 'call';
      if (actOpen) setPanelView(act === 'watch' ? 'watch' : 'music');
      applyAct();
    });
  }
  $('return-call-btn').addEventListener('click', () => call.room && setView('call'));
  $('members-toggle').addEventListener('click', () => {
    const p = $('members-panel');
    if (innerWidth <= 1100) p.classList.toggle('open');
    else {
      p.classList.toggle('closed');
      if (!p.classList.contains('closed')) {
        p.classList.add('cascade');
        setTimeout(() => p.classList.remove('cascade'), 1100);
      }
    }
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
  window.addEventListener('keydown', (event) => {
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || !call.room) return;
    const k = event.key.toLowerCase();
    const actions = { m: toggleMic, d: () => setDeafened(!call.deafened), l: () => leaveCall() };
    if (!actions[k]) return;
    event.preventDefault();
    actions[k]();
  });
  // Botão direito em uma pessoa (lista de membros, call, nome ou foto no chat): abre o menu dela, com expulsar e banir
  document.addEventListener('contextmenu', (e) => {
    if (!current || !e.target.closest) return;
    const t = e.target.closest('[data-uid], [data-identity]');
    if (!t) return;
    const id = t.dataset.uid || t.dataset.identity;
    if (!id || !(profs.has(id) || names.has(id) || members.some((x) => x.user_id === id))) return;
    e.preventDefault();
    memberMenu(t, id, { x: e.clientX, y: e.clientY });
  });
  $('vb-sub').addEventListener('click', () => { if (call.roomId) { openRoom(call.roomId); } });
  window.addEventListener('beforeunload', () => { if (call.room) call.room.disconnect(); });
}
