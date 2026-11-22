const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

test('servidor lê o arquivo .env local sem expor as chaves', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'resenha-env-'));
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  fs.writeFileSync(path.join(temp, '.env'), `PORT=${port}\nLIVEKIT_URL=wss://example.invalid\nLIVEKIT_API_KEY=example-key\nLIVEKIT_API_SECRET=example-secret\n`);
  const env = { ...process.env };
  for (const name of ['PORT', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']) delete env[name];
  const child = spawn(process.execPath, [path.resolve(__dirname, '../server.js')], { cwd: temp, env, stdio: 'ignore' });
  try {
    let response;
    for (let i = 0; i < 400; i++) {
      try { response = await fetch(`http://127.0.0.1:${port}/config`); break; } catch (_) { await new Promise((resolve) => setTimeout(resolve, 50)); }
    }
    assert.ok(response, 'Servidor não carregou a porta do .env');
    const config = await response.json();
    assert.equal(config.livekitReady, true);
    assert.equal(JSON.stringify(config).includes('example-secret'), false);
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
    }
    fs.unlinkSync(path.join(temp, '.env'));
    fs.rmdirSync(temp);
  }
});
