// Música da call e assistir junto (DJ Resenha).
// O estado (tocando, fila, pausa, controle) fica no banco (tabela call_music) e chega a todos por realtime.
// O áudio e o vídeo tocam no player oficial do YouTube (IFrame API) em cada navegador, sincronizados pelo relógio do servidor.
// Nada é baixado nem retransmitido.
import { h, $, toast, avatar, colorFor } from './ui.js';

export const MUSIC_COMMANDS = [
  { cmd: 'm!play', alias: ['m!p'], desc: 'Toca ou põe na fila', example: 'm!play nome ou link' },
  { cmd: 'm!skip', alias: ['m!s'], desc: 'Pula a música (3 votos)', example: 'm!skip' },
  { cmd: 'm!pause', alias: [], desc: 'Pausa para todos', example: 'm!pause' },
  { cmd: 'm!resume', alias: ['m!r'], desc: 'Volta a tocar', example: 'm!resume' },
  { cmd: 'm!queue', alias: ['m!q'], desc: 'Mostra a fila', example: 'm!queue' },
  { cmd: 'm!np', alias: [], desc: 'O que está tocando', example: 'm!np' },
  { cmd: 'm!loop', alias: [], desc: 'Liga ou desliga o loop', example: 'm!loop' },
  { cmd: 'm!volume', alias: ['m!vol'], desc: 'Volume só para você', example: 'm!volume 0-100' },
  { cmd: 'm!leave', alias: ['m!stop'], desc: 'Para e limpa a fila', example: 'm!leave' },
  { cmd: 'm!help', alias: ['m!h'], desc: 'Lista os comandos', example: 'm!help' }
];

export function parseMusic(text) {
  const t = String(text || '').trim();
  if (!/^m!/i.test(t)) return null;
  const [raw, ...rest] = t.split(/\s+/);
  const word = raw.toLowerCase();
  const def = MUSIC_COMMANDS.find((c) => c.cmd === word || c.alias.includes(word));
  if (!def) return { error: `Comando ${raw} não existe · Manda m!help` };
  return { cmd: def.cmd.slice(2), arg: t.slice(raw.length).trim() };
}

const VOL_KEY = 'resenha:dj-volume';
const st = {
  sb: null, api: null, roomId: null, channelId: null, key: null, sub: null, rx: null,
  state: null, skew: 0, player: null, playerReady: false, loadedId: null, vol: 70, tick: null,
  panel: null, frame: null, raf: 0, hooks: { isPinned: null, togglePin: null, onClose: null }, view: 'music', listeners: new Set(), who: () => [], me: null, nameOf: () => 'Alguém', roomCanModerate: false
};
try { const v = parseInt(localStorage.getItem(VOL_KEY), 10); if (Number.isFinite(v)) st.vol = Math.max(0, Math.min(100, v)); } catch (_) {}

export function initMusic({ sb, api, me, participants, nameOf }) {
  st.sb = sb; st.api = api; st.me = me; st.who = participants || (() => []); st.nameOf = nameOf || (() => 'Alguém');
}
export const getMusic = () => st.state;
export const onMusic = (fn) => { st.listeners.add(fn); return () => st.listeners.delete(fn); };
const emit = () => { for (const fn of st.listeners) fn(st.state); };

