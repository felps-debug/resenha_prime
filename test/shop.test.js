const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCheckout, handleWebhook, ShopInputError } = require('../shop');

const roomId = '00000000-0000-0000-0000-000000000001';
function fixtures() {
  const state = { pending: [], sessions: [], fulfilled: [] };
  const store = {
    isMember: async () => true,
    item: async () => ({ id: 'telao', name: 'Telão da sala', price_cents: 50, active: true }),
    createPending: async (data) => { state.pending.push(data); return 'purchase-1'; },
    bindSession: async () => {},
    fulfill: async (data) => { state.fulfilled.push(data); }
  };
  const stripe = { checkout: { sessions: { create: async (data) => { state.sessions.push(data); return { id: 'cs_test_1', url: 'https://checkout.stripe.test/session' }; } } },
    webhooks: { constructEvent: (_body, signature) => { if (signature !== 'valid') throw new Error('invalid signature'); return state.event; } } };
  return { state, store, stripe };
}

test('checkout usa o preço do catálogo e a pessoa autenticada', async () => {
  const f = fixtures();
  await createCheckout({ roomId, text: 'Bora jogar', price: 1 }, { ...f, userId: 'user-1', origin: 'https://example.com' });
  assert.equal(f.state.pending[0].price_cents, 50);
  assert.equal(f.state.pending[0].buyer_id, 'user-1');
  assert.equal(f.state.sessions[0].line_items[0].price_data.unit_amount, 50);
  assert.deepEqual(f.state.sessions[0].payment_method_types, ['card', 'pix']);
});

test('checkout rejeita quem não é membro e texto inválido', async () => {
  const f = fixtures();
  f.store.isMember = async () => false;
  await assert.rejects(createCheckout({ roomId, text: 'Oi' }, { ...f, userId: 'user-1', origin: 'https://example.com' }));
  f.store.isMember = async () => true;
  await assert.rejects(createCheckout({ roomId, text: 'x'.repeat(41) }, { ...f, userId: 'user-1', origin: 'https://example.com' }));
  assert.equal(f.state.sessions.length, 0);
});

test('erros de validação são distintos de falhas internas do checkout', async () => {
  const f = fixtures();
  await assert.rejects(createCheckout({ roomId, text: '' }, { ...f, userId: 'user-1', origin: 'https://example.com' }), ShopInputError);
  f.store.item = async () => { throw new Error('falha interna'); };
  await assert.rejects(createCheckout({ roomId, text: 'Olá' }, { ...f, userId: 'user-1', origin: 'https://example.com' }), (error) => !(error instanceof ShopInputError));
});

test('webhook rejeita assinatura inválida e não libera Pix pendente', async () => {
  const f = fixtures();
  await assert.rejects(handleWebhook(Buffer.from('{}'), 'wrong', { ...f, secret: 'whsec_test' }));
  f.state.event = { type: 'checkout.session.completed', livemode: false, data: { object: { payment_status: 'unpaid' } } };
  await handleWebhook(Buffer.from('{}'), 'valid', { ...f, secret: 'whsec_test' });
  assert.equal(f.state.fulfilled.length, 0);
});

test('webhook encaminha sessão paga para confirmação idempotente no banco', async () => {
  const f = fixtures();
  f.state.event = { type: 'checkout.session.async_payment_succeeded', livemode: false, data: { object: {
    id: 'cs_test_1', payment_status: 'paid', amount_total: 50, currency: 'brl', metadata: { purchase_id: 'purchase-1' }
  } } };
  await handleWebhook(Buffer.from('{}'), 'valid', { ...f, secret: 'whsec_test' });
  assert.deepEqual(f.state.fulfilled[0], { purchaseId: 'purchase-1', sessionId: 'cs_test_1', amount: 50, currency: 'brl' });
});

test('webhook confere assinatura real do Stripe sobre o corpo original', async () => {
  const Stripe = require('stripe');
  const stripe = new Stripe('sk_test_not_a_real_key');
  const f = fixtures();
  const payload = JSON.stringify({ type: 'checkout.session.completed', livemode: false, data: { object: {
    id: 'cs_test_1', payment_status: 'paid', amount_total: 50, currency: 'brl', metadata: { purchase_id: 'purchase-1' }
  } } });
  const secret = 'whsec_test_secret';
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  await handleWebhook(Buffer.from(payload), signature, { stripe, secret, store: f.store });
  assert.equal(f.state.fulfilled.length, 1);
  await assert.rejects(handleWebhook(Buffer.from(payload + ' '), signature, { stripe, secret, store: f.store }));
});

