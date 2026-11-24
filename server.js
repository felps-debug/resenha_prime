// Resenha v2 — servidor
// - Serve o site (front-end compilado em public/dist)
// - Gera tokens do LiveKit só para membros da sala (checado no Supabase com o login da pessoa)
// - Executa expulsar/banir no banco e derruba a pessoa da call

const path = require('path');
require('dotenv').config({ quiet: true });
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const Stripe = require('stripe');
const { createCheckout, handleWebhook, ShopInputError } = require('./shop');
const { makeStore } = require('./shop-store');

const PORT = process.env.PORT || 3000;

// Valores públicos do projeto Supabase "Resenha.SouthAmerica" (a chave publicável pode ficar no front-end).
// O projeto antigo (bwcfciel...) deixou de existir; em 2026-11-21 o app foi apontado para este.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hxptmylcpbrqzlmixwga.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_R1XFgO_IjSDFewmIKAtrAw_WZGRg5f0';

// LiveKit Cloud: configure nas variáveis de ambiente do Vercel (Production e Preview).
const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
const livekitReady = Boolean(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);
const roomService = livekitReady
  ? new RoomServiceClient(LIVEKIT_URL.replace(/^ws/, 'http'), LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
  : null;

// A primeira versão da loja aceita exclusivamente credenciais de teste.
const stripeKey = process.env.STRIPE_SECRET_KEY || '';
const stripeSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
let shopOrigin = '';
try {
  const u = new URL(process.env.RESENHA_APP_URL || '');
  if (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) shopOrigin = u.origin;
} catch (_) {}
const shopReady = stripeKey.startsWith('sk_test_') && stripeSecret.startsWith('whsec_') && Boolean(serviceKey && shopOrigin);
const stripe = shopReady ? new Stripe(stripeKey) : null;
const shopAdmin = shopReady ? createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
// A assinatura do Stripe exige os bytes originais, antes do parser JSON.
app.post('/api/stripe-webhook', express.raw({ type: 'application/json', limit: '128kb' }), async (req, res) => {
  if (!shopReady) return res.status(503).json({ error: 'Loja ainda não configurada.' });
  try {
    await handleWebhook(req.body, req.get('stripe-signature'), { stripe, secret: stripeSecret, store: makeStore(shopAdmin) });
    res.json({ received: true });
  } catch (err) {
    if (err.type === 'StripeSignatureVerificationError') return res.status(400).json({ error: 'Assinatura inválida.' });
    console.error('stripe-webhook:', err.message);
    res.status(500).json({ error: 'Não foi possível processar o pagamento.' });
  }
});
app.use(express.json({ limit: '10kb' }));

// Cabeçalhos básicos de segurança
function connectionOrigins(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:', 'wss:', 'ws:'].includes(url.protocol)) return [];
    const counterpart = new URL(url.origin);
    counterpart.protocol = ({ 'https:': 'wss:', 'http:': 'ws:', 'wss:': 'https:', 'ws:': 'http:' })[url.protocol];
    return [url.origin, counterpart.origin];
  } catch (_) { return []; }
}
const connectSources = ["'self'", ...new Set([...connectionOrigins(SUPABASE_URL), ...connectionOrigins(LIVEKIT_URL)])].join(' ');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self)');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:", "media-src 'self' blob: https:", `connect-src ${connectSources}`,
    "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'"
  ].join('; '));
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});

// HTML, JS e CSS: o navegador sempre confere se tem versão nova (atualizações aparecem na hora).
// Ícones: podem ficar guardados por 1 dia.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (/^chunk-[A-Z0-9]+\.js$/.test(path.basename(filePath))) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    else if (/\.(html|js|css|json|map)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', 'public, max-age=86400');
  }
}));

app.get(['/health', '/api/health'], (req, res) => res.send('ok'));
app.get('/lista', (req, res) => res.sendFile(path.join(__dirname, 'public', 'lista.html')));

app.get(['/config', '/api/config'], (req, res) => {
  res.json({ supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_KEY, livekitUrl: LIVEKIT_URL, livekitReady, shopReady });
});

// ---------- Limite simples de requisições por IP ----------
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const entry = hits.get(key) || { count: 0, start: now };
    if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
    entry.count += 1;
    hits.set(key, entry);
    if (entry.count > max) return res.status(429).json({ error: 'Muitas tentativas. Espere um pouco.' });
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (now - v.start > 120000) hits.delete(k);
}, 60000).unref();

