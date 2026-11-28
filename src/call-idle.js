// Saída automática da call: a LiveKit cobra minutos por pessoa conectada,
// então quem fica sozinho na call (aba esquecida, celular no bolso) sai depois de um tempo.
export const ALONE_LIMIT_MS = 5 * 60 * 1000;

// Recebe quando a pessoa ficou sozinha (ou null), quantos outros estão na call e o horário atual.
// Devolve o novo "sozinho desde" e se deve sair agora.
export function aloneTick(aloneSince, othersCount, now, limitMs = ALONE_LIMIT_MS) {
  if (othersCount > 0) return { aloneSince: null, leave: false };
  const since = aloneSince ?? now;
  return { aloneSince: since, leave: now - since >= limitMs };
}

// A LiveKit recusa a conexão com 429 quando a conta estoura os minutos do plano.
export function isQuotaError(message) {
  return /429|too many requests|minutes limit|limit exceeded|quota/i.test(String(message || ''));
}
