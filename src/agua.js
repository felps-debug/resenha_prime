// Golpe "Jogar água": esguichos de água grossa que abrem e fecham, fazem o arco e caem na cara.
// A água é desenhada em bolas e um filtro SVG as funde num líquido viscoso; o som é gerado na hora.
import { h } from './ui.js';

export const AGUA_DURATION = 5.8;

// Cada esguicho: [abre, fecha, força, lado]. Lado é de onde ele entra, na horizontal.
// Todos vêm de baixo para a cara, alternando esquerda e direita; no fim vêm dos dois juntos.
const BURSTS = [
  [0.15, 0.4, 0.9, -0.06],
  [0.6, 0.85, 1, 1.06],
  [1.05, 1.3, 1, 0.14],
  [1.45, 1.7, 1, 0.86],
  [1.95, 2.25, 1, -0.06],
  [2.35, 2.65, 1, 1.06],
  [2.85, 3.7, 1, 0.08],
  [2.95, 3.7, 1, 0.92]
];
const RAMP = 0.1; // tempo para o esguicho ganhar ou perder força
const DRY_AT = AGUA_DURATION - 1.1;

// Posições relativas ao quadro; a água entra por baixo, de fora da tela.
const SOURCE_Y = 1.04;
const FACE = [0.52, 0.43];

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 0 = fechado, 1 = força total.
function pressureAt(t, [on, off, max]) {
  if (t < on || t >= off + RAMP) return 0;
  return max * Math.min(clamp((t - on) / RAMP, 0, 1), clamp((off + RAMP - t) / RAMP, 0, 1));
}

let audioCtx;
function waterSound(force, seconds, muted) {
  if (muted) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    audioCtx.resume().catch(() => {});
    const dur = seconds + RAMP;
    const buffer = audioCtx.createBuffer(1, Math.ceil(audioCtx.sampleRate * dur), audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (0.7 + 0.3 * Math.sin(i / 900) * Math.sin(i / 2300));
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const band = audioCtx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.6;
    band.frequency.value = 1100;
    const t = audioCtx.currentTime;
    const gain = audioCtx.createGain();
    const peak = 0.1 + force * 0.14;
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + RAMP);
    gain.gain.setValueAtTime(peak, t + Math.max(RAMP, seconds));
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(band).connect(gain).connect(audioCtx.destination);
    src.start(t);
  } catch (_) { /* sem áudio, a animação segue */ }
}

// Filtro que funde as bolas num líquido: borra, recorta a borda e põe contorno e brilho.
let filterSeq = 0;
function gooFilter() {
  filterSeq += 1;
  const id = `agua-goo-${filterSeq}`;
  const holder = document.createElement('div');
  holder.innerHTML = `<svg width="0" height="0" aria-hidden="true"><filter id="${id}" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
<feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur"/>
<feColorMatrix in="blur" values="0 0 0 0 0.66  0 0 0 0 0.85  0 0 0 0 1  0 0 0 24 -10" result="shape"/>
<feComponentTransfer in="shape" result="body"><feFuncA type="linear" slope="0.5"/></feComponentTransfer>
<feMorphology in="shape" operator="erode" radius="2.4" result="inner"/>
<feComposite in="shape" in2="inner" operator="out" result="ring"/>
<feColorMatrix in="ring" values="0 0 0 0 0.10  0 0 0 0 0.36  0 0 0 0 0.62  0 0 0 0.75 0" result="rim"/>
<feGaussianBlur in="shape" stdDeviation="4" result="height"/>
<feSpecularLighting in="height" surfaceScale="9" specularConstant="1.15" specularExponent="30" lighting-color="#ffffff" result="light"><feDistantLight azimuth="235" elevation="42"/></feSpecularLighting>
<feComposite in="light" in2="shape" operator="in" result="shine"/>
<feMerge><feMergeNode in="body"/><feMergeNode in="rim"/><feMergeNode in="shine"/></feMerge></filter></svg>`;
  const blurs = holder.querySelectorAll('feGaussianBlur');
  return { id, svg: holder.firstChild, merge: blurs[0], height: blurs[1], erode: holder.querySelector('feMorphology') };
}

