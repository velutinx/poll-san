// handlers/mudaeMessageHandler.js
const helpers = require('../utils/helpers');
const supabase = require('../services/supabase');

const activeTimeouts = new Map();
let channelInactivityTimeout = null;
const ROLL_LIFETIME_MS = 2 * 60 * 1000;
const INACTIVITY_PURGE_MS = 5 * 60 * 1000;
const CLAIM_LOOKUP_TIMEOUT_MS = 1 * 60 * 1000;

const pendingClaims = new Map();

// Whitelist: messages that will never be deleted
const WHITELISTED_MESSAGE_IDS = new Set(helpers.whitelistedMessages[helpers.ids.channels.mudae_roll] || []);

function resetInactivityTimer(channel) {
    if (channelInactivityTimeout) clearTimeout(channelInactivityTimeout);
    channelInactivityTimeout = setTimeout(async () => {
        try {
            const messages = await channel.messages.fetch({ limit: 100 });
            const toDelete = messages.filter(m => !WHITELISTED_MESSAGE_IDS.has(m.id));
            if (toDelete.size === 0) return;
            await channel.bulkDelete(toDelete);
        //    console.log(`🧹 Purged ${toDelete.size} messages from ${channel.name} due to inactivity.`);
            for (const msgId of toDelete.keys()) {
                if (activeTimeouts.has(msgId)) {
                    clearTimeout(activeTimeouts.get(msgId));
                    activeTimeouts.delete(msgId);
                }
            }
        } catch (err) {
            console.error('Failed to purge inactive channel:', err);
        } finally {
            channelInactivityTimeout = null;
        }
    }, INACTIVITY_PURGE_MS);
}

function parseRollEmbed(embed) {
    if (!embed || !embed.description) return null;
    const lines = embed.description.split('\n').filter(l => l.trim().length > 0);
    const claimIdx = lines.findIndex(l => l.includes('React with any emoji to claim!'));
    if (claimIdx === -1) return null;

    let character = null;
    let series = null;

    if (embed.author && embed.author.name) {
        character = embed.author.name.trim();
        const seriesLines = lines.slice(0, claimIdx);
        series = seriesLines.join(' ').trim();
    }
    if (!character && claimIdx >= 2) {
        character = lines[0].trim();
        series = lines[1].trim();
    }
    if (!character) {
        const match = embed.description.match(/^([^\n]+)\n([^\n]+)\nReact with any emoji to claim!/);
        if (match) {
            character = match[1].trim();
            series = match[2].trim();
        }
    }
    if (!character) {
        console.log(`[DEBUG] Could not parse roll: ${embed.description.substring(0, 100)}`);
        return null;
    }
    return { character, series: series || null };
}

function initMudaeMessageHandler(client) {
    client.on('messageCreate', async (message) => {
        if (message.channel.id !== helpers.ids.channels.mudae_roll) return;

        resetInactivityTimer(message.channel);
        if (WHITELISTED_MESSAGE_IDS.has(message.id)) return;
        if (activeTimeouts.has(message.id)) clearTimeout(activeTimeouts.get(message.id));
        const timeout = setTimeout(async () => {
            try {
                await message.delete();
                // console.log(`🗑️ Deleted message ${message.id}`);
            } catch (err) {
                if (err.code !== 10008) console.error(`Failed to delete message ${message.id}:`, err.message);
            } finally {
                activeTimeouts.delete(message.id);
            }
        }, ROLL_LIFETIME_MS);
        activeTimeouts.set(message.id, timeout);
    });

    client.on('messageCreate', async (message) => {
        if (message.author.id !== helpers.ids.bots.mudae) return;
        if (message.channel.id !== helpers.ids.channels.mudae_roll) return;
        if (!message.embeds.length) return;

        const embed = message.embeds[0];
        const description = embed.description || '';
        if (!description.includes('React with any emoji to claim!')) return;

        const parsed = parseRollEmbed(embed);
        if (!parsed || !parsed.character) return;

        const { character, series } = parsed;

        // Store for claim matching
        pendingClaims.set(character, {
            series,
            messageId: message.id,
            timestamp: Date.now()
        });
        setTimeout(() => {
            if (pendingClaims.has(character) && pendingClaims.get(character).messageId === message.id) {
                pendingClaims.delete(character);
            }
        }, CLAIM_LOOKUP_TIMEOUT_MS);

        // Add a random VERIFY reaction
        try {
            const randomVerify = helpers.releaseEmojis.getRandomVerify();
            await message.react(randomVerify);
            // console.log(`✅ Added random verify to ${character}`);
        } catch (err) {
            console.error(`Failed to react: ${err.message}`);
        }
    });

    // ---- Claim detection ----
    client.on('messageCreate', async (message) => {
        if (message.author.id !== helpers.ids.bots.mudae) return;
        if (message.channel.id !== helpers.ids.channels.mudae_roll) return;
        if (!message.content || !message.content.includes('are now married!')) return;

        const match = message.content.match(/💖\s*(.+?)\s+and\s+(.+?)\s+are now married! 💖/);
        if (!match) return;

        const claimerUsername = match[1].replace(/\*\*/g, '').trim();
        const characterName = match[2].replace(/\*\*/g, '').trim();
        const pending = pendingClaims.get(characterName);
        const series = pending ? pending.series : null;

        let userId = null;
        try {
            const member = message.guild.members.cache.find(m => m.user.username === claimerUsername);
            if (member) userId = member.id;
        } catch (err) {}

        try {
            const { error } = await supabase.from(helpers.tables.GAMES_MUDAE_CLAIMS).insert({
                user_id: userId,
                username: claimerUsername,
                character_name: characterName,
                series: series,
                claimed_at: new Date().toISOString()
            });
            if (error) {
                console.error('Insert error:', error);
            } else {
                console.log(`📝 Recorded: ${claimerUsername} claimed ${characterName} (${series || 'unknown series'})`);
            }
        } catch (err) {
            console.error('DB error:', err);
        }
        if (pending) pendingClaims.delete(characterName);
    });

    // Cleanup on shutdown
    process.on('beforeExit', () => {
        for (const timeout of activeTimeouts.values()) clearTimeout(timeout);
        activeTimeouts.clear();
        if (channelInactivityTimeout) clearTimeout(channelInactivityTimeout);
        pendingClaims.clear();
    });
}

module.exports = initMudaeMessageHandler;
