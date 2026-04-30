// services/megaSession.js
const { Storage } = require('megajs');

let megaStorage = null;

async function getMegaStorage() {
  if (megaStorage) return megaStorage;

  if (process.env.MEGA_SESSION) {
    try {
      const saved = JSON.parse(process.env.MEGA_SESSION);
      saved.key = Buffer.from(saved.key, 'base64');
      megaStorage = Storage.fromJSON(saved);
      await megaStorage.ready;
 //     console.log('✅ MEGA session restored from saved token');
      return megaStorage;
    } catch (err) {
//      console.error('❌ Restore failed, using fresh login:', err.message);
    }
  }

  megaStorage = new Storage({
    email: process.env.MEGA_EMAIL,
    password: process.env.MEGA_PASSWORD
  });
  await megaStorage.ready;
//  console.log('✅ MEGA fresh login successful');
  return megaStorage;
}

module.exports = { getMegaStorage };
