// Golpes de zoeira na call: animação por cima do quadro de alguém, vista por todos.
// O pedido viaja pelo canal de dados do LiveKit (ver call.js); aqui só fica o desenho.
import { h, avatar } from './ui.js';
import { playAgua } from './agua.js';

export const ZOEIRA_TOPIC = 'zoeira';
export const ZOEIRA_KINDS = { privada: 'Mandar pra privada', agua: 'Jogar água' };
export const ZOEIRA_DURATION = 7;

// Onde ficam os sons; dá pra trocar (ex.: página de demonstração).
export const zoeiraConfig = { soundUrl: (name) => `/sfx/${name}.mp3` };

const SFX = ['whoosh', 'splat', 'scream', 'boing', 'clack', 'flush', 'glub', 'pop', 'buzz'];
const playing = new Map();
let gsapPromise;
function loadGsap() {
  if (!gsapPromise) gsapPromise = import('gsap').then((m) => m.gsap || m.default).catch((err) => { gsapPromise = null; throw err; });
  return gsapPromise;
}

// Pré-carrega os sons na primeira vez que alguém entra na call.
const sounds = new Map();
export function preloadZoeira() {
  for (const name of SFX) {
    if (sounds.has(name)) continue;
    const a = new Audio(zoeiraConfig.soundUrl(name));
    a.preload = 'auto';
    sounds.set(name, a);
  }
  loadGsap().catch(() => {});
}
function sfx(name, volume, muted) {
  if (muted) return;
  const base = sounds.get(name) || new Audio(zoeiraConfig.soundUrl(name));
  const a = base.cloneNode();
  a.volume = Math.max(0, Math.min(1, volume));
  a.play().catch(() => {});
}

export function isZoeiraPlaying(identity) { return playing.has(identity); }

// ---------- Peças desenhadas (SVG estático, sem dado de usuário) ----------
const LINE = '#16110d';
const POOP_SVG = `<svg viewBox="0 0 200 200" width="200" height="200" aria-hidden="true">
<g class="z-stink" fill="none" stroke="#9bd35a" stroke-width="7" stroke-linecap="round"><path d="M62 34 q-10 -10 0 -20 t0 -20"/><path d="M138 34 q-10 -10 0 -20 t0 -20"/></g>
<g stroke="#2a1608" stroke-width="8" stroke-linejoin="round">
<path d="M100 26 C122 34 122 56 108 64 L92 64 C80 52 84 38 100 26 Z" fill="#9a6532"/>
<ellipse cx="100" cy="82" rx="46" ry="24" fill="#9a6532"/><ellipse cx="100" cy="120" rx="66" ry="28" fill="#8b5a2b"/><ellipse cx="100" cy="160" rx="84" ry="32" fill="#7a4c22"/></g>
<path d="M70 74 q16 -10 34 -6" fill="none" stroke="#c8925a" stroke-width="6" stroke-linecap="round"/>
<path d="M54 110 q20 -12 44 -8" fill="none" stroke="#b7834f" stroke-width="6" stroke-linecap="round"/>
<ellipse cx="80" cy="120" rx="13" ry="15" fill="#fff" stroke="#2a1608" stroke-width="5"/><ellipse cx="120" cy="120" rx="13" ry="15" fill="#fff" stroke="#2a1608" stroke-width="5"/>
<circle cx="84" cy="123" r="6" fill="#2a1608"/><circle cx="124" cy="123" r="6" fill="#2a1608"/>
<path d="M70 156 Q100 182 130 156" fill="#3a1a0a" stroke="#2a1608" stroke-width="6" stroke-linejoin="round"/><path d="M84 160 h32 v6 h-32z" fill="#fff"/></svg>`;

