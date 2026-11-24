const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

test('biblioteca de chamada não entra no arquivo principal do aplicativo', async () => {
  const build = await esbuild.build({ absWorkingDir: path.resolve(__dirname, '..'), entryPoints: ['src/main.js'],
    bundle: true, splitting: true, format: 'esm', outdir: 'public/dist', write: false, metafile: true });
  const entry = Object.values(build.metafile.outputs).find((output) => output.entryPoint === 'src/main.js');
  assert.ok(entry);
  assert.equal(Object.keys(entry.inputs).some((name) => name.includes('livekit-client')), false);
});

test('animação de zoeira (gsap) não entra no arquivo principal do aplicativo', async () => {
  const build = await esbuild.build({ absWorkingDir: path.resolve(__dirname, '..'), entryPoints: ['src/main.js'],
    bundle: true, splitting: true, format: 'esm', outdir: 'public/dist', write: false, metafile: true });
  const entry = Object.values(build.metafile.outputs).find((output) => output.entryPoint === 'src/main.js');
  assert.ok(entry);
  assert.equal(Object.keys(entry.inputs).some((name) => name.includes('node_modules/gsap')), false);
});
