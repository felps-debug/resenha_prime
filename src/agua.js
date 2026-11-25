// Golpe "Jogar água": borrifadas na lente da câmera de alguém, cada vez mais fortes.
// Desenho em canvas por cima do quadro; os sons são gerados na hora (sem arquivo).
import { h } from './ui.js';

export const AGUA_DURATION = 8.5;

// [instante em s, posição x, posição y, força] — posições relativas ao quadro.
const SPRAYS = [
  [0.25, 0.72, 0.34, 0.35],
  [1.05, 0.28, 0.62, 0.5],
  [1.75, 0.6, 0.7, 0.65],
  [2.35, 0.36, 0.3, 0.8],
  [2.85, 0.78, 0.55, 0.9],
  [3.35, 0.5, 0.48, 1.4]
];
const DRY_AT = AGUA_DURATION - 1.6;
const JET = 0.16;

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

let audioCtx;
function spraySound(force, muted) {
  if (muted) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    audioCtx.resume().catch(() => {});
    const dur = 0.22 + force * 0.25;
    const buffer = audioCtx.createBuffer(1, Math.ceil(audioCtx.sampleRate * dur), audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const band = audioCtx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.8;
    const t = audioCtx.currentTime;
    band.frequency.setValueAtTime(3800, t);
    band.frequency.exponentialRampToValueAtTime(1100, t + dur);
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.12 + force * 0.16, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(band).connect(gain).connect(audioCtx.destination);
    src.start(t);
  } catch (_) { /* sem áudio, a animação segue */ }
}

// Gota vista de frente: mostra o que está atrás invertido, como uma lente.
function drawDrop(ctx, d, video, w, h_) {
  const { x, y, r, stretch } = d;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * stretch, 0, 0, Math.PI * 2);
  ctx.clip();
  if (video) {
    const scale = Math.max(w / video.videoWidth, h_ / video.videoHeight);
    const sw = (r * 3.2) / scale;
    const sx = clamp(video.videoWidth / 2 + (x - w / 2) / scale - sw / 2, 0, video.videoWidth - sw);
    const sy = clamp(video.videoHeight / 2 + (y - h_ / 2) / scale - sw / 2, 0, video.videoHeight - sw);
    ctx.translate(x, y);
    ctx.scale(-1, -1);
    ctx.drawImage(video, sx, sy, sw, sw, -r, -r * stretch, r * 2, r * 2 * stretch);
    ctx.setTransform(ctx.canvas.width / w, 0, 0, ctx.canvas.height / h_, 0, 0);
  }
  const shade = ctx.createRadialGradient(x, y - r * 0.25, r * 0.2, x, y, r * 1.25);
  shade.addColorStop(0, 'rgba(215,238,255,0.08)');
  shade.addColorStop(0.7, 'rgba(160,205,240,0.18)');
  shade.addColorStop(1, 'rgba(8,22,40,0.55)');
  ctx.fillStyle = shade;
  ctx.fillRect(x - r, y - r * stretch, r * 2, r * 2 * stretch);
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.32, y - r * stretch * 0.38, r * 0.2, r * 0.13, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(230,246,255,0.45)';
  ctx.lineWidth = Math.max(0.8, r * 0.1);
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.82, r * stretch * 0.82, 0, 0.35, Math.PI - 0.35);
  ctx.stroke();
}