const TOILET_BACK_SVG = `<svg viewBox="0 0 520 560" width="520" height="560" aria-hidden="true">
<rect x="130" y="14" width="260" height="190" rx="26" fill="#f4f7fa" stroke="${LINE}" stroke-width="9"/>
<rect x="150" y="34" width="70" height="16" rx="8" fill="#d6dde3"/>
<rect x="330" y="50" width="56" height="18" rx="9" fill="#b8c2ca" stroke="${LINE}" stroke-width="6"/>
<g class="z-lid-open"><ellipse cx="260" cy="150" rx="176" ry="128" fill="#fff" stroke="${LINE}" stroke-width="9"/><ellipse cx="260" cy="150" rx="128" ry="88" fill="none" stroke="#e3e8ec" stroke-width="10"/></g>
<ellipse cx="260" cy="250" rx="232" ry="72" fill="#fff" stroke="${LINE}" stroke-width="9"/>
<ellipse cx="260" cy="258" rx="190" ry="52" fill="#d9ecf5" stroke="${LINE}" stroke-width="6"/>
<ellipse cx="260" cy="266" rx="160" ry="40" fill="#3fa9e0"/>
<g transform="translate(260 266) scale(1 0.4)"><g class="z-swirl"><path d="M0 -10 A10 10 0 1 1 -10 0 M0 -40 A40 40 0 0 1 40 0 M0 70 A70 70 0 0 1 -70 0 M90 30 A95 95 0 0 1 30 90 M-100 -20 A100 100 0 0 1 -20 -100" fill="none" stroke="#e8f7fe" stroke-width="10" stroke-linecap="round"/></g></g></svg>`;

const TOILET_FRONT_SVG = `<svg viewBox="0 0 520 560" width="520" height="560" aria-hidden="true">
<path d="M70 258 A190 52 0 0 0 450 258 L490 250 Q484 420 342 452 L352 540 H168 L178 452 Q36 420 30 250 Z" fill="#fff" stroke="${LINE}" stroke-width="9" stroke-linejoin="round"/>
<path d="M70 258 A190 52 0 0 0 450 258" fill="none" stroke="${LINE}" stroke-width="7"/>
<path d="M80 360 Q150 420 230 430" fill="none" stroke="#e3e8ec" stroke-width="12" stroke-linecap="round"/>
<g class="z-lid-closed"><ellipse cx="260" cy="250" rx="234" ry="74" fill="#fff" stroke="${LINE}" stroke-width="9"/><ellipse cx="260" cy="246" rx="180" ry="50" fill="none" stroke="#e3e8ec" stroke-width="10"/></g></svg>`;

const DIRT_SVG = `<svg viewBox="0 0 400 400" width="400" height="400" aria-hidden="true"><g fill="#8b5a2b" stroke="${LINE}" stroke-width="6">
<path d="M90 236 q16 -22 36 -2 q14 -10 16 10 q-10 22 -32 14 q-22 8 -20 -22z"/><path d="M236 110 q18 -16 36 0 q12 14 -4 26 q-20 10 -32 -8 q-8 -10 0 -18z"/>
<path d="M272 250 q12 -12 26 -2 q10 12 -2 22 q-14 8 -24 -6z"/><circle cx="160" cy="128" r="10"/><circle cx="196" cy="300" r="8"/></g></svg>`;

const WET_SVG = `<svg viewBox="0 0 400 400" width="400" height="400" aria-hidden="true">
<circle cx="200" cy="200" r="190" fill="rgba(88,193,242,.28)"/>
<g fill="#58c1f2" stroke="${LINE}" stroke-width="4"><path d="M110 90 q8 34 0 52 q-10 -16 0 -52z"/><path d="M290 84 q9 38 0 58 q-11 -18 0 -58z"/><path d="M200 40 q8 30 0 46 q-9 -14 0 -46z"/></g>
<path d="M110 70 Q160 44 210 50" fill="none" stroke="#e8f7fe" stroke-width="9" stroke-linecap="round"/></svg>`;

const FLY_SVG = `<svg viewBox="0 0 34 28" width="54" height="44" aria-hidden="true"><ellipse cx="11" cy="8" rx="9" ry="6" fill="#d8f0ff" stroke="${LINE}" stroke-width="3"/><ellipse cx="23" cy="8" rx="9" ry="6" fill="#d8f0ff" stroke="${LINE}" stroke-width="3"/><ellipse cx="17" cy="18" rx="9" ry="8" fill="#26282e" stroke="${LINE}" stroke-width="3"/></svg>`;

const BURST_SVG = `<svg viewBox="0 0 1080 1080" width="1080" height="1080" aria-hidden="true"><g fill="#ffd23f" opacity=".9" transform="translate(540 430)">${
  Array.from({ length: 12 }, (_, i) => `<polygon points="0,-40 30,-600 -30,-600" transform="rotate(${i * 30})"/>`).join('')}</g></svg>`;

