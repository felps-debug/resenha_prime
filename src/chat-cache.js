'use strict';

const TTL = 12 * 60 * 60 * 1000;
const MAX_ROOMS = 10;
const MAX_MESSAGES = 50;
const MAX_ROOM_CHARS = 128 * 1024;
const FIELDS = ['id', 'room_id', 'user_id', 'content', 'created_at', 'attachment_path', 'attachment_type', 'kind', 'payload', 'reply_to'];

function createChatCache(indexedDB, owner, options = {}) {
  const now = options.now || Date.now;
  let opening;
  function db() {
    if (!indexedDB || !owner) return Promise.resolve(null);
    if (!opening) opening = new Promise((resolve) => {
      try {
        const request = indexedDB.open('resenha-chat-cache-v1', 1);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore('rooms', { keyPath: 'key' });
          store.createIndex('owner', 'owner');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = request.onblocked = () => resolve(null);
      } catch (_) { resolve(null); }
    });
    return opening;
  }
  const key = (room) => JSON.stringify([owner, room]);
  return {
    async removeMessage(id) {
      const connection = await db();
      if (!connection || id == null) return false;
      return new Promise((resolve) => {
        try {
          const tx = connection.transaction('rooms', 'readwrite');
          const store = tx.objectStore('rooms');
          const request = store.index('owner').getAll(owner);
          request.onsuccess = () => {
            for (const record of request.result) {
              if (!Array.isArray(record.messages)) continue;
              const keep = record.messages.filter((m) => String(m.id) !== String(id));
              if (keep.length !== record.messages.length) { record.messages = keep; store.put(record); }
            }
          };
          tx.oncomplete = () => resolve(true);
          tx.onerror = tx.onabort = () => resolve(false);
        } catch (_) { resolve(false); }
      });
    },
    async read(room) {
      const connection = await db();
      if (!connection) return null;
      return new Promise((resolve) => {
        try {
          const tx = connection.transaction('rooms', 'readwrite');
          const store = tx.objectStore('rooms');
          const request = store.get(key(room));
          let value = null;
          request.onsuccess = () => {
            const record = request.result;
            if (record && record.expires <= now()) store.delete(record.key);
            else if (record && Array.isArray(record.messages)) value = record.messages;
          };
          tx.oncomplete = () => resolve(value);
          tx.onerror = tx.onabort = () => resolve(null);
        } catch (_) { resolve(null); }
      });
    },
    async readRooms() {
      const connection = await db();
      if (!connection) return null;
      return new Promise((resolve) => {
        try {
          const tx = connection.transaction('rooms', 'readwrite');
          const store = tx.objectStore('rooms');
          const request = store.get(key(null));
          let value = null;
          request.onsuccess = () => {
            const record = request.result;
            if (record && record.expires <= now()) store.delete(record.key);
            else if (record && Array.isArray(record.rooms)) value = record.rooms;
          };
          tx.oncomplete = () => resolve(value);
          tx.onerror = tx.onabort = () => resolve(null);
        } catch (_) { resolve(null); }
      });
    },
    async writeRooms(rooms) {
      const connection = await db();
      if (!connection || !Array.isArray(rooms)) return false;
      const clean = rooms.filter((r) => r && typeof r.id === 'string' && typeof r.name === 'string').slice(0, 100)
        .map((r) => ({ id: r.id, name: r.name.slice(0, 100), kind: r.kind || 'room' }));
      return new Promise((resolve) => {
        try {
          const tx = connection.transaction('rooms', 'readwrite');
          const timestamp = now();
          tx.objectStore('rooms').put({ key: key(null), owner, updated: timestamp, expires: timestamp + TTL, rooms: clean });
          tx.oncomplete = () => resolve(true);
          tx.onerror = tx.onabort = () => resolve(false);
        } catch (_) { resolve(false); }
      });
    },
    async append(room, message) {
      const connection = await db();
      if (!connection || !room || !message || message.room_id !== room || message.id == null) return false;
      try {
        const clean = {};
        for (const field of FIELDS) if (message[field] !== undefined) clean[field] = message[field];
        return await new Promise((resolve) => {
          const tx = connection.transaction('rooms', 'readwrite');
          const store = tx.objectStore('rooms');
          let updated = false;
          const request = store.get(key(room));
          request.onsuccess = () => {
            const record = request.result;
            if (!record || record.expires <= now() || !Array.isArray(record.messages)) return;
            record.messages = record.messages.filter((m) => m.id !== clean.id);
            record.messages.push(clean);
            record.messages = record.messages.slice(-MAX_MESSAGES);
            while (record.messages.length && JSON.stringify(record.messages).length > MAX_ROOM_CHARS) record.messages.shift();
            record.updated = now();
            record.expires = record.updated + TTL;
            store.put(record);
            updated = true;
          };
          tx.oncomplete = () => resolve(updated);
          tx.onerror = tx.onabort = () => resolve(false);
        });
      } catch (_) { return false; }
    },
    async write(room, messages) {
      const connection = await db();
      if (!connection || !room || !Array.isArray(messages)) return false;
      try {
        const clean = messages.filter((m) => m && m.room_id === room).slice(-MAX_MESSAGES).map((m) => {
          const result = {};
          for (const field of FIELDS) if (m[field] !== undefined) result[field] = m[field];
          return result;
        });
        while (clean.length && JSON.stringify(clean).length > MAX_ROOM_CHARS) clean.shift();
        return await new Promise((resolve) => {
          const tx = connection.transaction('rooms', 'readwrite');
          const store = tx.objectStore('rooms');
          const timestamp = now();
          const currentKey = key(room);
          store.put({ key: currentKey, owner, updated: timestamp, expires: timestamp + TTL, messages: clean });
          const request = store.index('owner').getAll(owner);
          request.onsuccess = () => {
            for (const old of request.result) if (old.key !== currentKey && old.expires <= timestamp) store.delete(old.key);
            const records = request.result.filter((r) => r.key !== currentKey && r.expires > timestamp && Array.isArray(r.messages)).sort((a, b) => b.updated - a.updated);
            for (const stale of records.slice(MAX_ROOMS - 1)) store.delete(stale.key);
          };
          tx.oncomplete = () => resolve(true);
          tx.onerror = tx.onabort = () => resolve(false);
        });
      } catch (_) { return false; }
    }
  };
}

module.exports = { createChatCache };
