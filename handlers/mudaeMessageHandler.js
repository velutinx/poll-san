// handlers/mudaeMessageHandler.js
const helpers = require('../utils/helpers');

const activeRolls = new Map();
const ROLL_LIFETIME_MS = 5 * 60 * 1000;

function initMudaeMessageHandler(client) {
    client.on('messageCreate', async (message) => {
        // Log every message to see if the event fires
        console.log(`[DEBUG] Message from ${message.author.tag} in ${message.channel.name}: ${message.content?.substring(0, 50)}`);

        // Only process messages from Mudae bot
        if (message.author.id !== helpers.ids.bots.mudae) {
            console.log(`[DEBUG] Not Mudae bot (got ${message.author.id})`);
            return;
        }
        console.log(`[DEBUG] Matched Mudae bot ID`);

        if (message.channel.id !== helpers.ids.channels.mudae_roll) {
            console.log(`[DEBUG] Not in roll channel (got ${message.channel.id})`);
            return;
        }
        console.log(`[DEBUG] Matched roll channel`);

        if (!message.content || !message.content.includes('React with any emoji to claim!')) {
            console.log(`[DEBUG] Content does not contain claim phrase`);
            return;
        }
        console.log(`[DEBUG] Claim phrase detected, reacting...`);

        // Add the VERIFY reaction
        try {
            await message.react(helpers.releaseEmojis.VERIFY);
            console.log(`✅ Added VERIFY reaction to Mudae roll ${message.id}`);
        } catch (err) {
            console.error(`Failed to add VERIFY reaction to ${message.id}:`, err);
        }

        // Auto‑delete logic (unchanged)
        if (activeRolls.has(message.id)) {
            clearTimeout(activeRolls.get(message.id));
            activeRolls.delete(message.id);
        }

        const timeout = setTimeout(async () => {
            try {
                await message.delete();
                console.log(`🗑️ Deleted Mudae roll ${message.id} (expired)`);
            } catch (err) {
                if (err.code !== 10008) console.error(`Failed to delete Mudae roll ${message.id}:`, err);
            } finally {
                activeRolls.delete(message.id);
            }
        }, ROLL_LIFETIME_MS);

        activeRolls.set(message.id, timeout);
    });

    process.on('beforeExit', () => {
        for (const timeout of activeRolls.values()) clearTimeout(timeout);
        activeRolls.clear();
    });
}

module.exports = initMudaeMessageHandler;