// findTile é chamado a cada quadro porque o palco é redesenhado quando a call muda.
export function playAgua({ findTile, muted, onEnd }) {
  const first = findTile();
  if (!first) return null;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const goo = gooFilter();
  const fog = h('div', { class: 'agua-fog' });
  const canvas = h('canvas', { class: 'agua-canvas', style: { filter: `url(#${goo.id})` } });
  const box = h('div', { class: 'agua-box' }, fog, canvas);
  const root = h('div', { class: 'zoeira-fx agua-fx', 'aria-hidden': 'true' }, box);
  root.append(goo.svg);
  document.body.append(root);
  const ctx = canvas.getContext('2d');

  const water = [];
  const splashes = [];
  const stuck = [];
  let next = 0;
  let wet = 0;
  const owed = BURSTS.map(() => 0);
  let w = 0;
  let h_ = 0;
  let lastTile = first;
  let raf = 0;
  let prev = performance.now();
  const start = prev;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    clearTimeout(guard);
    root.remove();
    onEnd();
  };
  // Aba em segundo plano não roda requestAnimationFrame: garante que o golpe termina.
  const guard = setTimeout(stop, (AGUA_DURATION + 0.5) * 1000);

  // Bola de água alongada na direção em que está indo.
  const blob = (x, y, r, vx = 0, vy = 0) => {
    const long = 1 + Math.min(1.6, Math.hypot(vx, vy) / (h_ * 2));
    ctx.beginPath();
    ctx.ellipse(x, y, r * long, r, Math.atan2(vy, vx), 0, Math.PI * 2);
    ctx.fill();
  };

  // A água grossa gruda na cara e depois escorre devagar.
  const hitFace = (p, unit) => {
    wet = Math.min(1, wet + 0.004);
    if (stuck.length < 130 && Math.random() < 0.22) {
      const x = p.x + rnd(-1, 1) * unit * 0.28;
      const y = p.y + rnd(-1, 0.8) * unit * 0.24;
      stuck.push({ x, y, top: y, r: unit * rnd(0.018, 0.042), vy: 0, wait: rnd(0.15, 1.6), speed: unit * rnd(0.04, 0.22) });
    }
    if (splashes.length < 160 && Math.random() < 0.22) {
      const a = rnd(-Math.PI, 0.3);
      const speed = unit * rnd(0.5, 1.7);
      splashes.push({ x: p.x, y: p.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: unit * rnd(0.012, 0.024), life: rnd(0.3, 0.6), age: 0 });
    }
  };

  const frame = (now) => {
    const t = (now - start) / 1000;
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    if (t >= AGUA_DURATION) { stop(); return; }
    raf = requestAnimationFrame(frame);

    const tile = findTile() || (lastTile.isConnected ? lastTile : null);
    if (!tile) { root.style.visibility = 'hidden'; return; }
    lastTile = tile;
    root.style.visibility = 'visible';
    const rect = tile.getBoundingClientRect();
    if (Math.round(rect.width) !== w || Math.round(rect.height) !== h_) {
      w = Math.round(rect.width);
      h_ = Math.round(rect.height);
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = w * ratio;
      canvas.height = h_ * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    if (!w || !h_) return;
    Object.assign(box.style, { left: rect.left + 'px', top: rect.top + 'px', width: w + 'px', height: h_ + 'px', borderRadius: getComputedStyle(tile).borderRadius });

    while (next < BURSTS.length && t >= BURSTS[next][0]) {
      const [on, off, max] = BURSTS[next];
      next += 1;
      waterSound(max, off - on, muted);
    }

    const unit = Math.min(w, h_);
    // O quanto o filtro funde as bolas acompanha o tamanho do quadro.
    const merge = Math.max(2.5, unit * 0.014);
    goo.merge.setAttribute('stdDeviation', String(merge));
    goo.height.setAttribute('stdDeviation', String(merge * 0.8));
    goo.erode.setAttribute('radius', String(Math.max(1.2, unit * 0.005)));

    // Balística: sobe, faz o arco e chega no alvo.
    const flight = 0.3;
    const gravity = h_ * 9;
    BURSTS.forEach((burst, k) => {
      const pressure = pressureAt(t, burst);
      if (pressure <= 0.02 || reduce) return;
      const sx = burst[3] * w;
      const sy = SOURCE_Y * h_;
      // Quem vem de um lado acerta mais para aquele lado; a mira treme e varre a cara.
      const lean = burst[3] < 0.5 ? -0.07 : 0.07;
      const targetX = (FACE[0] + lean + Math.sin(t * 9 + k * 2.1) * 0.11) * w;
      const targetY = (FACE[1] + Math.sin(t * 12 + k * 1.3) * 0.1) * h_;
      const vx = (targetX - sx) / flight;
      const vy = (targetY - sy - 0.5 * gravity * flight * flight) / flight;
      // Com pouca força a água sai mole e cai antes de chegar.
      const power = 0.4 + 0.6 * Math.min(1, pressure / 0.8);
      owed[k] += dt * 300;
      for (; owed[k] >= 1 && water.length < 450; owed[k] -= 1) {
        const slip = Math.random() * dt;
        const loose = Math.random() < 0.35 ? 0.13 : 0.035;
        const pvx = vx * power * (1 + rnd(-loose, loose));
        const pvy = vy * power * (1 + rnd(-loose, loose));
        const lumpy = 1 + 0.28 * Math.sin((t - slip) * 31) + rnd(-0.12, 0.12);
        water.push({ x: sx + pvx * slip, y: sy + pvy * slip + 0.5 * gravity * slip * slip, vx: pvx, vy: pvy + gravity * slip, age: slip, flight, r: unit * (loose > 0.1 ? 0.018 : 0.03) * (0.45 + 0.55 * pressure) * lumpy, reaches: pressure > 0.6 });
      }
    });

    const dry = clamp((t - DRY_AT) / (AGUA_DURATION - DRY_AT), 0, 1);
    fog.style.opacity = String(wet * 0.6 * (1 - dry));
    box.style.opacity = String(1 - dry * dry);
    ctx.clearRect(0, 0, w, h_);
    ctx.fillStyle = '#fff';

    for (const d of stuck) {
      d.wait -= dt;
      if (d.wait <= 0 && !reduce) {
        d.vy = Math.min(d.speed, d.vy + d.speed * dt);
        d.y += d.vy * dt;
        d.r *= 1 - dt * 0.05;
      }
      // Fio grosso que fica para trás enquanto escorre.
      const length = d.y - d.top;
      if (length > 1) {
        ctx.beginPath();
        ctx.moveTo(d.x - d.r * 0.25, d.top);
        ctx.lineTo(d.x + d.r * 0.25, d.top);
        ctx.lineTo(d.x + d.r * 0.6, d.y);
        ctx.lineTo(d.x - d.r * 0.6, d.y);
        ctx.fill();
        d.top += Math.max(0, length - unit * 0.22);
      }
      blob(d.x, d.y, d.r, 0, d.vy * 4);
    }

    for (let i = water.length - 1; i >= 0; i -= 1) {
      const p = water[i];
      p.age += dt;
      p.vy += gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.reaches && p.age >= p.flight) { hitFace(p, unit); water.splice(i, 1); continue; }
      if (p.y > h_ + unit * 0.15) { water.splice(i, 1); continue; }
      blob(p.x, p.y, p.r, p.vx, p.vy);
    }
    for (let i = splashes.length - 1; i >= 0; i -= 1) {
      const p = splashes[i];
      p.age += dt;
      if (p.age >= p.life) { splashes.splice(i, 1); continue; }
      p.vy += gravity * 0.45 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      blob(p.x, p.y, p.r * (1 - 0.5 * p.age / p.life), p.vx, p.vy);
    }
  };
  raf = requestAnimationFrame(frame);
  return stop;
}
