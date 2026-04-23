// handlers/mudaeMessageHandler.js
const helpers = require('../utils/helpers');

// In‑memory store for active roll messages (messageId -> timeout)
const activeRolls = new Map();

// How long to keep a Mudae roll message before deleting it (ms)
const ROLL_LIFETIME_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Initialize the Mudae message handler.
 * @param {Client} client - Discord.js client
 */
function initMudaeMessageHandler(client) {
    client.on('messageCreate', async (message) => {
        // Only process messages from Mudae bot in the designated roll channel
        if (message.author.id !== helpers.ids.bots.mudae) return;
        if (message.channel.id !== helpers.ids.channels.mudae_roll) return;
        if (!message.content || !message.content.includes('React with any emoji to claim!')) return;

        // Add the VERIFY reaction
        try {
            await message.react(helpers.releaseEmojis.VERIFY);
            console.log(`✅ Added VERIFY reaction to Mudae roll ${message.id}`);
        } catch (err) {
            console.error(`Failed to add VERIFY reaction to ${message.id}:`, err);
        }
 
        // Schedule auto‑deletion after ROLL_LIFETIME_MS
        // Clear any existing timeout for the same message (shouldn't happen)
        if (activeRolls.has(message.id)) {
            clearTimeout(activeRolls.get(message.id));
            activeRolls.delete(message.id);
        }

        const timeout = setTimeout(async () => {
            try {
                await message.delete();
                console.log(`🗑️ Deleted Mudae roll ${message.id} (expired)`);
            } catch (err) {
                if (err.code === 10008) {
                    // Message already deleted – ignore
                } else {
                    console.error(`Failed to delete Mudae roll ${message.id}:`, err);
                }
            } finally {
                activeRolls.delete(message.id);
            }
        }, ROLL_LIFETIME_MS);

        activeRolls.set(message.id, timeout);
    });

    // Optional: Clean up timeouts on bot shutdown (graceful)
    process.on('beforeExit', () => {
        for (const timeout of activeRolls.values()) {
            clearTimeout(timeout);
        }
        activeRolls.clear();
    });
}

module.exports = initMudaeMessageHandler;