// ---------- Lista de testes (inscrição do beta) ----------
// Valida aqui e repassa para a planilha do Google (script em scripts/lista-planilha.gs).
const LISTA_URL = process.env.LISTA_SHEETS_URL || '';
const LISTA_TOKEN = process.env.LISTA_SHEETS_TOKEN || '';
app.post('/api/lista', rateLimit(5, 10 * 60000), async (req, res) => {
  const b = req.body || {};
  if (b.site) return res.json({ ok: true }); // armadilha para robô: humano não vê esse campo
  const nome = String(b.nome || '').trim().replace(/\s+/g, ' ');
  const insta = String(b.instagram || '').trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '').replace(/^@+/, '').toLowerCase();
  const idade = Number(b.idade);
  let zap = String(b.whatsapp || '').replace(/\D/g, '');
  if (zap.length <= 11) zap = '55' + zap;
  if (nome.length < 2 || nome.length > 60) return res.status(400).json({ error: 'Coloca seu nome.' });
  if (!/^[a-z0-9._]{1,30}$/.test(insta)) return res.status(400).json({ error: 'Confere o @ do Instagram.' });
  if (!Number.isInteger(idade) || idade < 12 || idade > 99) return res.status(400).json({ error: 'Confere sua idade.' });
  if (!/^55\d{10,11}$/.test(zap)) return res.status(400).json({ error: 'Confere o WhatsApp com DDD.' });
  if (!LISTA_URL || !LISTA_TOKEN) return res.status(503).json({ error: 'A lista ainda não abriu. Volta daqui a pouco.' });
  try {
    const r = await fetch(LISTA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: LISTA_TOKEN, nome, instagram: '@' + insta, idade, whatsapp: zap }),
      redirect: 'follow',
      signal: AbortSignal.timeout(12000)
    });
    const j = await r.json().catch(() => null);
    if (!j || !j.ok) throw new Error((j && j.error) || `resposta ${r.status}`);
    res.json({ ok: true, repetido: Boolean(j.repetido), posicao: Number(j.posicao) || null });
  } catch (err) {
    console.error('lista:', err.message);
    res.status(502).json({ error: 'Não deu pra salvar agora. Tenta de novo em 1 minuto.' });
  }
});

// ---------- Autenticação via Supabase ----------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getUser(req) {
  const header = req.get('authorization') || '';
  const jwt = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!jwt) return null;
  const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data || !data.user) return null;
  return { user: data.user, db };
}

function requireLivekit(res) {
  if (livekitReady) return true;
  res.status(503).json({ error: 'A call ainda não foi configurada (faltam as chaves do LiveKit no servidor).' });
  return false;
}

app.post('/api/checkout', rateLimit(20, 60000), async (req, res) => {
  if (!shopReady) return res.status(503).json({ error: 'Loja ainda não configurada.' });
  try {
    const auth = await getUser(req);
    if (!auth) return res.status(401).json({ error: 'Faça login de novo.' });
    const result = await createCheckout(req.body || {}, { userId: auth.user.id, store: makeStore(shopAdmin, auth.db), stripe, origin: shopOrigin });
    res.json(result);
  } catch (err) {
    if (err instanceof ShopInputError) return res.status(400).json({ error: err.message });
    console.error('checkout:', err.type || err.name);
    res.status(500).json({ error: 'Não foi possível iniciar a compra agora.' });
  }
});

// Token para entrar na call
app.post('/api/livekit-token', rateLimit(30, 60000), async (req, res) => {
  try {
    if (!requireLivekit(res)) return;
    const roomId = String((req.body && req.body.roomId) || '');
    if (!UUID.test(roomId)) return res.status(400).json({ error: 'Sala inválida.' });
    const auth = await getUser(req);
    if (!auth) return res.status(401).json({ error: 'Faça login de novo.' });

    const { data, error } = await auth.db.rpc('call_access', { p_room: roomId });
    if (error) throw error;
    const access = Array.isArray(data) ? data[0] : null;
    if (!access) return res.status(403).json({ error: 'Você não é membro desta sala.' });

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: auth.user.id,
      name: access.display_name,
      ttl: '6h',
      metadata: JSON.stringify({ role: access.base_role })
    });
    at.addGrant({
      roomJoin: true,
      room: roomId,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: true
    });
    res.json({ token: await at.toJwt(), url: LIVEKIT_URL });
  } catch (err) {
    console.error('livekit-token', err);
    res.status(500).json({ error: 'Não foi possível entrar na call agora.' });
  }
});

