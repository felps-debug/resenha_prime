// Copia o RNNoise (filtro de ruído por rede neural) para public/noise, de onde o navegador carrega.
const fs = require('node:fs');
const path = require('node:path');
const src = path.join(__dirname, '..', 'node_modules', '@sapphi-red', 'web-noise-suppressor', 'dist');
const dest = path.join(__dirname, '..', 'public', 'noise');
if (!fs.existsSync(src)) { console.warn('web-noise-suppressor não instalado; pulando a cópia do RNNoise.'); process.exit(0); }
fs.mkdirSync(dest, { recursive: true });
for (const [from, to] of [['rnnoise/workletProcessor.js', 'rnnoiseWorklet.js'], ['rnnoise.wasm', 'rnnoise.wasm'], ['rnnoise_simd.wasm', 'rnnoise_simd.wasm']]) {
  fs.copyFileSync(path.join(src, from), path.join(dest, to));
}
