// services/megaSession.js
const { Storage } = require('megajs');

let megaStorage = null;

async function getMegaStorage() {
  if (megaStorage) return megaStorage;

  if (process.env.MEGA_SESSION) {
    try {
      const saved = JSON.parse(process.env.MEGA_SESSION);

      // Convert base64 strings back to Buffers
      if (typeof saved.key === 'string') {
        saved.key = Buffer.from(saved.key, 'base64');
      }
      if (typeof saved.signKey === 'string') {
        saved.signKey = Buffer.from(saved.signKey, 'base64');
      }

      megaStorage = Storage.fromJSON(saved);
      await megaStorage.ready;
      console.log('✅ MEGA session restored from saved token');
      return megaStorage;
    } catch (err) {
      // Show the actual megajs error
      console.error('❌ Session restore failed:', err.message);
      console.error('Full error:', err);
    }
  }

  // Fresh login
  megaStorage = new Storage({
    email: process.env.MEGA_EMAIL,
    password: process.env.MEGA_PASSWORD
  });
  await megaStorage.ready;
  console.log('✅ MEGA fresh login successful');

  // Export the session exactly as megajs expects
  const sessionData = {
    key: megaStorage.key.toString('base64'),
    sid: megaStorage.sid,
    password: megaStorage.password,
    signKey: megaStorage.signKey ? megaStorage.signKey.toString('base64') : undefined
  };
  console.log('MEGA_SESSION =', JSON.stringify(sessionData));

  return megaStorage;
}

module.exports = { getMegaStorage };
