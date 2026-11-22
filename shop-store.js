'use strict';

function makeStore(admin, userDb) {
  async function result(query) {
    const { data, error } = await query;
    if (error) throw new Error('Não foi possível acessar a loja.');
    return data;
  }
  return {
    async isMember(roomId) {
      if (!userDb) return false;
      const data = await result(userDb.rpc('call_access', { p_room: roomId }));
      if (!Array.isArray(data) || !data.length) return false;
      return Boolean(await result(userDb.from('rooms').select('id').eq('id', roomId).eq('kind', 'room').maybeSingle()));
    },
    async item(id) { return result(admin.from('shop_items').select('id,name,price_cents,active').eq('id', id).maybeSingle()); },
    async createPending(row) { return (await result(admin.from('purchases').insert(row).select('id').single())).id; },
    async bindSession(id, session) { await result(admin.from('purchases').update({ stripe_session: session }).eq('id', id)); },
    async fulfill({ purchaseId, sessionId, amount, currency }) {
      await result(admin.rpc('fulfill_telao', { p_id: purchaseId, p_session: sessionId, p_amount: amount, p_currency: currency }));
    }
  };
}
module.exports = { makeStore };
