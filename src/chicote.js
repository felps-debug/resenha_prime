// Golpe "Dar chicotada": pastelão de desenho animado. O chicote estala três vezes alternando os lados,
// o quadro balança, sai o estouro e no fim ficam as estrelinhas girando. Sem marcas e sem gemidos.
import { h } from './ui.js';

export const CHICOTE_DURATION = 5.2;

// Cada estalada: [instante do estalo, de que lado vem (-1 esquerda, 1 direita), força, alvo no quadro]
const LASHES = [
  [0.7, -1, 0.85, [0.4, 0.4]],
  [1.95, 1, 0.95, [0.62, 0.46]],
  [3.3, -1, 1.25, [0.5, 0.38]]
];
const WINDUP = 0.45; // tempo puxando para trás antes de soltar
const STRIKE = 0.13; // tempo da ponta indo até o alvo
const BACK = 0.65; // tempo do ricochete até recolher

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const mix = (a, b, k) => a + (b - a) * k;

// Poses do chicote, relativas à mão: [controle 1, controle 2, ponta]. x positivo aponta para o alvo.
const REST = [[0.15, 0.4], [0.35, 0.75], [0.5, 0.85]];
const COCKED = [[0.1, -0.95], [-1.15, -1.1], [-0.95, -0.05]];
const WAVE = [[0.5, -1.2], [1.25, -0.9], [0.55, -0.25]];
// Para onde a ponta salta depois de bater: volta para trás e para cima.
const RECOIL = [[0.5, -0.65], [0.15, -0.75], [0.45, -0.6]];

const blend = (from, to, k) => from.map((p, i) => [mix(p[0], to[i][0], k), mix(p[1], to[i][1], k)]);

// Onde o chicote está no instante t para uma estalada. hit é a pose com a ponta no alvo.
function poseAt(dt, hit) {
  if (dt < -STRIKE) return blend(REST, COCKED, 1 - ((-dt - STRIKE) / WINDUP) ** 2);
  if (dt < -STRIKE / 2) return blend(COCKED, WAVE, (dt + STRIKE) / (STRIKE / 2));
  if (dt < 0) return blend(WAVE, hit, (dt + STRIKE / 2) / (STRIKE / 2));
  if (dt < 0.05) return hit;
  if (dt < 0.24) return blend(hit, RECOIL, 1 - (1 - (dt - 0.05) / 0.19) ** 3);
  return blend(RECOIL, REST, clamp((dt - 0.24) / (BACK - 0.17)) ** 1.4);
}

// Barulho: o estalo gravado (public/sfx/chicote.mp3), alinhado para o "crack" cair na hora do impacto.
const SNAP_AT = 0.25; // onde o estalo está dentro do arquivo
export function scheduleChicoteSound(ac, out, buffer, elapsed = 0) {
  const t0 = ac.currentTime + 0.02 - elapsed;
  for (const [at, side, force] of LASHES) {
    if (at < elapsed - 0.05) continue;
    const src = ac.createBufferSource();
    src.buffer = buffer;
    const gain = ac.createGain();
    gain.gain.value = 0.75 * force;
    const pan = ac.createStereoPanner();
    pan.pan.value = side * 0.4;
    src.connect(gain).connect(pan).connect(out);
    const when = t0 + at - SNAP_AT;
    src.start(Math.max(ac.currentTime, when), Math.max(0, ac.currentTime - when));
  }
}

let audioCtx;
let soundData;
function loadSound(url) {
  if (!soundData) {
    soundData = fetch(url)
      .then((r) => { if (!r.ok) throw new Error('som indisponível'); return r.arrayBuffer(); })
      .then((bytes) => audioCtx.decodeAudioData(bytes))
      .catch((err) => { soundData = null; throw err; });
  }
  return soundData;
}
// Devolve a função que corta o som (usada se o golpe for interrompido).
function playSound(url, muted) {
  if (muted) return () => {};
  try {
    audioCtx = audioCtx || new AudioContext();
    audioCtx.resume().catch(() => {});
    const master = audioCtx.createGain();
    master.connect(audioCtx.destination);
    const asked = performance.now();
    loadSound(url)
      .then((buffer) => scheduleChicoteSound(audioCtx, master, buffer, (performance.now() - asked) / 1000))
      .catch(() => { /* sem áudio, a animação segue */ });
    return () => master.disconnect();
  } catch (_) { return () => {}; }
}

