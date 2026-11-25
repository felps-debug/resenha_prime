// Quem pode disparar cada golpe de zoeira.
// A identidade na call é o id da conta, assinado pelo servidor no token do LiveKit,
// então quem recebe consegue conferir quem mandou.
const EXCLUSIVE = { agua: 'a1f01f98-f831-46e9-90ac-a4e84276c600' };

export function canZoeira(kind, identity) {
  return !Object.hasOwn(EXCLUSIVE, kind) || EXCLUSIVE[kind] === identity;
}
