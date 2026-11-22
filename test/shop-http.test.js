const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const Stripe = require('stripe');

test('rotas da loja exigem login e verificam o corpo original do webhook', async () => {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const secret = 'whsec_test_http';
  const child = spawn(process.execPath, [path.resolve(__dirname, '../server.js')], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore',
    env: { ...process.env, PORT: String(port), STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: secret,
      SUPABASE_SERVICE_ROLE_KEY: 'fake-service-secret', RESENHA_APP_URL: `http://127.0.0.1:${port}` } });
  const base = `http://127.0.0.1:${port}`;
  try {
    let config;
    for (let i = 0; i < 400; i++) {
      try { config = await (await fetch(`${base}/config`)).json(); break; } catch (_) { await new Promise((resolve) => setTimeout(resolve, 50)); }
    }
    assert.equal(config.shopReady, true);
    assert.equal(JSON.stringify(config).includes('fake-service-secret'), false);
    const checkout = await fetch(`${base}/api/checkout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(checkout.status, 401);
    const payload = JSON.stringify({ type: 'checkout.session.completed', livemode: false, data: { object: { payment_status: 'unpaid' } } });
    const stripe = new Stripe('sk_test_fake');
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
    const send = (body) => fetch(`${base}/api/stripe-webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body });
    assert.equal((await send(payload)).status, 200);
    assert.equal((await send(payload + ' ')).status, 400);
  } finally {
    if (child.exitCode === null) { const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await exited; }
  }
});
