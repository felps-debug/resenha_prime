const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const OWNER = 'a1f01f98-f831-46e9-90ac-a4e84276c600';
const OTHER = '00000000-0000-0000-0000-000000000002';

test('jogar água é exclusivo de uma conta; a privada continua liberada', async () => {
  const build = await esbuild.build({ absWorkingDir: path.resolve(__dirname, '..'), entryPoints: ['src/zoeira-rules.js'],
    bundle: true, format: 'cjs', write: false });
  const mod = { exports: {} };
  new Function('module', 'exports', build.outputFiles[0].text)(mod, mod.exports);
  const { canZoeira } = mod.exports;
  assert.equal(canZoeira('agua', OWNER), true);
  assert.equal(canZoeira('agua', OTHER), false);
  assert.equal(canZoeira('agua', undefined), false);
  assert.equal(canZoeira('privada', OTHER), true);
});
