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
    async item(id) { return result(admin.from('shop_items').select('id,name,price_cents,active,target,duration_minutes').eq('id', id).maybeSingle()); },
    async owns(userId, itemId) {
      const rows = await result(admin.from('purchases').select('id,expires_at').eq('buyer_id', userId).eq('item_id', itemId).eq('status', 'paid').limit(5));
      return (rows || []).some((r) => !r.expires_at || new Date(r.expires_at) > new Date());
    },
    async isMemberOf(roomId, userId) {
      return Boolean(await result(admin.from('room_members').select('user_id').eq('room_id', roomId).eq('user_id', userId).maybeSingle()));
    },
    async createPending(row) { return (await result(admin.from('purchases').insert(row).select('id').single())).id; },
    async bindSession(id, session) { await result(admin.from('purchases').update({ stripe_session: session }).eq('id', id)); },
    async fulfill({ purchaseId, sessionId, amount, currency }) {
      await result(admin.rpc('fulfill_purchase', { p_id: purchaseId, p_session: sessionId, p_amount: amount, p_currency: currency }));
    }
  };
}
module.exports = { makeStore };