const callKey = (roomId, channelId) => (channelId ? `${roomId}:${channelId}` : roomId);
export function targetPos() {
  const s = st.state;
  if (!s || !s.current || !s.started_at) return 0;
  const t0 = Date.parse(s.started_at);
  const end = s.paused_at ? Date.parse(s.paused_at) : Date.now() + st.skew;
  return Math.max(0, (end - t0) / 1000);
}
const fmt = (sec) => { const s = Math.max(0, Math.floor(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function apply(res) {
  if (!res) return;
  if (res.now) st.skew = Date.parse(res.now) - Date.now();
  if ('state' in res) st.state = res.state;
  syncPlayer();
  paint();
  emit();
}

// ---------- Entrar e sair da call ----------
export async function musicJoin(roomId, channelId) {
  const key = callKey(roomId, channelId || null);
  if (st.key === key) return;
  musicLeave(true);
  st.roomId = roomId; st.channelId = channelId || null; st.key = key;
  try {
    const { data, error } = await st.sb.rpc('music_state', { p_room: roomId, p_channel: st.channelId });
    if (error) throw error;
    apply(data);
  } catch (_) { st.state = null; }
  st.sub = st.sb.channel('musica-' + key)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'call_music', filter: `call_key=eq.${key}` }, (p) => {
      if (p.new && p.new.call_key === key) { st.state = p.new; syncPlayer(); paint(); emit(); }
    })
    .on('broadcast', { event: 'reacao' }, ({ payload }) => floatReaction(payload && payload.text))
    .subscribe();
  st.rx = st.sub;
  clearInterval(st.tick);
  st.tick = setInterval(() => { syncPlayer(); paintProgress(); }, 1000);
}

export function musicLeave(keepPanel) {
  clearInterval(st.tick); st.tick = null;
  if (st.sub) { try { st.sb.removeChannel(st.sub); } catch (_) {} st.sub = null; }
  if (st.player && st.playerReady) { try { st.player.stopVideo(); } catch (_) {} }
  st.loadedId = null; st.state = null; st.key = null; st.roomId = null; st.channelId = null;
  if (!keepPanel) { setPanelOpen(false); paint(); emit(); }
}

// ---------- Comandos ----------
export async function musicCommand(cmd, arg = {}) {
  if (!st.roomId) throw new Error('Entre numa call primeiro.');
  const { data, error } = await st.sb.rpc('music_command', { p_room: st.roomId, p_channel: st.channelId, p_cmd: cmd, p_arg: arg });
  if (error) throw new Error(String(error.message || 'Não deu certo.').replace(/^.*?:\s*/, ''));
  apply(data);
  return data;
}

export function youtubeId(text) {
  const t = String(text || '').trim();
  const m = t.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{6,20})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{11}$/.test(t) && !t.includes(' ') ? null : null;
}

export async function resolveTrack(input) {
  let text = String(input || '').trim();
  let id = youtubeId(text);
  // Link do Spotify, Deezer, Apple Music ou SoundCloud: descobre a música e toca a versão do YouTube
  if (!id && /^https?:\/\//i.test(text)) {
    const meta = await st.api(`/api/track-info?url=${encodeURIComponent(text)}`);
    text = meta.query;
  }
  const info = id ? await st.api(`/api/youtube-info?id=${encodeURIComponent(id)}`) : await st.api(`/api/youtube-search?q=${encodeURIComponent(text)}`);
  return { id: info.id, title: info.title, author: info.author, thumb: info.thumb };
}

export async function addTrack(input, mode) {
  const text = String(input || '').trim();
  if (!text) throw new Error('Escreva o nome da música ou cole um link.');
  const track = await resolveTrack(text);
  return musicCommand('play', { ...track, mode: mode || (st.state && st.state.mode) || 'music' });
}

// Executa um comando m! digitado no chat
export async function runChatCommand(req) {
  const s = st.state;
  const say = (type, title, text) => musicCommand('say', { type, title, text });
  switch (req.cmd) {
    case 'play': await addTrack(req.arg, 'music'); break;
    case 'skip': { const r = await musicCommand('skip'); if (r && r.votes) toast(`${r.votes} de 3 votos para pular`); break; }
    case 'pause': await musicCommand('pause'); break;
    case 'resume': await musicCommand('resume'); break;
    case 'loop': await musicCommand('loop'); break;
    case 'leave': await musicCommand('stop'); break;
    case 'queue': {
      const q = (s && s.queue) || [];
      const lines = [s && s.current ? `Agora: ${s.current.title}` : 'Nada tocando agora', ...q.slice(0, 10).map((t, i) => `${i + 1}. ${t.title} · ${t.byName}`)];
      await say('music_text', 'FILA', q.length || (s && s.current) ? lines.join('\n') : 'A fila está vazia.');
      break;
    }
    case 'np': await say('music_text', 'TOCANDO AGORA', s && s.current ? `${s.current.title}${s.current.author ? ' · ' + s.current.author : ''}\nPedido por ${s.current.byName}${s.paused_at ? ' · pausado' : ''}` : 'Nada tocando agora.'); break;
    case 'volume': {
      if (req.arg === '') { toast(`Volume: ${st.vol}%`); break; }
      const v = parseInt(req.arg, 10);
      if (!Number.isFinite(v) || v < 0 || v > 100) { toast('Use m!volume de 0 a 100.'); break; }
      setVolume(v); toast(`Volume: ${v}%`); break;
    }
    case 'help': await say('music_text', 'COMANDOS', MUSIC_COMMANDS.map((c) => `${c.cmd}${c.alias.length ? ' (' + c.alias.join(', ') + ')' : ''} — ${c.desc}`).join('\n')); break;
    default: break;
  }
}

