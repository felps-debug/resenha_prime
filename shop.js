'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BLOCKED_WORDS = /\b(?:caralho|porra|puta|viado|buceta|arrombado)\b/i;
class ShopInputError extends Error {}

async function createCheckout(input, { userId, store, stripe, origin }) {
  const roomId = String(input.roomId || '');
  const text = String(input.text || '').trim();
  if (!UUID.test(roomId) || !text || Array.from(text).length > 40 || /[\u0000-\u001f\u007f]/.test(text)) throw new ShopInputError('Informe uma sala e um texto de até 40 caracteres.');
  if (BLOCKED_WORDS.test(text.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) throw new ShopInputError('Escolha um texto sem palavrões.');
  if (!(await store.isMember(roomId, userId))) throw new ShopInputError('Você precisa fazer parte da sala.');
  const item = await store.item('telao');
  if (!item || !item.active || !Number.isInteger(item.price_cents) || item.price_cents < 50) throw new ShopInputError('Este item está indisponível.');
  const purchaseId = await store.createPending({ buyer_id: userId, recipient_id: userId, room_id: roomId, item_id: item.id, price_cents: item.price_cents, extra: { text } });
  const session = await stripe.checkout.sessions.create({
    mode: 'payment', payment_method_types: ['card', 'pix'],
    line_items: [{ price_data: { currency: 'brl', product_data: { name: item.name }, unit_amount: item.price_cents }, quantity: 1 }],
    metadata: { purchase_id: purchaseId },
    success_url: `${origin}/?loja=ok`, cancel_url: `${origin}/?loja=cancelado`
  });
  await store.bindSession(purchaseId, session.id);
  return { url: session.url };
}

async function handleWebhook(raw, signature, { stripe, secret, store }) {
  const event = stripe.webhooks.constructEvent(raw, signature, secret);
  if (event.livemode) throw new Error('Evento de produção não permitido.');
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return;
  const session = event.data.object;
  if (session.payment_status !== 'paid') return;
  if (!session.metadata?.purchase_id || !session.id || session.currency !== 'brl' || !Number.isInteger(session.amount_total)) throw new Error('Sessão inválida.');
  await store.fulfill({ purchaseId: session.metadata.purchase_id, sessionId: session.id, amount: session.amount_total, currency: session.currency });
}

module.exports = { createCheckout, handleWebhook, ShopInputError };
