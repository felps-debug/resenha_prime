const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('uma consulta atrasada não desenha mensagens na sala que foi aberta depois', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const code = source.slice(source.indexOf('async function loadMessages('), source.indexOf('async function ensureNames('));
  let resume;
  const wait = new Promise((resolve) => { resume = resolve; });
  let rendered = false;
  const query = { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return Promise.resolve({ data: [{ id: 1, user_id: 'u', content: '' }] }); } };
  const context = { current: { id: 'a' }, roomRevision: 1, chatCache: null, sb: { from: () => query }, MSG_FIELDS: '', MENTION_RE: /never/g,
    ensureNames: () => wait, $: () => { rendered = true; assert.fail('A consulta antiga tentou atualizar a tela.'); } };
  vm.runInNewContext(code, context);
  const loading = context.loadMessages(true);
  await new Promise((resolve) => setImmediate(resolve));
  context.current = { id: 'b' };
  resume();
  await loading;
  assert.equal(rendered, false);
});

test('uma abertura atrasada não substitui a assinatura da conversa atual', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const code = source.slice(source.indexOf('async function openRoom('), source.indexOf('async function loadMembers('));
  let resume;
  const wait = new Promise((resolve) => { resume = resolve; });
  const chats = [{ id: 'a', kind: 'dm' }, { id: 'b', kind: 'dm' }];
  const subscribed = [];
  const element = { classList: { toggle() {}, add() {} }, replaceChildren() {} };
  const context = { findChat: (id) => chats.find((c) => c.id === id), current: null, roomRevision: 0, textDrafts: new Map(), switchImageDraft() {}, pinnedIds: new Set(), loadPins() {}, cfg: { shopReady: false }, clearReply() {}, typing: new Map(), renderTyping() {},
    isDm: () => true, mode: 'dms', localStorage: { setItem() {} }, $: () => element, dmTitle: () => 'Pessoa',
    h: () => ({}), renderRail() {}, renderDmList() {}, loadMembers: () => wait, loadMessages: () => wait,
    subscribeRoom: (id) => subscribed.push(id), startPreviewPolling() {}, setView() {}, onCallChange() {}, call: {} };
  vm.runInNewContext(code, context);
  const first = context.openRoom('a');
  const second = context.openRoom('b');
  resume();
  await Promise.all([first, second]);
  assert.deepEqual(subscribed, ['b']);
});

test('carregamento atrasado da conversa não altera a visão escolhida depois', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const code = source.slice(source.indexOf('async function openRoom('), source.indexOf('async function loadMembers('));
  let resume;
  const wait = new Promise((resolve) => { resume = resolve; });
  const views = [];
  const element = { classList: { toggle() {}, add() {} } };
  const context = { findChat: () => ({ id: 'a', kind: 'dm' }), current: null, roomRevision: 0, textDrafts: new Map(), switchImageDraft() {}, pinnedIds: new Set(), loadPins() {}, cfg: { shopReady: false }, clearReply() {}, typing: new Map(), renderTyping() {},
    isDm: () => true, mode: 'dms', localStorage: { setItem() {} }, $: () => element, dmTitle: () => 'Pessoa',
    renderRail() {}, renderDmList() {}, loadMembers: () => wait, loadMessages: () => wait,
    subscribeRoom() {}, startPreviewPolling() {}, setView: (v) => views.push(v), onCallChange() {}, call: {} };
  vm.runInNewContext(code, context);
  const opening = context.openRoom('a');
  context.setView('call');
  resume();
  await opening;
  assert.deepEqual(views, ['chat', 'call']);
});

test('mensagem recebida para outra conversa não aparece no chat aberto', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const code = source.slice(source.indexOf('async function appendMessage('), source.indexOf('let pendingImage ='));
  const context = { current: { id: 'b' }, chatCache: null, document: { querySelector: () => null }, MENTION_RE: /never/g,
    ensureNames: async () => {}, $: () => assert.fail('A mensagem foi inserida na conversa errada.') };
  vm.runInNewContext(code, context);
  await context.appendMessage({ id: 1, room_id: 'a', user_id: 'u', content: '' }, true);
});

test('abre o cache antes de a consulta de mensagens terminar', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const code = source.slice(source.indexOf('async function loadMessages('), source.indexOf('async function ensureNames('));
  let finish;
  const remote = new Promise((resolve) => { finish = resolve; });
  const query = { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return remote; } };
  let cachedRoom;
  const context = { current: { id: 'a' }, roomRevision: 1, chatCache: { read: async () => [{ id: 1, room_id: 'a' }] },
    renderCachedMessages: async (_items, room) => { cachedRoom = room; }, sb: { from: () => query }, MSG_FIELDS: '' };
  vm.runInNewContext(code, context);
  const loading = context.loadMessages(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cachedRoom, 'a');
  finish({ error: 'offline' });
  await loading;
});

test('resposta antiga não sobrescreve a mesma conversa após sair e voltar', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const code = source.slice(source.indexOf('async function loadMessages('), source.indexOf('async function ensureNames('));
  let finish;
  const remote = new Promise((resolve) => { finish = resolve; });
  const query = { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return remote; } };
  const context = { current: { id: 'a' }, roomRevision: 1, chatCache: null, sb: { from: () => query }, MSG_FIELDS: '', MENTION_RE: /never/g,
    ensureNames: () => assert.fail('A resposta de uma abertura anterior não deve ser desenhada.') };
  vm.runInNewContext(code, context);
  const loading = context.loadMessages(true);
  context.current = { id: 'a' };
  context.roomRevision = 3;
  finish({ data: [{ id: 1, user_id: 'u', content: '' }] });
  await loading;
});

test('troca de sala limpa mensagens e membros anteriores imediatamente', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const code = source.slice(source.indexOf('async function openRoom('), source.indexOf('async function loadMembers('));
  let resume;
  const wait = new Promise((resolve) => { resume = resolve; });
  const cleared = [];
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { value: '', classList: { toggle() {}, add() {} }, replaceChildren() { cleared.push(id); } });
    return elements.get(id);
  };
  const context = { findChat: () => ({ id: 'b', kind: 'room', name: 'B' }), current: { id: 'a' }, roomRevision: 0,
    members: [{ user_id: 'old' }], roles: [{ id: 'old' }], callPreview: [{ identity: 'old' }],
    textDrafts: new Map(), switchImageDraft() {}, pinnedIds: new Set(), loadPins() {}, cfg: { shopReady: false },
    clearReply() {}, typing: new Map(), renderTyping() {}, isDm: () => false, mode: 'rooms',
    localStorage: { setItem() {} }, $: element, h: () => ({}), renderRail() {}, renderDmList() {},
    loadMembers: () => wait, loadMessages: () => wait, subscribeRoom() {}, startPreviewPolling() {}, setView() {}, onCallChange() {}, call: {} };
  vm.runInNewContext(code, context);
  const opening = context.openRoom('b');
  assert.equal(context.members.length, 0);
  assert.equal(context.roles.length, 0);
  assert.ok(cleared.includes('messages'));
  resume();
  await opening;
});