function el(cls, html, style) {
  const node = h('div', { class: cls, style });
  if (html) node.innerHTML = html;
  return node;
}

// Foto que vai pra privada: quadro da câmera se estiver ligada, senão a foto de perfil.
function targetFace(identity, name, avatarUrl, tile) {
  const wrap = h('div', { class: 'z-face' });
  const video = tile && tile.querySelector('video');
  if (video && video.videoWidth > 0) {
    try {
      const c = document.createElement('canvas');
      c.width = 400; c.height = 400;
      const side = Math.min(video.videoWidth, video.videoHeight);
      c.getContext('2d').drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, 400, 400);
      wrap.append(c);
      return wrap;
    } catch (_) { /* cai para o avatar */ }
  }
  wrap.append(avatar(identity, name, 'z-av', avatarUrl));
  return wrap;
}

function findTile(identity) {
  const stage = document.getElementById('stage');
  if (!stage) return null;
  for (const t of stage.querySelectorAll('.tile[data-identity]')) {
    if (t.dataset.identity === identity) return t;
  }
  return null;
}

// ---------- Golpe: água na câmera ----------
function playAguaOn(identity, muted) {
  let done;
  const finished = new Promise((resolve) => { done = resolve; });
  const stop = playAgua({ findTile: () => findTile(identity), muted, onEnd: () => { playing.delete(identity); done(); } });
  if (!stop) return false;
  playing.set(identity, stop);
  return finished;
}

