// services/megaSession.js
const { Storage } = require('megajs');

let megaStorage = null;

async function getMegaStorage() {
  if (megaStorage) return megaStorage;

  // If a saved session exists, restore it
  if (process.env.MEGA_SESSION) {
    try {
      megaStorage = Storage.fromJSON(JSON.parse(process.env.MEGA_SESSION));
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
//  console.log('✅ MEGA fresh login successful');
  return megaStorage;
}

module.exports = { getMegaStorage };
