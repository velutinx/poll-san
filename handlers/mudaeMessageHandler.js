// handlers/mudaeMessageHandler.js
const helpers = require('../utils/helpers');

const activeRolls = new Map();
const ROLL_LIFETIME_MS = 5 * 60 * 1000;

function initMudaeMessageHandler(client) {
    client.on('messageCreate', async (message) => {
        // Only process messages from Mudae bot in the designated roll channel
        if (message.author.id !== helpers.ids.bots.mudae) return;
        if (message.channel.id !== helpers.ids.channels.mudae_roll) return;

        // Check embed description for the claim phrase
        let isRoll = false;
        if (message.embeds.length > 0) {
            const embed = message.embeds[0];
            const description = embed.description || '';
            if (description.includes('React with any emoji to claim!')) {
                isRoll = true;
            }
        }

        if (!isRoll) return;

        // Add the VERIFY reaction
        try {
            await message.react(helpers.releaseEmojis.VERIFY);
            console.log(`✅ Added VERIFY reaction to Mudae roll ${message.id}`);
        } catch (err) {
            console.error(`Failed to add VERIFY reaction to ${message.id}:`, err);
        }

        // Auto-delete after ROLL_LIFETIME_MS
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