// Quem está na call agora (para mostrar antes de entrar)
app.get('/api/call-participants', rateLimit(60, 60000), async (req, res) => {
  try {
    if (!livekitReady) return res.json({ participants: [] });
    const roomId = String(req.query.roomId || '');
    if (!UUID.test(roomId)) return res.status(400).json({ error: 'Sala inválida.' });
    const auth = await getUser(req);
    if (!auth) return res.status(401).json({ error: 'Faça login de novo.' });
    const { data } = await auth.db.rpc('call_access', { p_room: roomId });
    if (!Array.isArray(data) || !data.length) return res.status(403).json({ error: 'Você não é membro desta sala.' });
    let list = [];
    try { list = await roomService.listParticipants(roomId); } catch (_) { list = []; }
    res.json({ participants: list.map((p) => ({ identity: p.identity, name: p.name })) });
  } catch (err) {
    console.error('call-participants', err);
    res.status(500).json({ error: 'Erro ao listar a call.' });
  }
});

// Expulsar ou banir: a permissão é checada no banco (RPC); depois derruba da call.
app.post('/api/moderate', rateLimit(30, 60000), async (req, res) => {
  try {
    const { roomId, userId, action, reason } = req.body || {};
    if (!UUID.test(String(roomId)) || !UUID.test(String(userId))) return res.status(400).json({ error: 'Dados inválidos.' });
    if (!['kick', 'ban'].includes(action)) return res.status(400).json({ error: 'Ação inválida.' });
    const auth = await getUser(req);
    if (!auth) return res.status(401).json({ error: 'Faça login de novo.' });

    const rpc = action === 'kick'
      ? auth.db.rpc('kick_member', { p_room: roomId, p_user: userId })
      : auth.db.rpc('ban_member', { p_room: roomId, p_user: userId, p_reason: reason ? String(reason).slice(0, 200) : null });
    const { error } = await rpc;
    if (error) return res.status(403).json({ error: error.message });

    if (roomService) {
      try { await roomService.removeParticipant(roomId, userId); } catch (_) { /* não estava na call */ }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('moderate', err);
    res.status(500).json({ error: 'Não foi possível concluir a ação.' });
  }
});

// Prévia de post do X/Twitter (texto público via oEmbed oficial). Só para quem está logado.
const TWEET_URL = /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,25})/i;
const previewCache = new Map();
function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}
app.get('/api/link-preview', rateLimit(60, 60000), async (req, res) => {
  try {
    const raw = String(req.query.url || '').replace(/^http:/i, 'https:');
    const m = raw.match(TWEET_URL);
    if (!m) return res.status(400).json({ error: 'Link não suportado.' });
    const auth = await getUser(req);
    if (!auth) return res.status(401).json({ error: 'Faça login de novo.' });
    const url = `https://twitter.com/${m[1]}/status/${m[2]}`;
    const hit = previewCache.get(url);
    if (hit && Date.now() - hit.at < 3600 * 1000) return res.json(hit.data);
    const r = await fetch(`https://publish.twitter.com/oembed?omit_script=1&dnt=true&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return res.status(404).json({ error: 'Post não encontrado.' });
    const j = await r.json();
    const html = String(j.html || '');
    const p = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const text = p ? decodeEntities(p[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim() : '';
    const dates = [...html.matchAll(/<a[^>]*>([^<]*)<\/a>/gi)].map((x) => x[1]);
    const data = { author: String(j.author_name || m[1]).slice(0, 60), handle: m[1], text: text.slice(0, 600), date: decodeEntities(dates[dates.length - 1] || '') };
    previewCache.set(url, { at: Date.now(), data });
    if (previewCache.size > 500) previewCache.delete(previewCache.keys().next().value);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Não deu pra carregar o post.' });
  }
});

// Qualquer outra rota volta para o app (links de convite etc.)
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

function start() {
  app.listen(PORT, () => {
    console.log(`Resenha rodando em http://localhost:${PORT}`);
    if (!livekitReady) console.log('Aviso: LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET não configurados — a call fica desativada.');
  });
}

module.exports = app;
if (require.main === module) start();