function drawStar(ctx, x, y, outer, inner, points, turn) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const a = turn + (i * Math.PI) / points;
    const r = i % 2 ? inner : outer;
    ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// Onda que percorre a corda depois do estalo: é o ricochete. k vai da mão (0) até a ponta (1).
function ripple(age, k) {
  if (age <= 0) return 0;
  return Math.exp(-age * 4.2) * Math.sin(age * 34 - k * 10) * k * 0.3 * Math.min(1, age / 0.04);
}

function drawWhip(ctx, hand, side, reach, pose, unit, age) {
  const [c1, c2, tip] = pose.map(([x, y]) => [hand[0] - side * x * reach, hand[1] + y * reach]);
  const point = (k) => {
    const u = 1 - k;
    const [x, y] = [0, 1].map((i) => u * u * u * hand[i] + 3 * u * u * k * c1[i] + 3 * u * k * k * c2[i] + k * k * k * tip[i]);
    return [x, y + ripple(age, k) * reach];
  };
  const STEPS = 72;
  const pts = Array.from({ length: STEPS + 1 }, (_, i) => point(i / STEPS));
  ctx.lineCap = 'round';
  // contorno escuro por baixo, couro por cima, afinando até a ponta
  for (const [color, extra] of [['#2b160b', unit * 0.022], ['#9a5a2c', 0]]) {
    ctx.strokeStyle = color;
    for (let i = 1; i <= STEPS; i += 1) {
      ctx.lineWidth = mix(unit * 0.085, unit * 0.012, i / STEPS) + extra;
      ctx.beginPath();
      ctx.moveTo(...pts[i - 1]);
      ctx.lineTo(...pts[i]);
      ctx.stroke();
    }
  }
  // franja na ponta
  const end = pts[STEPS];
  const heading = Math.atan2(end[1] - pts[STEPS - 3][1], end[0] - pts[STEPS - 3][0]);
  ctx.strokeStyle = '#2b160b';
  ctx.lineWidth = unit * 0.01;
  for (const spread of [-0.5, 0, 0.5]) {
    ctx.beginPath();
    ctx.moveTo(...end);
    ctx.lineTo(end[0] + Math.cos(heading + spread) * unit * 0.07, end[1] + Math.sin(heading + spread) * unit * 0.07);
    ctx.stroke();
  }
  // cabo
  const angle = Math.atan2(pts[4][1] - hand[1], pts[4][0] - hand[0]);
  ctx.save();
  ctx.translate(...hand);
  ctx.rotate(angle);
  ctx.fillStyle = '#4a2511';
  ctx.lineWidth = unit * 0.016;
  ctx.beginPath();
  ctx.roundRect(-unit * 0.36, -unit * 0.065, unit * 0.4, unit * 0.13, unit * 0.045);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#c9983f';
  for (const x of [-unit * 0.34, -unit * 0.01]) ctx.fillRect(x, -unit * 0.065, unit * 0.035, unit * 0.13);
  ctx.restore();
}

