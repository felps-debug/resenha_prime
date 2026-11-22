const { test } = require('node:test');
const assert = require('node:assert/strict');
const { moveFocus } = require('../src/focus-navigation');

test('navegação das transmissões avança e volta de forma circular', () => {
  const screens = ['ana:screen', 'bia:screen', 'caio:screen'];
  assert.equal(moveFocus(screens, 'ana:screen', 1), 'bia:screen');
  assert.equal(moveFocus(screens, 'ana:screen', -1), 'caio:screen');
  assert.equal(moveFocus(screens, 'desconhecida:screen', 1), 'ana:screen');
});

test('navegação sem telas compartilhadas não escolhe foco', () => {
  assert.equal(moveFocus([], null, 1), null);
});
