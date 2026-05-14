// handlers/channelCleaner.js
const helpers = require('../utils/helpers');

/**
 * Generic channel cleaner: after a period of no messages, delete all non‑whitelisted messages.
 * @param {Client} client - Discord.js client
 * @param {string} channelId - ID of the channel to monitor
 * @param {string[]} whitelistIds - Array of message IDs that will never be deleted
 * @param {number} inactivityMs - Milliseconds of no messages before a purge (default 5 minutes)
 */
function initChannelCleaner(client, channelId, whitelistIds = [], inactivityMs = 5 * 60 * 1000) {
    let inactivityTimeout = null;

    const resetTimer = (channel) => {
        if (inactivityTimeout) clearTimeout(inactivityTimeout);
        inactivityTimeout = setTimeout(async () => {
            try {
                const messages = await channel.messages.fetch({ limit: 100 });
                const toDelete = messages.filter(m => !whitelistIds.includes(m.id));
                if (toDelete.size === 0) return;
                await channel.bulkDelete(toDelete);
            } catch (err) {
                console.error(`Failed to purge channel ${channelId}:`, err);
            } finally {
                inactivityTimeout = null;
            }
        }, inactivityMs);
    };

    client.on('messageCreate', async (message) => {
        if (message.channel.id !== channelId) return;
        resetTimer(message.channel);
    });
}

module.exports = initChannelCleaner;