// findTile é chamado a cada quadro porque o palco é redesenhado quando a call muda.
export function playChicote({ findTile, soundUrl, muted, onEnd }) {
  const first = findTile();
  if (!first) return null;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const canvas = h('canvas', { class: 'chicote-canvas' });
  const root = h('div', { class: 'zoeira-fx chicote-fx', 'aria-hidden': 'true' }, canvas);
  document.body.append(root);
  const ctx = canvas.getContext('2d');

  let lastTile = first;
  let raf = 0;
  let w = 0;
  let h_ = 0;
  let nextShake = 0;
  let shaking = null;
  let stopped = false;
  const start = performance.now();
  const stopSound = playSound(soundUrl, muted);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    clearTimeout(guard);
    stopSound();
    shaking?.cancel();
    root.remove();
    onEnd();
  };
  // Aba em segundo plano não roda requestAnimationFrame: garante que o golpe termina.
  const guard = setTimeout(stop, (CHICOTE_DURATION + 0.5) * 1000);

  const frame = (now) => {
    const t = (now - start) / 1000;
    if (t >= CHICOTE_DURATION) { stop(); return; }
    raf = requestAnimationFrame(frame);

    const tile = findTile() || (lastTile.isConnected ? lastTile : null);
    if (!tile) { root.style.visibility = 'hidden'; return; }
    lastTile = tile;
    root.style.visibility = 'visible';

    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (window.innerWidth !== w || window.innerHeight !== h_) {
      w = window.innerWidth;
      h_ = window.innerHeight;
      canvas.width = w * ratio;
      canvas.height = h_ * ratio;
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h_);

    // o quadro leva o tranco
    if (nextShake < LASHES.length && t >= LASHES[nextShake][0]) {
      const [, side, force] = LASHES[nextShake];
      nextShake += 1;
      if (!reduce && tile.animate) {
        const push = -side * 18 * force;
        shaking = tile.animate([
          { transform: 'none' },
          { transform: `translateX(${push}px) rotate(${-side * 3.5 * force}deg)` },
          { transform: `translateX(${-push * 0.6}px) rotate(${side * 2 * force}deg)` },
          { transform: `translateX(${push * 0.3}px)` },
          { transform: 'none' }
        ], { duration: 320, easing: 'ease-out' });
      }
    }

    const rect = tile.getBoundingClientRect();
    const unit = Math.min(rect.width, rect.height);
    const fade = clamp((CHICOTE_DURATION - t) / 0.3);
    ctx.globalAlpha = fade;

    // chicote da estalada atual
    const index = LASHES.findIndex(([at]) => t < at + 0.07 + BACK);
    if (index >= 0 && !reduce) {
      const [at, side, , target] = LASHES[index];
      if (t >= at - STRIKE - WINDUP) {
        const hand = [side < 0 ? rect.left - unit * 0.35 : rect.right + unit * 0.35, rect.top + rect.height * 0.7];
        const aim = [rect.left + rect.width * target[0], rect.top + rect.height * target[1]];
        const reach = Math.abs(aim[0] - hand[0]) || 1;
        const tip = [1, (aim[1] - hand[1]) / reach];
        const hit = [[0.35, tip[1] - 0.18], [0.7, tip[1] + 0.12], tip];
        ctx.globalAlpha = fade * clamp((t - (at - STRIKE - WINDUP)) / 0.1);
        drawWhip(ctx, hand, side, reach, poseAt(t - at, hit), unit, t - at);
        ctx.globalAlpha = fade;
      }
    }

    // estouro no ponto do impacto
    for (const [at, side, force, target] of LASHES) {
      const age = t - at;
      if (age < 0 || age > 0.6) continue;
      const x = rect.left + rect.width * target[0];
      const y = rect.top + rect.height * target[1];
      const pop = age < 0.09 ? 0.5 + (age / 0.09) * 0.65 : mix(1.15, 1, clamp((age - 0.09) / 0.1));
      ctx.globalAlpha = fade * clamp((0.6 - age) / 0.18);
      ctx.fillStyle = '#ffd23f';
      ctx.strokeStyle = '#1a1006';
      ctx.lineWidth = Math.max(2, unit * 0.012);
      drawStar(ctx, x, y, unit * 0.2 * force * pop, unit * 0.09 * force * pop, 9, -side * 0.3);
      ctx.globalAlpha = fade;
    }

    // estrelinhas de tonto
    const dizzy = t - LASHES[LASHES.length - 1][0] - 0.25;
    if (dizzy > 0) {
      ctx.fillStyle = '#ffd23f';
      ctx.strokeStyle = '#1a1006';
      ctx.lineWidth = Math.max(1.5, unit * 0.008);
      ctx.globalAlpha = fade * clamp(dizzy / 0.2);
      for (let i = 0; i < 5; i += 1) {
        const a = (reduce ? 0 : dizzy * 4.5) + (i * Math.PI * 2) / 5;
        const size = unit * (0.045 + 0.012 * Math.sin(a));
        drawStar(ctx, rect.left + rect.width / 2 + Math.cos(a) * unit * 0.3, rect.top + rect.height * 0.18 + Math.sin(a) * unit * 0.08, size, size * 0.45, 5, a);
      }
    }
    ctx.globalAlpha = 1;
  };
  raf = requestAnimationFrame(frame);
  return stop;
}