// ---------- Golpe: privada + cocô ----------
export async function playZoeira({ kind, identity, name, avatarUrl, muted }) {
  if (!Object.hasOwn(ZOEIRA_KINDS, kind) || playing.has(identity)) return false;
  if (kind === 'agua') return playAguaOn(identity, muted);
  const tile = findTile(identity);
  if (!tile) return false;
  let gsap;
  try { gsap = await loadGsap(); } catch (_) { return false; }

  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scene = el('z-scene');
  const root = h('div', { class: 'zoeira-fx', 'aria-hidden': 'true' }, scene);

  const toiletBack = el('z-toilet z-toilet-back', TOILET_BACK_SVG);
  const toiletFront = el('z-toilet z-toilet-front', TOILET_FRONT_SVG);
  const burst = el('z-burst', BURST_SVG);
  const face = targetFace(identity, name, avatarUrl, tile);
  const dirt = el('z-over', DIRT_SVG);
  const wet = el('z-over', WET_SVG);
  const poop = el('z-poop', POOP_SVG);
  const fly1 = el('z-fly', FLY_SVG);
  const fly2 = el('z-fly', FLY_SVG);
  const drips = [[96, 230], [290, 220], [190, 330]].map(([x, y]) => el('z-drip', null, { left: x + 'px', top: y + 'px' }));
  const av = h('div', { class: 'z-avatar' }, face, dirt, wet, poop, fly1, fly2, ...drips);
  const blobs = Array.from({ length: 8 }, () => el('z-blob'));
  const splashes = Array.from({ length: 6 }, () => el('z-splash'));
  const glub1 = h('div', { class: 'z-glub', style: { left: '380px', top: '640px' } }, 'glub');
  const glub2 = h('div', { class: 'z-glub', style: { left: '590px', top: '620px' } }, 'glub');
  const splat = h('div', { class: 'z-word z-splat' }, 'SPLAT!');
  const scream = h('div', { class: 'z-scream' }, ...'AAAAHH!'.split('').map((c) => h('span', null, c)));
  const flush = h('div', { class: 'z-word z-flush' }, 'FLUUUSH!');
  const flash = el('z-flash');
  scene.append(burst, toiletBack, av, toiletFront, ...blobs, ...splashes, glub1, glub2, splat, scream, flush, flash);
  document.body.append(root);

  // Acompanha o quadro da pessoa (o palco é redesenhado a cada mudança da call).
  let raf = 0;
  let lastTile = tile;
  const follow = () => {
    const t = findTile(identity) || (lastTile && lastTile.isConnected ? lastTile : null);
    if (t) {
      lastTile = t;
      t.classList.add('zoeira-target');
      const r = t.getBoundingClientRect();
      const size = Math.max(72, Math.min(r.height * 0.85, r.width * 0.6, 340));
      const s = size / 400;
      scene.style.transform = `translate(${r.left + r.width / 2 - 540 * s}px, ${r.top + r.height / 2 - 430 * s}px) scale(${s})`;
      root.style.visibility = 'visible';
    } else {
      root.style.visibility = 'hidden';
    }
    raf = requestAnimationFrame(follow);
  };
  root.style.visibility = 'hidden';
  follow();

  let done;
  const finished = new Promise((resolve) => { done = resolve; });
  const cleanup = () => {
    cancelAnimationFrame(raf);
    tl.kill();
    root.remove();
    const t = findTile(identity);
    if (t) t.classList.remove('zoeira-target');
    if (lastTile) lastTile.classList.remove('zoeira-target');
    playing.delete(identity);
    done();
  };

  const tl = gsap.timeline({ onComplete: cleanup });
  playing.set(identity, cleanup);
  const s = (n, t, v = 1) => tl.call(() => sfx(n, v, muted), null, t);

  gsap.set([dirt, wet, flash, burst, splat, flush, scream, fly1, fly2, ...drips, ...blobs, ...splashes, glub1, glub2], { opacity: 0 });
  gsap.set(scene.querySelector('.z-lid-open'), { opacity: 0 });
  gsap.set([toiletBack, toiletFront], { y: 720, opacity: 0 });
  gsap.set(poop, { x: -620, y: 760, rotation: -300, scale: 0.8, opacity: 0, transformOrigin: '50% 60%' });
  tl.to(poop, { opacity: 1, duration: 0.08 }, 0.42);

  // 0,45  cocô voando
  s('whoosh', 0.45, 0.8);
  tl.to(poop, { keyframes: [
    { x: -330, y: -110, rotation: 120, scale: 0.95, duration: 0.38, ease: 'power1.out' },
    { x: 0, y: 0, rotation: 360, scale: 1.05, duration: 0.32, ease: 'power2.in' }
  ] }, 0.42);
  tl.to(scene.querySelectorAll('.z-stink path'), { y: -10, duration: 0.12, yoyo: true, repeat: 7, ease: 'sine.inOut' }, 0.4);

  // 1,12  impacto
  const HIT = 1.12;
  s('splat', 1.1);
  s('scream', 1.18, 0.75);
  tl.set(poop, { scaleX: 1.7, scaleY: 0.5 }, HIT);
  if (!reduce) tl.fromTo(flash, { opacity: 0.85 }, { immediateRender: false, opacity: 0, duration: 0.14 }, HIT);
  tl.fromTo(burst, { opacity: 1, scale: 0.5, svgOrigin: '540 430' }, { immediateRender: false, opacity: 0, scale: 1.25, duration: 0.35, ease: 'power2.out' }, HIT);
  [[-300, -220], [260, -260], [330, 40], [-340, 90], [-150, 260], [190, 230], [40, -340], [-60, 330]].forEach(([dx, dy], i) => {
    tl.fromTo(blobs[i], { opacity: 1, x: 0, y: 0, scale: 0.6 + (i % 3) * 0.4 }, { immediateRender: false, x: dx, y: dy, rotation: 180, duration: 0.45, ease: 'power3.out' }, HIT);
    tl.to(blobs[i], { opacity: 0, scale: 0.2, duration: 0.25 }, HIT + 0.35);
  });
  if (!reduce) tl.to(scene, { keyframes: [{ x: -26, y: 14, duration: 0.04 }, { x: 22, y: -18, duration: 0.04 }, { x: -16, y: 10, duration: 0.04 }, { x: 12, y: -6, duration: 0.04 }, { x: 0, y: 0, duration: 0.08 }] }, HIT);
  tl.fromTo(splat, { opacity: 1, scale: 0, rotation: -24 }, { immediateRender: false, scale: 1.15, rotation: -10, duration: 0.16, ease: 'back.out(3)' }, HIT);
  tl.to(splat, { scale: 1, duration: 0.1 }, HIT + 0.16);
  tl.to(splat, { opacity: 0, y: -40, duration: 0.2 }, 2.05);
  tl.set(dirt, { opacity: 1 }, HIT);
  tl.to(poop, { keyframes: [
    { scaleX: 0.7, scaleY: 0.7, x: 20, y: -230, rotation: 400, duration: 0.22, ease: 'power2.out' },
    { scaleX: 0.62, scaleY: 0.5, y: -150, rotation: 372, duration: 0.12, ease: 'power2.in' },
    { scaleX: 0.55, scaleY: 0.6, y: -158, duration: 0.1, ease: 'power1.out' }
  ] }, HIT + 0.06);

  // 1,2 – 2,5  grito
  tl.fromTo(scream, { opacity: 1, scale: 0, transformOrigin: '0% 100%' }, { immediateRender: false, scale: 1, duration: 0.18, ease: 'back.out(3)' }, 1.2);
  tl.to(scream.children, { y: -14, duration: 0.06, yoyo: true, repeat: 15, stagger: 0.03, ease: 'none' }, 1.25);
  const shake = [];
  for (let i = 0; i < 9; i += 1) { const a = i < 6 ? 12 : 7; shake.push({ x: -a, rotation: -3, duration: 0.05 }, { x: a, rotation: 3, duration: 0.05 }); }
  shake.push({ x: 0, rotation: 0, duration: 0.05 });
  tl.to(av, { keyframes: shake }, 1.22);
  tl.to(scream, { scale: 0.6, opacity: 0, duration: 0.18, ease: 'power2.in' }, 2.45);

  // 2,15  privada sobe e a tampa abre
  const toilet = [toiletBack, toiletFront];
  s('boing', 2.15);
  tl.to(toilet, { opacity: 1, duration: 0.1 }, 2.15);
  tl.to(toilet, { y: 0, duration: 0.38, ease: 'back.out(1.6)' }, 2.15);
  tl.to(toilet, { keyframes: [{ scaleY: 0.9, scaleX: 1.06, duration: 0.08 }, { scaleY: 1.04, scaleX: 0.98, duration: 0.08 }, { scaleY: 1, scaleX: 1, duration: 0.08 }], transformOrigin: '50% 100%' }, 2.5);
  const lidClosed = scene.querySelector('.z-lid-closed');
  const lidOpen = scene.querySelector('.z-lid-open');
  s('clack', 2.62);
  tl.to(lidClosed, { scaleY: 0, transformOrigin: '50% 30%', duration: 0.08, ease: 'power2.in' }, 2.62);
  tl.fromTo(lidOpen, { opacity: 1, scaleY: 0, transformOrigin: '50% 100%' }, { immediateRender: false, scaleY: 1, duration: 0.14, ease: 'back.out(2.5)' }, 2.69);
  tl.to(scene.querySelector('.z-swirl'), { rotation: 2160, svgOrigin: '0 0', duration: 2.2, ease: 'none' }, 2.65);

  // 2,8 – 3,6  sugado pela descarga
  s('flush', 2.8);
  tl.to(av, { keyframes: [
    { y: -40, scaleX: 1.08, scaleY: 0.92, duration: 0.12, ease: 'power2.out' },
    { x: 0, y: 290, scaleX: 0.22, scaleY: 1.25, rotation: 900, duration: 0.7, ease: 'power3.in' },
    { scale: 0, duration: 0.08 }
  ] }, 2.82);
  tl.fromTo(flush, { opacity: 1, scale: 0, rotation: 8 }, { immediateRender: false, scale: 1, rotation: -4, duration: 0.2, ease: 'back.out(3)' }, 2.95);
  tl.to(flush, { rotation: 4, duration: 0.12, yoyo: true, repeat: 5, ease: 'sine.inOut' }, 3.15);
  tl.to(flush, { opacity: 0, scale: 0.8, duration: 0.18 }, 3.85);

  // 3,62  tampa bate, gorgolejo
  s('clack', 3.64);
  tl.to(lidOpen, { scaleY: 0, duration: 0.06, ease: 'power2.in' }, 3.62);
  tl.to(lidClosed, { scaleY: 1, duration: 0.08, ease: 'back.out(3)' }, 3.68);
  tl.to(toilet, { keyframes: [{ scaleY: 0.92, scaleX: 1.05, duration: 0.07 }, { scaleY: 1.05, scaleX: 0.97, duration: 0.07 }, { scaleY: 0.96, scaleX: 1.03, duration: 0.07 }, { scaleY: 1, scaleX: 1, duration: 0.07 }], transformOrigin: '50% 100%' }, 3.7);
  s('glub', 3.85); s('glub', 4.05);
  tl.fromTo(glub1, { opacity: 1, y: 0, scale: 0.6 }, { immediateRender: false, y: -90, scale: 1, rotation: -8, duration: 0.45 }, 3.85);
  tl.to(glub1, { opacity: 0, duration: 0.12 }, 4.25);
  tl.fromTo(glub2, { opacity: 1, y: 0, scale: 0.6 }, { immediateRender: false, y: -90, scale: 1, rotation: 8, duration: 0.45 }, 4.05);
  tl.to(glub2, { opacity: 0, duration: 0.12 }, 4.45);

  // 4,5  volta molhado, com o cocô na cabeça
  const BACK = 4.5;
  s('clack', 4.44); s('pop', BACK);
  tl.to(lidClosed, { scaleY: 0, duration: 0.06 }, BACK - 0.06);
  tl.to(lidOpen, { scaleY: 1, duration: 0.1, ease: 'back.out(3)' }, BACK);
  tl.set(wet, { opacity: 1 }, BACK);
  tl.set(av, { rotation: 0, scaleX: 0.3, scaleY: 0.3, y: 280, x: 0 }, BACK);
  tl.to(av, { y: -30, scaleX: 0.9, scaleY: 1.12, duration: 0.24, ease: 'power3.out' }, BACK);
  tl.to(av, { y: 0, scaleX: 1, scaleY: 1, duration: 0.3, ease: 'bounce.out' }, BACK + 0.24);
  [[-260, -330], [-140, -420], [-20, -470], [110, -430], [230, -350], [320, -240]].forEach(([dx, dy], i) => {
    tl.fromTo(splashes[i], { opacity: 1, x: 0, y: 0 }, { immediateRender: false, x: dx, y: dy, duration: 0.3, ease: 'power2.out' }, BACK);
    tl.to(splashes[i], { y: dy + 240, opacity: 0, duration: 0.35, ease: 'power2.in' }, BACK + 0.3);
  });
  tl.to(toilet, { y: 720, duration: 0.35, ease: 'back.in(1.4)' }, 5.15);
  tl.to(toilet, { opacity: 0, duration: 0.15 }, 5.35);

  // moscas, pingos e tontura até o fim
  s('buzz', 4.85, 0.45);
  tl.set([fly1, fly2], { opacity: 1 }, 4.85);
  tl.to(fly1, { keyframes: [{ x: 120, y: -40 }, { x: 160, y: 30 }, { x: 60, y: 70 }, { x: -90, y: 40 }, { x: -140, y: -30 }, { x: -40, y: -70 }, { x: 0, y: 0 }].map((k) => ({ ...k, duration: 0.15 })), repeat: 1, ease: 'none' }, 4.85);
  tl.to(fly2, { keyframes: [{ x: -110, y: 20 }, { x: -60, y: 80 }, { x: 70, y: 60 }, { x: 140, y: -10 }, { x: 50, y: -60 }, { x: 0, y: 0 }].map((k) => ({ ...k, duration: 0.13 })), repeat: 2, ease: 'none' }, 4.85);
  drips.forEach((d, i) => tl.fromTo(d, { opacity: 1, y: 0 }, { immediateRender: false, y: 140, opacity: 0, duration: 0.55, ease: 'power2.in', repeat: 3 }, 4.75 + i * 0.18));
  tl.to(av, { keyframes: [-6, 6, -5, 5, -3, 0].map((r) => ({ rotation: r, duration: 0.25 })), ease: 'sine.inOut' }, 5.1);
  tl.to(av, { opacity: 0, duration: 0.3 }, ZOEIRA_DURATION - 0.3);
  tl.to([poop, fly1, fly2, wet, dirt], { opacity: 0, duration: 0.3 }, ZOEIRA_DURATION - 0.3);

  return finished;
}

export function stopAllZoeira() {
  for (const stop of [...playing.values()]) stop();
}