export function setVolume(v) {
  st.vol = Math.max(0, Math.min(100, Math.round(v)));
  try { localStorage.setItem(VOL_KEY, String(st.vol)); } catch (_) {}
  applyPlayerVolume();
  paint();
}
// No iPhone/iPad o YouTube ignora setVolume (só o botão físico muda o volume): lá o controle vira ligar/silenciar.
const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
function applyPlayerVolume() {
  const p = st.player;
  if (!p || !st.playerReady) return;
  try {
    p.setVolume(st.vol);
    if (st.vol === 0) p.mute(); else if (p.isMuted()) p.unMute();
  } catch (_) {}
}

// ---------- Player do YouTube ----------
// Celular não deixa o player começar com som sem um toque da pessoa. Lá mostramos um botão "Toque para ouvir"
// e o próprio player aceita toque (controles do YouTube ligados).
const IS_MOBILE = (navigator.userAgentData && navigator.userAgentData.mobile)
  || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
let unlockBtn = null;
function showUnlock(show) {
  if (show && !unlockBtn) {
    unlockBtn = h('button', { type: 'button', class: 'yt-unlock' }, '▶ Toque para ouvir e ver junto');
    unlockBtn.addEventListener('click', unlockPlayback);
    document.body.append(unlockBtn);
  }
  if (unlockBtn) unlockBtn.hidden = !show;
}
function unlockPlayback() {
  const p = st.player;
  if (p && st.playerReady) {
    try { applyPlayerVolume(); p.playVideo(); } catch (_) {}
  }
  showUnlock(false);
  // Se o sistema ainda segurar, abre o painel para a pessoa tocar direto no vídeo
  setTimeout(() => {
    if (!isActuallyPlaying()) {
      if (st.panel && !st.panel.classList.contains('open') && !document.querySelector('#stage .watch-slot')) setPanelOpen(true);
      toast('Toque no vídeo para começar a tocar.', 4000);
    }
  }, 1500);
}
function isActuallyPlaying() {
  const p = st.player;
  if (!p || !st.playerReady) return false;
  try { return p.getPlayerState() === 1 && (st.vol === 0 || !p.isMuted()); } catch (_) { return false; }
}
// Roda a cada segundo junto com syncPlayer: se faz mais de 2,5 s que devia estar tocando e não está, mostra o botão.
let notPlayingSince = 0;
function checkBlocked() {
  const s = st.state;
  if (!s || !s.current || s.paused_at || isActuallyPlaying()) { notPlayingSince = 0; showUnlock(false); return; }
  if (!notPlayingSince) notPlayingSince = Date.now();
  if (Date.now() - notPlayingSince > 2500) showUnlock(true);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && st.player && st.playerReady) { syncPlayer(); }
});

let ytPromise = null;
function loadYT() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (!ytPromise) ytPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { ytPromise = null; reject(new Error('Não consegui carregar o player do YouTube.')); };
    document.head.append(s);
  });
  return ytPromise;
}

async function ensurePlayer() {
  if (st.player || !st.panel) return;
  const host = st.frame && st.frame.querySelector('.yt-slot');
  if (!host) return;
  try {
    const YT = await loadYT();
    if (st.player) return;
    st.player = new YT.Player(host, {
      width: '100%', height: '100%',
      playerVars: { controls: IS_MOBILE ? 1 : 0, disablekb: 1, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, fs: 0 },
      events: {
        onReady: () => { st.playerReady = true; applyPlayerVolume(); syncPlayer(); },
        onStateChange: (e) => {
          if (e.data === 1 && unlockBtn && !unlockBtn.hidden && isActuallyPlaying()) showUnlock(false);
          if (e.data === 0 && st.state && st.state.current) {
            const id = st.state.current.id;
            setTimeout(() => musicCommand('ended', { id, quiet: true }).catch(() => {}), Math.random() * 700);
          }
        }
      }
    });
  } catch (err) { toast(err.message); }
}

