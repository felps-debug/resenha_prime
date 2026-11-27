const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('ao conectar ao Coworking, o cabeçalho e a barra identificam o canal', () => {
  const source = fs.readFileSync('src/main.js', 'utf8');
  const code = source.slice(source.indexOf('function onCallChange()'), source.indexOf('function moveStageFocus('));
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', hidden: false, className: '', classList: { toggle() {} }, append() {}, setAttribute() {} });
    return elements.get(id);
  };
  const context = { $, call: { room: { state: 'connected', localParticipant: {} }, roomId: 'sala', roomName: 'Builders Community · Coworking', channelId: 'coworking', channelName: 'Coworking', serverName: 'Builders Community', muted: false, deafened: false }, current: { id: 'sala' }, view: 'call', channels: [], ICON: {}, setBtn() {}, paintMeSub() {}, h() {}, setModerator() {}, can() { return false; }, musicJoin() {}, applyAct() {}, paintCallTools() {}, participants() { return []; }, renderCallList() {}, renderCallEmpty() {}, renderStage() {}, renderRail() {}, isDm() { return false; } };
  vm.runInNewContext(code, context);
  context.onCallChange();
  assert.equal($('top-title').textContent, 'Coworking');
  assert.equal($('vb-sub').textContent, 'Coworking / Builders Community');
});
