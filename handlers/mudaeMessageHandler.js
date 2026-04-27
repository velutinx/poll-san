// handlers/mudaeMessageHandler.js
const helpers = require('../utils/helpers');
const supabase = require('../services/supabase');

const activeTimeouts = new Map();
const pendingClaims = new Map(); // characterName -> { series, messageId, timestamp }
const ROLL_LIFETIME_MS = 5 * 60 * 1000; // 60 seconds
const CLAIM_LOOKUP_TIMEOUT_MS = 5 * 60 * 1000;

// ========== WHITELIST ==========
// Messages with these IDs will NEVER be deleted.
// Add real message IDs here (from Mudae bot or users) – placeholders for now.
const WHITELISTED_MESSAGE_IDS = new Set([
    '1498065129626013757',
    '1498065147044823290',
    '1498065148693184532',
    '1498065165961400467'
]);

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
    // ---- General message handler (delete all messages after 60s, except whitelisted) ----
    client.on('messageCreate', async (message) => {
        // Only act inside the Mudae roll channel
        if (message.channel.id !== helpers.ids.channels.mudae_roll) return;

        // If message is whitelisted, do NOT schedule deletion
        if (WHITELISTED_MESSAGE_IDS.has(message.id)) return;

        // Schedule deletion after 60 seconds (clear any existing timeout for this message)
        if (activeTimeouts.has(message.id)) clearTimeout(activeTimeouts.get(message.id));
        const timeout = setTimeout(async () => {
            try {
                await message.delete();
      //          console.log(`🗑️ Deleted message ${message.id} from ${message.author.tag}`);
            } catch (err) {
                if (err.code !== 10008) console.error(`Failed to delete message ${message.id}:`, err.message);
            } finally {
                activeTimeouts.delete(message.id);
            }
        }, ROLL_LIFETIME_MS);
        activeTimeouts.set(message.id, timeout);
    });

    // ---- Roll detection & reaction (only Mudae messages) ----
    client.on('messageCreate', async (message) => {
        if (message.author.id !== helpers.ids.bots.mudae) return;
        if (message.channel.id !== helpers.ids.channels.mudae_roll) return;

        // Process roll messages (embeds with claim phrase)
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

    // ---- Claim detection (records claims) ----
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
        pendingClaims.clear();
    });
}

module.exports = initMudaeMessageHandler;