function syncPlayer() {
  const s = st.state;
  if (s && s.current) ensurePlayer();
  const p = st.player;
  if (!p || !st.playerReady) return;
  try {
    if (!s || !s.current) { showUnlock(false); if (st.loadedId) { p.stopVideo(); st.loadedId = null; } return; }
    checkBlocked();
    const id = s.current.id;
    const pos = targetPos();
    const paused = Boolean(s.paused_at);
    if (st.loadedId !== id) {
      st.loadedId = id;
      p.loadVideoById({ videoId: id, startSeconds: pos });
      applyPlayerVolume();
      if (paused) setTimeout(() => { try { p.pauseVideo(); } catch (_) {} }, 700);
      return;
    }
    const cur = p.getCurrentTime();
    if (Math.abs(cur - pos) > 3) p.seekTo(pos, true);
    const ps = p.getPlayerState();
    if (paused && ps === 1) p.pauseVideo();
    else if (!paused && (ps === 2 || ps === 5 || ps === -1)) p.playVideo();
  } catch (_) {}
}

// ---------- Painel (Música e Assistir junto) ----------
export function setPanelView(view) { st.view = view; paint(); }
export function refreshMusicPanel() { paint(); }
export function setPanelOpen(open) {
  if (!st.panel) return;
  st.panel.classList.toggle('open', open);
  st.panel.setAttribute('aria-hidden', String(!open));
  if (open) ensurePlayer();
  paint();
}

function trackThumb(t, cls) {
  const el = h('span', { class: cls || 'mq-thumb', style: { background: colorFor(t.id || 'x') } });
  if (t.thumb) el.style.backgroundImage = `url("${t.thumb}")`;
  return el;
}

function floatReaction(text) {
  if (!text || !st.frame) return;
  const el = h('span', { class: 'reaction-float', style: { left: 10 + Math.random() * 70 + '%' } }, String(text).slice(0, 12));
  st.frame.append(el);
  setTimeout(() => el.remove(), 2600);
}

// Ganchos para o resto do app: fixar o vídeo no palco e fechar o painel
export function setMusicHooks(hooks) { Object.assign(st.hooks, hooks); }

