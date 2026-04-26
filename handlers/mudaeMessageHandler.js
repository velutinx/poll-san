// handlers/mudaeMessageHandler.js
const helpers = require('../utils/helpers');
const supabase = require('../services/supabase');

const pendingClaims = new Map(); // characterName -> { series, messageId, timestamp }
const CLAIM_LOOKUP_TIMEOUT_MS = 1 * 60 * 1000;

let idleTimeout = null;
const IDLE_TIME_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Resets the idle timer. Called on every message in the channel.
 * If the timer expires, the entire channel is purged.
 */
function resetIdleTimer(channel) {
    if (idleTimeout) clearTimeout(idleTimeout);
    idleTimeout = setTimeout(async () => {
        try {
            // Fetch up to 100 newest messages
            const messages = await channel.messages.fetch({ limit: 100 });
            if (messages.size === 0) return;
            await channel.bulkDelete(messages);
            console.log(`🧹 Purged ${messages.size} messages from ${channel.name} due to inactivity.`);
        } catch (err) {
            console.error('Failed to purge idle channel:', err);
        } finally {
            idleTimeout = null;
        }
    }, IDLE_TIME_MS);
}

/**
 * Parse character and series from a Mudae embed.
 */
function parseRollEmbed(embed) {
    if (!embed || !embed.description) return null;
    const lines = embed.description.split('\n').filter(l => l.trim().length > 0);
    const claimIdx = lines.findIndex(l => l.includes('React with any emoji to claim!'));
    if (claimIdx === -1) return null;

    let character = '';
    let seriesLines = [];

    if (embed.author && embed.author.name) {
        character = embed.author.name;
        seriesLines = lines.slice(0, claimIdx);
    } else {
        if (claimIdx === 0) return null;
        character = lines[0].trim();
        seriesLines = lines.slice(1, claimIdx);
    }

    let series = seriesLines.join(' ').trim();
    return { character, series: series || null };
}

function initMudaeMessageHandler(client) {
    // ---- GENERAL MESSAGE HANDLER (activity + rolls) ----
    client.on('messageCreate', async (message) => {
        // Only care about the Mudae roll channel
        if (message.channel.id !== helpers.ids.channels.mudae_roll) return;

        // Reset the idle timer on any message
        resetIdleTimer(message.channel);

        // If the message is not from Mudae bot, we're done (no further processing)
        if (message.author.id !== helpers.ids.bots.mudae) return;

        // Process Mudae roll messages (embeds with claim phrase)
        if (!message.embeds.length) return;
        const embed = message.embeds[0];
        const description = embed.description || '';
        if (!description.includes('React with any emoji to claim!')) return;

        const parsed = parseRollEmbed(embed);
        if (!parsed || !parsed.character) {
            console.log(`[DEBUG] Could not parse roll: ${description.substring(0, 100)}`);
            return;
        }
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

        // Add VERIFY reaction
        try {
            await message.react(helpers.releaseEmojis.VERIFY);
            console.log(`✅ Added VERIFY to ${character} (${series || 'series unknown'})`);
        } catch (err) {
            console.error(`Failed to react: ${err.message}`);
        }
    });

    // ---- CLAIM DETECTION (separate listener) ----
    client.on('messageCreate', async (message) => {
        if (message.channel.id !== helpers.ids.channels.mudae_roll) return;
        if (message.author.id !== helpers.ids.bots.mudae) return;
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
        if (idleTimeout) clearTimeout(idleTimeout);
        pendingClaims.clear();
    });
}

module.exports = initMudaeMessageHandler;
