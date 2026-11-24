// Cadeia do microfone: corte de graves + RNNoise (rede neural que tira ventilador, teclado e barulho de fundo) + voz zoada.
// Tudo roda no navegador de quem fala. Nada vai para um servidor de áudio.
const WORKLET = '/noise/rnnoiseWorklet.js';
const WASM = '/noise/rnnoise.wasm';
const WASM_SIMD = '/noise/rnnoise_simd.wasm';

let libPromise = null;
function lib() {
  if (!libPromise) libPromise = import('@sapphi-red/web-noise-suppressor').catch((e) => { libPromise = null; throw e; });
  return libPromise;
}
let wasmPromise = null;
async function wasm() {
  if (!wasmPromise) wasmPromise = lib().then((m) => m.loadRnnoise({ url: WASM, simdUrl: WASM_SIMD })).catch((e) => { wasmPromise = null; throw e; });
  return wasmPromise;
}

// Voz zoada (Loja): robô e rádio de pinga
function voiceStage(a, input, kind) {
  const nodes = [];
  if (kind === 'robo') {
    const osc = a.createOscillator(); osc.frequency.value = 55; osc.type = 'sine';
    const mod = a.createGain(); mod.gain.value = 0;
    osc.connect(mod.gain); input.connect(mod); osc.start();
    nodes.push(osc, mod);
    return { output: mod, nodes };
  }
  if (kind === 'radio') {
    const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500;
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2800;
    const sh = a.createWaveShaper(); const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) curve[i] = Math.tanh(((i / 128) - 1) * 6);
    sh.curve = curve;
    input.connect(hp).connect(lp).connect(sh);
    nodes.push(hp, lp, sh);
    return { output: sh, nodes };
  }
  return { output: input, nodes };
}

// Monta a cadeia: entrada -> (corte de graves -> RNNoise) -> (voz zoada) -> saída
async function buildChain(a, input, { noise, voice }) {
  const nodes = [];
  let last = input;
  if (noise) {
    const { RnnoiseWorkletNode } = await lib();
    const binary = await wasm();
    await a.audioWorklet.addModule(WORKLET);
    // Vento e sopro do ventilador no microfone são graves: o corte de 90 Hz tira a maior parte antes da rede neural
    const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90; hp.Q.value = 0.7;
    const rn = new RnnoiseWorkletNode(a, { maxChannels: 1, wasmBinary: binary });
    last.connect(hp); hp.connect(rn);
    nodes.push(hp, rn);
    last = rn;
  }
  if (voice && voice !== 'normal') {
    const v = voiceStage(a, last, voice);
    nodes.push(...v.nodes);
    last = v.output;
  }
  return { output: last, nodes };
}

function disconnectAll(nodes) {
  for (const n of nodes) {
    try { if (n.destroy) n.destroy(); } catch (_) {}
    try { n.disconnect(); } catch (_) {}
    try { if (n.stop) n.stop(); } catch (_) {}
  }
}

// Processador de faixa para o LiveKit (track.setProcessor)
export function makeMicProcessor({ noise, voice }) {
  let a = null, src = null, dest = null, nodes = [];
  return {
    name: 'microfone-resenha',
    processedTrack: undefined,
    async init(opts) {
      a = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' }); // o RNNoise exige 48 kHz
      if (a.state === 'suspended') await a.resume().catch(() => {});
      src = a.createMediaStreamSource(new MediaStream([opts.track]));
      dest = a.createMediaStreamDestination();
      const chain = await buildChain(a, src, { noise, voice });
      chain.output.connect(dest);
      nodes = chain.nodes;
      this.processedTrack = dest.stream.getAudioTracks()[0];
    },
    async restart(opts) { await this.destroy(); await this.init(opts); },
    async destroy() {
      disconnectAll(nodes); nodes = [];
      try { src && src.disconnect(); } catch (_) {}
      if (a) { try { await a.close(); } catch (_) {} a = null; }
    }
  };
}

// Teste de microfone: toca o áudio já filtrado no seu fone (use fone para não dar eco)
export async function startMicTest(stream, { noise, voice }, onLevel) {
  const a = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  if (a.state === 'suspended') await a.resume().catch(() => {});
  const src = a.createMediaStreamSource(stream);
  const chain = await buildChain(a, src, { noise, voice });
  const an = a.createAnalyser(); an.fftSize = 512;
  chain.output.connect(an);
  chain.output.connect(a.destination);
  const buf = new Uint8Array(an.fftSize);
  let raf = 0, alive = true;
  const loop = () => {
    if (!alive) return;
    an.getByteTimeDomainData(buf);
    let sum = 0; for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
    if (onLevel) onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
    raf = requestAnimationFrame(loop);
  };
  loop();
  return {
    async stop() {
      alive = false; cancelAnimationFrame(raf);
      disconnectAll(chain.nodes);
      try { src.disconnect(); } catch (_) {}
      stream.getTracks().forEach((t) => t.stop());
      try { await a.close(); } catch (_) {}
    }
  };
}