export function mountMusicPanel(parent) {
  if (st.panel) return st.panel;
  // O player do YouTube mora num quadro solto na tela e é posicionado em cima do lugar certo (painel ou palco).
  // Assim ele nunca é movido de lugar no DOM, o que reiniciaria o vídeo.
  st.frame = h('div', { class: 'yt-frame', 'aria-hidden': 'true' }, h('div', { class: 'yt-slot' }), h('div', { class: 'yt-idle', id: 'yt-idle' }, 'Nada tocando'));
  document.body.append(st.frame);
  const el = h('aside', { class: 'act-panel', 'aria-label': 'Música e assistir junto', 'aria-hidden': 'true' });
  el.innerHTML = `
    <div class="ap-head"><div class="ap-head-text"><h2 id="ap-title">Música da call</h2><span id="ap-sub" class="ap-sub"></span></div>
      <button type="button" class="ap-close" id="ap-close" aria-label="Fechar painel" title="Fechar"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <div class="ap-scroll">
      <div class="cd-card" id="cd-card">
        <div class="cd-wrap"><span class="cd-disc"></span><div class="yt-hold" id="yt-hold"><p class="yt-note" id="yt-note"></p></div></div>
        <div class="cd-info">
          <span class="cd-label" id="cd-label">TOCANDO PRA CALL</span>
          <b class="cd-title" id="cd-title"></b>
          <span class="cd-by" id="cd-by"></span>
        </div>
        <div class="cd-bar"><i id="cd-fill"></i></div>
        <div class="cd-times"><span id="cd-pos">0:00</span><span id="cd-dur"></span></div>
        <div class="cd-controls" id="cd-controls"></div>
        <label class="cd-vol"><span>Volume pra você</span><input type="range" min="0" max="100" id="cd-vol" aria-label="Volume pra você"><output id="cd-vol-out"></output></label>
        <div class="cd-vol-ios" id="cd-vol-ios" hidden><button type="button" class="btn" id="cd-mute">Silenciar música</button><p class="hint">No iPhone o volume da música segue o botão do aparelho. Aqui dá para silenciar ou ligar.</p></div>
        <div class="cd-reactions" id="cd-reactions" hidden></div>
      </div>
      <form class="ap-add" id="ap-add"><label class="label" for="ap-input" id="ap-add-label">Pedir música</label>
        <div class="ap-add-row"><input id="ap-input" autocomplete="off"><button class="btn primary" type="submit" id="ap-add-btn">Adicionar</button></div>
        <p class="hint" id="ap-hint"></p></form>
      <div class="ap-queue"><div class="ap-queue-title" id="ap-queue-title">PRÓXIMAS</div><div id="ap-queue"></div></div>
    </div>`;
  parent.append(el);
  st.panel = el;
  el.querySelector('#ap-close').addEventListener('click', () => { if (st.hooks.onClose) st.hooks.onClose(); else setPanelOpen(false); });
  el.querySelector('#cd-vol').value = String(st.vol);
  el.querySelector('#cd-vol-ios').hidden = !IS_IOS;
  if (IS_IOS) el.querySelector('.cd-vol').hidden = true;
  el.querySelector('#cd-mute').addEventListener('click', () => {
    if (st.vol === 0) setVolume(st.lastVol || 70); else { st.lastVol = st.vol; setVolume(0); }
  });
  el.querySelector('#cd-vol').addEventListener('input', (e) => setVolume(Number(e.target.value)));
  el.querySelector('#ap-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = el.querySelector('#ap-input');
    const btn = el.querySelector('#ap-add-btn');
    if (!input.value.trim()) return;
    btn.disabled = true; btn.textContent = 'Buscando…';
    try { await addTrack(input.value, st.view === 'watch' ? 'watch' : 'music'); input.value = ''; }
    catch (err) { toast(err.message, 4500); }
    btn.disabled = false; btn.textContent = 'Adicionar';
  });
  for (const text of ['KKKKK', 'GOOOL', 'NÃÃÃO']) {
    const b = h('button', { type: 'button', class: 'cd-react' }, text);
    b.addEventListener('click', () => { if (st.rx) st.rx.send({ type: 'broadcast', event: 'reacao', payload: { text } }); floatReaction(text); });
    el.querySelector('#cd-reactions').append(b);
  }
  window.addEventListener('resize', placeFrame);
  paint();
  return el;
}

