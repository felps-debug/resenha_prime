const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('remoção do próprio usuário fecha a DM aberta e sai da call', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const subscribe = source.slice(source.indexOf('function subscribeMe()'), source.indexOf('// ---------- Notificações'));
  let handler, left = false, empty = false;
  const channel = { on(_type, filter, callback) { if (filter.table === 'room_members' && filter.event === 'DELETE') handler = callback; return this; }, subscribe() { return this; } };
  const dm = { id: 'dm-1', kind: 'dm' };
  const context = { sb: { channel: () => channel }, me: { id: 'user-1' }, meChannel: null, current: dm, rooms: [], dms: [dm], call: { roomId: dm.id },
    findChat: (id) => id === dm.id ? dm : undefined, isDm: (r) => r.kind !== 'room',
    leaveCall: () => { left = true; }, loadRooms: async () => { context.dms = []; },
    renderEmptyDm: () => { empty = true; }, toast() {}, loadMembers() {} };
  vm.runInNewContext(subscribe + '\nsubscribeMe();', context);
  await handler({ old: { room_id: dm.id, user_id: context.me.id } });
  assert.equal(left, true);
  assert.equal(empty, true);
});
