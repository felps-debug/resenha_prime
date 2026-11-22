function moveFocus(keys, current, direction) {
  if (!Array.isArray(keys) || !keys.length) return null;
  const index = keys.indexOf(current);
  const start = index < 0 ? (direction < 0 ? 0 : -1) : index;
  return keys[(start + (direction < 0 ? -1 : 1) + keys.length) % keys.length];
}

module.exports = { moveFocus };
