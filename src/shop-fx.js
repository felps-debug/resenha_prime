// Efeitos da Loja: zoeiras nos amigos, efeitos de tela, entrada triunfal, soundboard, voz zoada, moldura e vaquinha.
// Tudo parte de compras pagas (tabela purchases, preenchida só pelo webhook) e de efeitos disparados pelo servidor (room_effects).
import { h, toast } from './ui.js';

const fx = {
  sb: null, me: null, roomId: null, sub: null,
  active: [],        // compras pagas e válidas da sala aberta (zoeiras, molduras, mascote)
  owned: new Set(),  // itens meus que valem (em qualquer sala)
  vaq: null, lastLevel: null, listeners: new Set(), timer: null
};
const ZOEIRAS = ['chapeu', 'nome-rosa', 'apelido', 'fantasma'];
const EFFECTS = ['gol', 'parabens', 'f', 'terremoto'];

export function initShopFx({ sb, me }) { fx.sb = sb; fx.me = me; refreshOwned(); }
export const onShopFx = (fn) => { fx.listeners.add(fn); return () => fx.listeners.delete(fn); };
const emit = () => { for (const fn of fx.listeners) fn(); };
const valid = (p) => p.status === 'paid' && (!p.expires_at || new Date(p.expires_at) > new Date());

async function refreshOwned() {
  if (!fx.sb || !fx.me) return;
  const { data } = await fx.sb.from('purchases').select('item_id, expires_at, status').eq('buyer_id', fx.me.id).eq('status', 'paid');
  fx.owned = new Set((data || []).filter(valid).map((p) => p.item_id));
  emit();
}
export function owns(itemId) {
  if (fx.owned.has(itemId)) return true;
  return EFFECTS.includes(itemId) && fx.owned.has('pacote-efeitos');
}

// ---------- Estado da sala aberta ----------
export async function shopRoom(roomId) {
  if (fx.roomId === roomId) return;
  shopLeave();
  fx.roomId = roomId;
  if (!roomId) return;
  await loadActive();
  fx.sub = fx.sb.channel('loja-' + roomId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'purchases', filter: `room_id=eq.${roomId}` }, () => { loadActive(); refreshOwned(); })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_effects', filter: `room_id=eq.${roomId}` }, (p) => { if (p.new) playEffect(p.new.item_id, p.new.payload || {}); })
    .subscribe();
  clearInterval(fx.timer);
  fx.timer = setInterval(() => { const before = fx.active.length; fx.active = fx.active.filter(valid); if (fx.active.length !== before) emit(); }, 15000);
}
export function shopLeave() {
  if (fx.sub) { try { fx.sb.removeChannel(fx.sub); } catch (_) {} fx.sub = null; }
  clearInterval(fx.timer);
  fx.active = []; fx.vaq = null; fx.lastLevel = null; fx.roomId = null;
}
async function loadActive() {
  const id = fx.roomId;
  const { data } = await fx.sb.from('purchases').select('id, buyer_id, recipient_id, item_id, extra, expires_at, status').eq('room_id', id).eq('status', 'paid');
  if (fx.roomId !== id) return;
  fx.active = (data || []).filter(valid).filter((p) => ZOEIRAS.includes(p.item_id) || p.item_id === 'estilo');
  emit();
  loadVaquinha();
}

// Zoeiras ativas em alguém
const zoeira = (userId, item) => fx.active.find((p) => p.item_id === item && p.recipient_id === userId);
export const nickFor = (userId) => { const z = zoeira(userId, 'apelido'); return z && z.extra && z.extra.text ? String(z.extra.text) : null; };
export const isPink = (userId) => Boolean(zoeira(userId, 'nome-rosa'));
export const hasFrame = (userId) => fx.active.some((p) => p.item_id === 'estilo' && p.buyer_id === userId);
export function decorateAvatar(el, userId) {
  if (zoeira(userId, 'chapeu')) el.classList.add('fx-chapeu');
  if (zoeira(userId, 'fantasma')) el.classList.add('fx-fantasma');
  if (hasFrame(userId)) el.classList.add('fx-frame');
}

