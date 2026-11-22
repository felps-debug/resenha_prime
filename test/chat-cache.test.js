const { test } = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory } = require('fake-indexeddb');
const { createChatCache } = require('../src/chat-cache');

test('cache separa contas e salas e guarda somente as 50 mensagens mais recentes', async () => {
  const db = new IDBFactory();
  const first = createChatCache(db, 'user-a');
  const second = createChatCache(db, 'user-b');
  const messages = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, room_id: 'room-a', user_id: 'user-a', content: `msg ${i}` }));
  await first.write('room-a', messages);
  const saved = await first.read('room-a');
  assert.equal(saved.length, 50);
  assert.equal(saved[0].id, 11);
  assert.equal(await first.read('room-b'), null);
  assert.equal(await second.read('room-a'), null);
});

test('cache expira e descarta registros de outras salas', async () => {
  const db = new IDBFactory();
  let now = 1_000_000;
  const cache = createChatCache(db, 'user-a', { now: () => now });
  await cache.write('room-a', [{ id: 1, room_id: 'room-a', content: 'ok' }, { id: 2, room_id: 'room-b', content: 'errada' }]);
  assert.equal((await cache.read('room-a')).length, 1);
  now += 12 * 60 * 60 * 1000 + 1;
  assert.equal(await cache.read('room-a'), null);
  const database = await new Promise((resolve, reject) => { const request = db.open('resenha-chat-cache-v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
  const rows = await new Promise((resolve, reject) => { const request = database.transaction('rooms').objectStore('rooms').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
  assert.equal(rows.length, 0, 'Cache expirado precisa ser removido do disco.');
});

test('cache limita a quantidade de salas por conta e suporta armazenamento indisponível', async () => {
  const db = new IDBFactory();
  let now = 1;
  const cache = createChatCache(db, 'user-a', { now: () => now++ });
  for (let i = 0; i < 11; i++) await cache.write(`room-${i}`, [{ id: i, room_id: `room-${i}`, content: 'ok' }]);
  assert.equal(await cache.read('room-0'), null);
  assert.equal((await cache.read('room-10')).length, 1);
  const unavailable = createChatCache(null, 'user-a');
  assert.equal(await unavailable.read('room-a'), null);
  assert.equal(await unavailable.write('room-a', []), false);
});

test('mensagens recebidas atualizam o cache sem duplicação ou perda em operações simultâneas', async () => {
  const cache = createChatCache(new IDBFactory(), 'user-a');
  await cache.write('room-a', [{ id: 1, room_id: 'room-a', content: 'primeira' }]);
  const second = { id: 2, room_id: 'room-a', content: 'segunda' };
  await Promise.all([cache.append('room-a', second), cache.append('room-a', second), cache.append('room-a', { id: 3, room_id: 'room-a', content: 'terceira' })]);
  assert.deepEqual((await cache.read('room-a')).map((m) => m.id), [1, 2, 3]);
});

test('mensagem apagada é removida do cache sem tocar no cache de outra conta', async () => {
  const db = new IDBFactory();
  const first = createChatCache(db, 'user-a');
  const second = createChatCache(db, 'user-b');
  const message = { id: 7, room_id: 'room-a', content: 'apagada' };
  await first.write('room-a', [message]);
  await second.write('room-a', [message]);
  await first.removeMessage(7);
  assert.equal((await first.read('room-a')).length, 0);
  assert.equal((await second.read('room-a')).length, 1);
});

test('prévia de salas é por conta e não salva códigos de convite', async () => {
  const db = new IDBFactory();
  const first = createChatCache(db, 'user-a');
  const second = createChatCache(db, 'user-b');
  await first.writeRooms([{ id: 'room-a', name: 'Sala', kind: 'room', invite_code: 'segredo' }]);
  assert.deepEqual(await first.readRooms(), [{ id: 'room-a', name: 'Sala', kind: 'room' }]);
  assert.equal(await second.readRooms(), null);
});