// Coloca o quadro do player em cima do lugar certo: o vídeo fixado no palco, ou o espaço do painel
function placeFrame() {
  const f = st.frame;
  if (!f) return false;
  const s = st.state;
  const cur = s && s.current;
  const stageSlot = document.querySelector('#stage .watch-slot');
  const panelOpen = st.panel && st.panel.classList.contains('open');
  const view = st.view;
  const modeMatches = !cur || s.mode === view;
  let target = null, z = 27;
  if (stageSlot && cur && s.mode === 'watch') { target = stageSlot; z = 25; }
  else if (panelOpen && modeMatches) target = st.panel.querySelector('#yt-hold');
  if (!target) {
    // Sem lugar para mostrar: fica fora da tela, mas continua tocando
    f.style.cssText = 'left:-9999px;top:0;width:200px;height:200px;visibility:visible';
    f.classList.remove('shown');
    return false;
  }
  const r = target.getBoundingClientRect();
  f.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:${z};border-radius:${target === stageSlot ? 18 : 16}px`;
  f.classList.add('shown');
  return true;
}
function frameLoop() {
  cancelAnimationFrame(st.raf);
  const tick = () => {
    const shown = placeFrame();
    // Enquanto o quadro está visível, acompanha animações (painel deslizando, layout mudando)
    st.raf = shown || (st.panel && st.panel.classList.contains('open')) ? requestAnimationFrame(tick) : 0;
  };
  tick();
}

function paintProgress() {
  if (!st.panel) return;
  const s = st.state;
  const pos = targetPos();
  const dur = st.player && st.playerReady && s && s.current ? (() => { try { return st.player.getDuration() || 0; } catch (_) { return 0; } })() : 0;
  const fill = st.panel.querySelector('#cd-fill');
  if (fill) fill.style.width = dur ? Math.min(100, (pos / dur) * 100) + '%' : '0%';
  const p = st.panel.querySelector('#cd-pos'); if (p) p.textContent = fmt(pos);
  const d = st.panel.querySelector('#cd-dur'); if (d) d.textContent = dur ? fmt(dur) : '';
}

function paint() {
  const el = st.panel;
  if (!el) return;
  const s = st.state;
  const cur = s && s.current;
  // A tela é a da aba escolhida (Música ou Assistir junto). Se estiver tocando o outro tipo, avisa e mostra o que está tocando.
  const watch = st.view === 'watch';
  const other = Boolean(cur && s.mode !== st.view);
  const pinned = Boolean(st.hooks.isPinned && st.hooks.isPinned());
  el.classList.toggle('watch', watch);
  el.classList.toggle('playing', Boolean(cur && !s.paused_at && !other));
  el.classList.toggle('idle', !cur || other);
  el.classList.toggle('other-mode', other);
  el.querySelector('#ap-title').textContent = watch ? 'Assistir junto' : 'Música da call';
  const meId = st.me && st.me.id;
  const ctrl = s && s.controller;
  const canControl = !(s && s.mode === 'watch') || !ctrl || ctrl === meId || st.roomCanModerate;
  el.querySelector('#ap-sub').textContent = cur && s.mode === 'watch' ? `Sincronizado · ${st.nameOf(ctrl)} controla` : '';
  el.querySelector('#cd-label').textContent = s && s.mode === 'watch' ? 'ASSISTINDO JUNTO' : 'TOCANDO PRA CALL';
  el.querySelector('#cd-title').textContent = cur ? cur.title : '';
  const note = el.querySelector('#yt-note');
  if (other) note.textContent = s.mode === 'watch' ? 'Tem um vídeo passando em "Assistir junto". Pedir uma música aqui troca o vídeo.' : 'Tem uma música tocando. Pedir um vídeo aqui troca a música.';
  else if (!cur) note.textContent = watch ? 'Nenhum vídeo ainda.' : 'Nada tocando.';
  else if (watch && pinned) note.textContent = 'O vídeo está fixado no palco.';
  else note.textContent = '';
  el.querySelector('#cd-by').textContent = cur ? `${cur.author ? cur.author + ' · ' : ''}pedido por ${cur.byName}` : (watch ? 'Cole o link de um vídeo do YouTube para todo mundo assistir junto.' : 'Escreva o nome de uma música ou cole um link.');
  const idle = st.frame && st.frame.querySelector('#yt-idle');
  if (idle) idle.hidden = Boolean(cur && !other);
  el.querySelector('#cd-reactions').hidden = !(cur && s.mode === 'watch');
  el.querySelector('#cd-vol-out').textContent = st.vol + '%';
  el.querySelector('#cd-vol').value = String(st.vol);
  el.querySelector('#cd-mute').textContent = st.vol === 0 ? 'Ligar som da música' : 'Silenciar música';
  el.querySelector('#ap-add-label').textContent = watch ? 'Pedir vídeo' : 'Pedir música';
  el.querySelector('#ap-input').placeholder = watch ? 'Cole o link do vídeo do YouTube' : 'Nome da música ou link (YouTube, Spotify, Deezer…)';
  el.querySelector('#ap-hint').textContent = watch ? 'No chat: m!play link do vídeo' : 'No chat também funciona: m!play nome da música';
  // controles
  const controls = el.querySelector('#cd-controls');
  controls.replaceChildren();
  if (cur) {
    const paused = Boolean(s.paused_at);
    const wm = s.mode === 'watch';
    const pp = h('button', { type: 'button', class: 'cd-pp', disabled: !canControl, 'aria-label': paused ? 'Tocar' : 'Pausar', title: paused ? 'Tocar' : 'Pausar',
      html: paused ? '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' : '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>' });
    pp.addEventListener('click', () => musicCommand(paused ? 'resume' : 'pause', { quiet: true }).catch((e) => toast(e.message)));
    controls.append(pp);
    if (wm) {
      for (const [label, delta] of [['−10s', -10], ['+10s', 10]]) {
        const b = h('button', { type: 'button', class: 'cd-skip', disabled: !canControl }, label);
        b.addEventListener('click', () => musicCommand('seek', { pos: Math.max(0, targetPos() + delta), quiet: true }).catch((e) => toast(e.message)));
        controls.append(b);
      }
      const members = st.who().filter((x) => x.identity !== ctrl);
      if (canControl && members.length) {
        const pass = h('select', { class: 'cd-pass', 'aria-label': 'Passar controle' }, h('option', { value: '' }, 'Passar controle'), ...members.map((x) => h('option', { value: x.identity }, x.name)));
        pass.addEventListener('change', () => { if (pass.value) musicCommand('control', { to: pass.value, quiet: true }).catch((e) => toast(e.message)); });
        controls.append(pass);
      }
      // Fixar o vídeo como quadro principal da call
      const pin = h('button', { type: 'button', class: 'cd-skip cd-pin' + (pinned ? ' on' : ''), 'aria-pressed': String(pinned) }, pinned ? 'Soltar do palco' : 'Fixar no palco');
      pin.addEventListener('click', () => { if (st.hooks.togglePin) st.hooks.togglePin(); });
      controls.append(pin);
    }
    const votes = (s.skip_votes || []).length;
    const skip = h('button', { type: 'button', class: 'cd-skip' }, wm ? 'Próximo' : `Pular${votes ? ` · ${votes} de 3 votos` : ''}`);
    skip.addEventListener('click', async () => { try { const r = await musicCommand('skip', { quiet: true }); if (r && r.votes) toast(`${r.votes} de 3 votos para pular`); } catch (e) { toast(e.message); } });
    controls.append(skip);
    const loop = h('button', { type: 'button', class: 'cd-skip' + (s.looping ? ' on' : ''), 'aria-pressed': String(Boolean(s.looping)) }, 'Loop');
    loop.addEventListener('click', () => musicCommand('loop', { quiet: true }).catch((e) => toast(e.message)));
    controls.append(loop);
    const stop = h('button', { type: 'button', class: 'cd-skip' }, 'Parar');
    stop.addEventListener('click', () => musicCommand('stop', { quiet: true }).catch((e) => toast(e.message)));
    controls.append(stop);
  }
  // fila
  const q = (s && s.queue) || [];
  el.querySelector('#ap-queue-title').textContent = `PRÓXIMAS · ${q.length}`;
  el.querySelector('#ap-queue').replaceChildren(...(q.length ? q.map((t, i) => {
    const row = h('div', { class: 'mq-row' }, trackThumb(t), h('span', { class: 'mq-text' }, h('b', null, t.title), h('small', null, t.byName)));
    if (t.by === meId || st.roomCanModerate) {
      const rm = h('button', { type: 'button', class: 'mq-rm', 'aria-label': `Tirar ${t.title} da fila`, title: 'Tirar da fila' }, '×');
      rm.addEventListener('click', () => musicCommand('remove', { index: i, quiet: true }).catch((e) => toast(e.message)));
      row.append(rm);
    }
    return row;
  }) : [h('p', { class: 'hint', style: { padding: '4px 8px' } }, 'A fila está vazia.')]));
  paintProgress();
  frameLoop();
}

export function setModerator(v) { st.roomCanModerate = Boolean(v); }

// Cartão do DJ dentro do chat
export function musicCard(payload) {
  const card = h('div', { class: 'draw-card music-card' });
  if (payload.title) card.append(h('div', { class: 'draw-title mc-title mc-' + String(payload.type).replace('music_', '') }, payload.title));
  const t = payload.track;
  if (t) {
    card.append(h('div', { class: 'mc-track' }, trackThumb(t, 'mc-thumb'),
      h('div', { class: 'mc-info' }, h('b', null, t.title), h('small', null, `${t.author ? t.author + ' · ' : ''}Pedido por ${t.byName}`))));
  }
  if (payload.text) card.append(h('div', { class: 'mc-text' }, payload.text));
  return card;
}