test('webhook rejeita eventos em modo de produção ou moeda diferente', async () => {
  const f = fixtures();
  const session = { id: 'cs_test_1', payment_status: 'paid', amount_total: 50, currency: 'brl', metadata: { purchase_id: 'purchase-1' } };
  f.state.event = { type: 'checkout.session.completed', livemode: true, data: { object: session } };
  await assert.rejects(handleWebhook(Buffer.from('{}'), 'valid', { ...f, secret: 'whsec_test' }));
  f.state.event.livemode = false;
  session.currency = 'usd';
  await assert.rejects(handleWebhook(Buffer.from('{}'), 'valid', { ...f, secret: 'whsec_test' }));
  assert.equal(f.state.fulfilled.length, 0);
});

const friendId = '00000000-0000-0000-0000-0000000000aa';
test('zoeira precisa de outra pessoa da sala e usa o preço do banco', async () => {
  const f = fixtures();
  f.store.item = async () => ({ id: 'chapeu', name: 'Chapéu de palhaço', price_cents: 99, active: true, target: 'member', duration_minutes: 1440 });
  f.store.isMemberOf = async () => true;
  const origin = 'https://example.com';
  await assert.rejects(createCheckout({ roomId, itemId: 'chapeu' }, { ...f, userId: 'user-1', origin }), ShopInputError);
  await assert.rejects(createCheckout({ roomId, itemId: 'chapeu', recipientId: 'user-1' }, { ...f, userId: 'user-1', origin }), ShopInputError);
  await createCheckout({ roomId, itemId: 'chapeu', recipientId: friendId, price: 1 }, { ...f, userId: 'user-1', origin });
  assert.equal(f.state.pending[0].recipient_id, friendId);
  assert.equal(f.state.pending[0].price_cents, 99);
  f.store.isMemberOf = async () => false;
  await assert.rejects(createCheckout({ roomId, itemId: 'chapeu', recipientId: friendId }, { ...f, userId: 'user-1', origin }), ShopInputError);
});

test('apelido exige texto curto e sem palavrão', async () => {
  const f = fixtures();
  f.store.item = async () => ({ id: 'apelido', name: 'Apelido forçado', price_cents: 99, active: true, target: 'member', duration_minutes: 60 });
  f.store.isMemberOf = async () => true;
  const base = { roomId, itemId: 'apelido', recipientId: friendId };
  const ctx = { ...f, userId: 'user-1', origin: 'https://example.com' };
  await assert.rejects(createCheckout({ ...base, text: '' }, ctx), ShopInputError);
  await assert.rejects(createCheckout({ ...base, text: 'x'.repeat(21) }, ctx), ShopInputError);
  await assert.rejects(createCheckout({ ...base, text: 'seu porra' }, ctx), ShopInputError);
  await createCheckout({ ...base, text: 'Pé-frio' }, ctx);
  assert.equal(f.state.pending[0].extra.text, 'Pé-frio');
});

test('item que fica seu não é comprado duas vezes, nem efeito já incluso no pacote', async () => {
  const f = fixtures();
  f.store.item = async () => ({ id: 'gol', name: '/gol', price_cents: 99, active: true, target: 'room', duration_minutes: null });
  const ctx = { ...f, userId: 'user-1', origin: 'https://example.com' };
  f.store.owns = async (_user, id) => id === 'gol';
  await assert.rejects(createCheckout({ roomId, itemId: 'gol' }, ctx), ShopInputError);
  f.store.owns = async (_user, id) => id === 'pacote-efeitos';
  await assert.rejects(createCheckout({ roomId, itemId: 'gol' }, ctx), ShopInputError);
  f.store.owns = async () => false;
  await createCheckout({ roomId, itemId: 'gol' }, ctx);
  assert.equal(f.state.sessions.length, 1);
});