// findTile é chamado a cada quadro porque o palco é redesenhado quando a call muda.
export function playAgua({ findTile, muted, onEnd }) {
  const first = findTile();
  if (!first) return null;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const fog = h('div', { class: 'agua-fog' });
  const canvas = h('canvas', { class: 'agua-canvas' });
  const box = h('div', { class: 'agua-box' }, fog, canvas);
  const root = h('div', { class: 'zoeira-fx agua-fx', 'aria-hidden': 'true' }, box);
  document.body.append(root);
  const ctx = canvas.getContext('2d');

  const drops = [];
  const jets = [];
  let next = 0;
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

  const addDrop = (x, y, r) => {
    if (drops.length > 260) return;
    const slides = r > w * 0.016 && Math.random() < 0.5;
    drops.push({ x, y, r, stretch: rnd(0.95, 1.2), vy: 0, wait: slides ? rnd(0.5, 2.4) : Infinity, trail: 0 });
  };

  const impact = ([, rx, ry, force]) => {
    const cx = rx * w;
    const cy = ry * h_;
    const spread = Math.min(w, h_) * (0.18 + force * 0.28);
    const unit = Math.min(w, h_);
    addDrop(cx, cy, unit * (0.035 + force * 0.04));
    for (let i = 0; i < 10 + force * 26; i += 1) {
      const a = rnd(0, Math.PI * 2);
      const dist = Math.sqrt(Math.random()) * spread;
      addDrop(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist, unit * rnd(0.007, 0.012 + force * 0.026));
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

    // Cada borrifada: o jato entra por baixo e estoura na lente.
    while (next < SPRAYS.length && t >= SPRAYS[next][0]) {
      const spray = SPRAYS[next];
      next += 1;
      spraySound(spray[3], muted);
      jets.push({ spray, born: t, hit: false });
    }

    const dry = clamp((t - DRY_AT) / (AGUA_DURATION - DRY_AT), 0, 1);
    const wetness = clamp(next / SPRAYS.length, 0, 1) * (1 - dry);
    fog.style.opacity = String(wetness);
    box.style.opacity = String(1 - dry * dry);
    ctx.clearRect(0, 0, w, h_);

    const video = [tile.querySelector('video')].find((v) => v && v.videoWidth > 0) || null;
    for (const d of drops) {
      d.wait -= dt;
      if (d.wait <= 0 && !reduce) {
        d.vy = Math.min(h_ * 0.55, d.vy + h_ * 0.5 * dt);
        d.y += d.vy * dt;
        d.stretch = Math.min(1.5, d.stretch + dt * 0.6);
        d.trail = Math.min(h_ * 0.35, d.trail + d.vy * dt);
      }
      if (d.trail > 2) {
        const g = ctx.createLinearGradient(0, d.y - d.trail, 0, d.y);
        g.addColorStop(0, 'rgba(220,240,255,0)');
        g.addColorStop(1, 'rgba(220,240,255,0.28)');
        ctx.fillStyle = g;
        ctx.fillRect(d.x - d.r * 0.35, d.y - d.trail, d.r * 0.7, d.trail);
      }
      if (d.y - d.r < h_) drawDrop(ctx, d, video, w, h_);
    }

    for (let i = jets.length - 1; i >= 0; i -= 1) {
      const { spray, born } = jets[i];
      const [, rx, ry, force] = spray;
      const p = (t - born) / JET;
      const cx = rx * w;
      const cy = ry * h_;
      if (p >= 1) {
        if (!jets[i].hit) { impact(spray); jets[i].hit = true; }
        const q = (t - born - JET) / 0.35;
        if (q >= 1) { jets.splice(i, 1); continue; }
        // Respingo: anel de água abrindo a partir do ponto de impacto.
        const reach = Math.min(w, h_) * (0.1 + force * 0.4) * (0.3 + q);
        ctx.strokeStyle = `rgba(235,248,255,${0.8 * (1 - q)})`;
        ctx.lineCap = 'round';
        for (let k = 0; k < 18; k += 1) {
          const a = (k / 18) * Math.PI * 2 + born;
          const len = reach * (0.2 + ((k * 7) % 5) / 14);
          ctx.lineWidth = (2 + force * 3) * (1 - q);
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * reach, cy + Math.sin(a) * reach);
          ctx.lineTo(cx + Math.cos(a) * (reach + len), cy + Math.sin(a) * (reach + len));
          ctx.stroke();
        }
        if (!reduce) {
          ctx.fillStyle = `rgba(230,245,255,${0.45 * force * (1 - q) * (1 - q)})`;
          ctx.fillRect(0, 0, w, h_);
        }
      } else if (!reduce) {
        const ox = w * 0.5;
        const oy = h_ * 1.25;
        const x = ox + (cx - ox) * p;
        const y = oy + (cy - oy) * p;
        ctx.strokeStyle = 'rgba(225,244,255,0.75)';
        ctx.lineCap = 'round';
        for (let k = -3; k <= 3; k += 1) {
          ctx.lineWidth = 2 + p * force * 9 - Math.abs(k) * 0.4;
          ctx.beginPath();
          ctx.moveTo(ox + k * 3, oy);
          ctx.lineTo(x + k * p * w * 0.035, y + Math.abs(k) * 4);
          ctx.stroke();
        }
      }
    }
  };
  raf = requestAnimationFrame(frame);
  return stop;
}
