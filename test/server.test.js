const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');

let server;
let base;

before(async () => {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.listen(0, '127.0.0.1', resolve).on('error', reject));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['server.js'], {
    cwd: require('node:path').join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), LIVEKIT_URL: 'wss://example.invalid', LIVEKIT_API_KEY: 'test', LIVEKIT_API_SECRET: 'test', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', SUPABASE_SERVICE_ROLE_KEY: '', RESENHA_APP_URL: '' },
    stdio: 'ignore'
  });
  for (let i = 0; i < 400; i++) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Servidor de teste não iniciou.');
});

after(() => { if (server) server.kill(); });

test('health responde e o aplicativo é servido', async () => {
  const health = await fetch(`${base}/health`);
  assert.equal(await health.text(), 'ok');
  assert.equal((await fetch(`${base}/`)).status, 200);
});

test('política de conteúdo restringe scripts e permite o tema de inicialização', async () => {
  const response = await fetch(`${base}/`);
  const csp = response.headers.get('content-security-policy');
  assert.ok(csp && csp.includes("frame-ancestors 'none'"));
  const html = fs.readFileSync(require('node:path').join(__dirname, '../public/index.html'), 'utf8');
  assert.equal(/<script\s*>/i.test(html), false);
  assert.match(html, /<script src="\/theme-init\.js"><\/script>/);
  assert.equal((await fetch(`${base}/theme-init.js`)).status, 200);
  assert.ok(!csp.match(/script-src[^;]*'unsafe-inline'/));
  assert.equal(response.headers.get('strict-transport-security'), null);
  const https = await fetch(`${base}/health`, { headers: { 'x-forwarded-proto': 'https' } });
  assert.match(https.headers.get('strict-transport-security'), /max-age=31536000/);
});

test('arquivos de chamada com hash são reutilizados pelo navegador', async () => {
  const dir = require('node:path').join(__dirname, '../public/dist');
  const chunk = fs.readdirSync(dir).find((name) => /^chunk-[A-Z0-9]+\.js$/.test(name));
  assert.ok(chunk, 'Execute npm run build antes dos testes.');
  const response = await fetch(`${base}/dist/${chunk}`);
  assert.match(response.headers.get('cache-control'), /max-age=31536000/);
  assert.match(response.headers.get('cache-control'), /immutable/);
});

test('token de call exige login', async () => {
  const response = await fetch(`${base}/api/livekit-token`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roomId: '00000000-0000-0000-0000-000000000001' })
  });
  assert.equal(response.status, 401);
});

test('moderação exige login para dados válidos', async () => {
  const response = await fetch(`${base}/api/moderate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roomId: '00000000-0000-0000-0000-000000000001', userId: '00000000-0000-0000-0000-000000000002', action: 'kick' })
  });
  assert.equal(response.status, 401);
});

test('prévia rejeita URLs de outros sites e exige login para posts do X', async () => {
  assert.equal((await fetch(`${base}/api/link-preview?url=${encodeURIComponent('https://example.com/')}`)).status, 400);
  assert.equal((await fetch(`${base}/api/link-preview?url=${encodeURIComponent('https://x.com/example/status/123')}`)).status, 401);
});

test('loja permanece indisponível sem credenciais de teste', async () => {
  const checkout = await fetch(`${base}/api/checkout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const webhook = await fetch(`${base}/api/stripe-webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(checkout.status, 503);
  assert.equal(webhook.status, 503);
});
