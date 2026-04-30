// services/megaSession.js
const { Storage } = require('megajs');

let megaStorage = null;

async function getMegaStorage() {
  if (megaStorage) return megaStorage;

  if (process.env.MEGA_SESSION) {
    try {
      const saved = JSON.parse(process.env.MEGA_SESSION);

      // Convert base64 strings back to Buffers
      saved.key = Buffer.from(saved.key, 'base64');
      if (saved.signKey) {
        saved.signKey = Buffer.from(saved.signKey, 'base64');
      }

      megaStorage = Storage.fromJSON(saved);
      await megaStorage.ready;
      console.log('✅ MEGA session restored from saved token');
      return megaStorage;
    } catch (err) {
      console.error('❌ Session restore failed, using fresh login:', err.message);
    }
  }

  megaStorage = new Storage({
    email: process.env.MEGA_EMAIL,
    password: process.env.MEGA_PASSWORD
  });
  await megaStorage.ready;
  console.log('✅ MEGA fresh login successful');

  // Export the full session – now includes password and email
  const sessionData = {
    email: process.env.MEGA_EMAIL,
    password: process.env.MEGA_PASSWORD,
    key: megaStorage.key.toString('base64'),
    sid: megaStorage.sid,
    signKey: megaStorage.signKey ? megaStorage.signKey.toString('base64') : undefined
  };
  console.log('MEGA_SESSION =', JSON.stringify(sessionData));
  return megaStorage;
}

module.exports = { getMegaStorage };