// ---------- Vaquinha da sala ----------
export const getVaquinha = () => fx.vaq;
export async function loadVaquinha() {
  const id = fx.roomId;
  if (!id) return null;
  const { data, error } = await fx.sb.rpc('vaquinha_status', { p_room: id });
  if (error || fx.roomId !== id) return null;
  const prev = fx.lastLevel;
  fx.vaq = data;
  fx.lastLevel = data.level;
  if (prev != null && data.level > prev) explosion('A vaquinha bateu a meta!');
  emit();
  return data;
}

// ---------- Disparar efeitos ----------
export async function fire(roomId, item, payload = {}) {
  const { error } = await fx.sb.rpc('shop_fire_effect', { p_room: roomId, p_item: item, p_payload: payload });
  if (error) throw new Error(String(error.message || 'Não deu certo.').replace(/^.*?:\s*/, ''));
}
export const CHAT_EFFECTS = { '/gol': 'gol', '/parabens': 'parabens', '/parabéns': 'parabens', '/f': 'f', '/terremoto': 'terremoto' };

// ---------- Animações ----------
let layer = null;
function stage() {
  if (!layer || !layer.isConnected) { layer = h('div', { class: 'fx-layer', 'aria-hidden': 'true' }); document.body.append(layer); }
  return layer;
}
const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function shake(ms) {
  if (reduce()) return;
  const app = document.getElementById('app');
  if (!app) return;
  app.classList.add('fx-shake');
  setTimeout(() => app.classList.remove('fx-shake'), ms);
}
function pieces(n, make, life) {
  const l = stage();
  for (let i = 0; i < n; i++) {
    const el = make(i);
    l.append(el);
    setTimeout(() => el.remove(), life);
  }
}
const COLORS = ['#FF6B3D', '#FFD166', '#8BD3A8', '#7FB2F0', '#C9A7F5', '#F28FAA'];
function confetti(n = 60) {
  pieces(n, () => h('i', { class: 'fx-confetti', style: { left: Math.random() * 100 + '%', background: COLORS[Math.floor(Math.random() * COLORS.length)], animationDelay: Math.random() * 0.6 + 's', animationDuration: 1.6 + Math.random() * 1.4 + 's' } }), 3600);
}
function banner(text, color) {
  const el = h('div', { class: 'fx-banner', style: color ? { color } : null }, text);
  stage().append(el);
  setTimeout(() => el.remove(), 2800);
}
export function explosion(text) { banner(text, '#FFD166'); confetti(90); shake(700); }

export function playEffect(item, payload = {}) {
  if (item === 'gol') { shake(1500); banner('GOOOL!', '#FFD166'); confetti(70); tone('buzina'); }
  else if (item === 'parabens') {
    banner(`Parabéns${payload.name ? ' de ' + payload.name : ''}!`, '#F28FAA');
    pieces(16, (i) => h('i', { class: 'fx-balloon', style: { left: 4 + Math.random() * 90 + '%', background: COLORS[i % COLORS.length], animationDelay: Math.random() * 1.2 + 's' } }), 5200);
  } else if (item === 'f') {
    banner('F', '#ECEDEF');
    pieces(30, () => h('i', { class: 'fx-flower', style: { left: Math.random() * 100 + '%', animationDelay: Math.random() * 1.4 + 's' } }, '✿'), 4600);
  } else if (item === 'terremoto') shake(3000);
  else if (item === 'entrada') entrance(payload.name || 'Alguém');
  else if (item === 'soundboard') tone(payload.sound || 'buzina');
}

function entrance(name) {
  const el = h('div', { class: 'fx-entrance' }, h('span', { class: 'fx-beam' }), h('b', null, name), h('small', null, 'CHEGOU NA CALL'));
  stage().append(el);
  tone('fanfarra');
  setTimeout(() => el.remove(), 3600);
}

