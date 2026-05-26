// services/megaSession.js
const { Storage } = require('megajs');

let megaStorage = null;

async function getMegaStorage() {
    if (megaStorage) return megaStorage;

    const restoreOrCreate = async () => {
        if (process.env.MEGA_SESSION) {
            try {
                const saved = JSON.parse(process.env.MEGA_SESSION);
                saved.key = Buffer.from(saved.key, 'base64');
                const storage = Storage.fromJSON(saved);
                await storage.ready;
                return storage;
            } catch (err) {}
        }

        const storage = new Storage({
            email: process.env.MEGA_EMAIL,
            password: process.env.MEGA_PASSWORD
        });
        await storage.ready;
        return storage;
    };

    // 30-second timeout
    megaStorage = await Promise.race([
        restoreOrCreate(),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('MEGA session timeout')), 30000)
        )
    ]);

    return megaStorage;
}

module.exports = { getMegaStorage };
