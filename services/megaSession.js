// services/megaSession.js
const { Storage } = require('megajs');

let megaStorage = null;

async function getMegaStorage() {
  if (megaStorage) return megaStorage;

  // If a saved session exists, restore it
  if (process.env.MEGA_SESSION) {
    try {
      const saved = JSON.parse(process.env.MEGA_SESSION);

      // Convert the base64 key back to a Buffer
      if (typeof saved.key === 'string') {
        saved.key = Buffer.from(saved.key, 'base64');
      } else if (saved.key && saved.key.type === 'Buffer') {
        // fallback for old format
        saved.key = Buffer.from(saved.key.data);
      }

      megaStorage = Storage.fromJSON(saved);
      await megaStorage.ready;
      console.log('✅ MEGA session restored from saved token');
      return megaStorage;
    } catch (err) {
      console.error('❌ Restored session invalid, trying fresh login...');
    }
  }

  // Fresh login (fallback)
  megaStorage = new Storage({
    email: process.env.MEGA_EMAIL,
    password: process.env.MEGA_PASSWORD
  });
  await megaStorage.ready;
  console.log('✅ MEGA fresh login successful');

  // --- TEMPORARY: Export the session for permanent storage ---
  const sessionData = {
    key: megaStorage.key.toString('base64'),  // store as base64 string
    sid: megaStorage.sid,
    password: megaStorage.password
  };
  console.log('MEGA_SESSION =', JSON.stringify(sessionData));
  // --- END TEMPORARY ---

  return megaStorage;
}

module.exports = { getMegaStorage };