// ---------- Sons sintetizados (sem arquivos) ----------
let ctx = null;
const audio = () => { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} } if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; };
function note(freq, start, dur, type = 'sine', vol = 0.18, endFreq) {
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, a.currentTime + start);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, a.currentTime + start + dur);
  g.gain.setValueAtTime(vol, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination); o.start(a.currentTime + start); o.stop(a.currentTime + start + dur + 0.05);
}
function noise(start, dur, vol = 0.15) {
  const a = audio(); if (!a) return;
  const len = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = a.createBufferSource(), g = a.createGain(); s.buffer = buf; g.gain.value = vol;
  s.connect(g).connect(a.destination); s.start(a.currentTime + start);
}
export const SOUNDS = [
  ['buzina', 'Buzina de estádio'], ['tambor', 'Tambor de suspense'], ['risada', 'Risada de plateia'], ['aplausos', 'Aplausos'],
  ['sirene', 'Sirene'], ['trombone', 'Trombone triste'], ['boing', 'Boing'], ['ding', 'Ding de acerto'], ['fanfarra', 'Fanfarra'], ['rufar', 'Rufar']
];
export function tone(name) {
  switch (name) {
    case 'buzina': note(180, 0, 0.9, 'sawtooth', 0.22); note(184, 0, 0.9, 'square', 0.12); break;
    case 'tambor': for (let i = 0; i < 6; i++) note(90, i * 0.18, 0.14, 'sine', 0.3, 50); break;
    case 'risada': for (let i = 0; i < 6; i++) note(420 + (i % 2) * 80, i * 0.13, 0.1, 'square', 0.1); break;
    case 'aplausos': for (let i = 0; i < 14; i++) noise(i * 0.09, 0.07, 0.14); break;
    case 'sirene': note(500, 0, 0.7, 'sawtooth', 0.16, 900); note(900, 0.7, 0.7, 'sawtooth', 0.16, 500); break;
    case 'trombone': note(220, 0, 0.45, 'sawtooth', 0.18, 200); note(196, 0.5, 0.45, 'sawtooth', 0.18, 175); note(165, 1, 0.9, 'sawtooth', 0.18, 120); break;
    case 'boing': note(200, 0, 0.5, 'sine', 0.25, 900); break;
    case 'ding': note(1318, 0, 0.5, 'sine', 0.2); note(1760, 0.12, 0.6, 'sine', 0.18); break;
    case 'fanfarra': [523, 659, 784, 1046].forEach((f, i) => note(f, i * 0.14, 0.35, 'square', 0.12)); break;
    case 'rufar': for (let i = 0; i < 16; i++) noise(i * 0.06, 0.05, 0.16); break;
    default: break;
  }
}

// ---------- Voz zoada (processa o microfone antes de sair para a call) ----------
export const VOICES = [['normal', 'Normal'], ['robo', 'Robô'], ['radio', 'Rádio de pinga']];
export function makeVoiceProcessor(kind) {
  let a = null, src = null, dest = null, nodes = [];
  return {
    name: 'voz-zoada-' + kind,
    processedTrack: undefined,
    async init(opts) {
      a = opts.audioContext || new AudioContext();
      src = a.createMediaStreamSource(new MediaStream([opts.track]));
      dest = a.createMediaStreamDestination();
      if (kind === 'robo') {
        const osc = a.createOscillator(); osc.frequency.value = 55; osc.type = 'sine';
        const mod = a.createGain(); mod.gain.value = 0;
        osc.connect(mod.gain); src.connect(mod); mod.connect(dest); osc.start(); nodes = [osc, mod];
      } else {
        const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500;
        const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2800;
        const sh = a.createWaveShaper(); const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(x * 6); } sh.curve = curve;
        src.connect(hp).connect(lp).connect(sh).connect(dest); nodes = [hp, lp, sh];
      }
      this.processedTrack = dest.stream.getAudioTracks()[0];
    },
    async restart(opts) { await this.destroy(); await this.init(opts); },
    async destroy() { for (const n of nodes) { try { n.disconnect(); if (n.stop) n.stop(); } catch (_) {} } try { src && src.disconnect(); } catch (_) {} nodes = []; }
  };
}
export { toast };
