// handlers/mudaeMessageHandler.js

const helpers = require('../utils/helpers');
const supabase = require('../services/supabase');

const activeTimeouts = new Map();
const pendingClaims = new Map(); // characterName -> { series, messageId, timestamp }
const ROLL_LIFETIME_MS = 5 * 60 * 1000;
const CLAIM_LOOKUP_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Parse character and series from a Mudae embed.
 * - Character name is usually in embed.author.name
 * - All lines in the description before the claim phrase = series
 */
function parseRollEmbed(embed) {
    if (!embed || !embed.description) return null;
    const lines = embed.description.split('\n').filter(l => l.trim().length > 0);
    const claimIdx = lines.findIndex(l => l.includes('React with any emoji to claim!'));
    
    if (claimIdx === -1) return null;

    let character = '';
    let seriesLines = [];

    // Standard Mudae Format: Character is in the embed author name
    if (embed.author && embed.author.name) {
        character = embed.author.name;
        seriesLines = lines.slice(0, claimIdx);
    } else {
        // Fallback in case Mudae changes formatting
        if (claimIdx === 0) return null; 
        character = lines[0].trim();
        seriesLines = lines.slice(1, claimIdx);
    }

    let series = seriesLines.join(' ').trim();
    return { character, series: series || null };
}

function initMudaeMessageHandler(client) {
    // Roll detection
    client.on('messageCreate', async (message) => {
        if (message.author.id !== helpers.ids.bots.mudae) return;
        if (message.channel.id !== helpers.ids.channels.mudae_roll) return;

        // Auto‑delete EVERY Mudae message after 5 minutes
        if (activeTimeouts.has(message.id)) clearTimeout(activeTimeouts.get(message.id));
        const timeout = setTimeout(async () => {
            try {
                await message.delete();
                console.log(`🗑️ Deleted Mudae message ${message.id}`);
            } catch (err) {
                console.error(`Failed to delete Mudae message ${message.id}:`, err.message);
            } finally {
                activeTimeouts.delete(message.id);
            }
        }, ROLL_LIFETIME_MS);
        activeTimeouts.set(message.id, timeout);

        // Only process roll messages (embeds with claim phrase)
        if (!message.embeds.length) return;
        const embed = message.embeds[0];
        const description = embed.description || '';
        if (!description.includes('React with any emoji to claim!')) return;

        // We now pass the entire embed into the parser instead of just the description
        const parsed = parseRollEmbed(embed);
        if (!parsed || !parsed.character) {
            console.log(`[DEBUG] Could not parse roll: ${description.substring(0, 100)}`);
            return;
        }
        const { character, series } = parsed;

        // Store for claim matching - storing the series directly to save re-parsing later
        pendingClaims.set(character, {
            series: series,
            messageId: message.id,
            timestamp: Date.now()
        });
        
        setTimeout(() => {
            if (pendingClaims.has(character) && pendingClaims.get(character).messageId === message.id) {
                pendingClaims.delete(character);
            }
        }, CLAIM_LOOKUP_TIMEOUT_MS);

        // Add reaction
        try {
            await message.react(helpers.releaseEmojis.VERIFY);
            console.log(`✅ Added VERIFY to ${character} (${series || 'series unknown'})`);
        } catch (err) {
            console.error(`Failed to react: ${err.message}`);
        }
    });

    // Claim detection
    client.on('messageCreate', async (message) => {
        if (message.author.id !== helpers.ids.bots.mudae) return;
        if (message.channel.id !== helpers.ids.channels.mudae_roll) return;
        if (!message.content || !message.content.includes('are now married!')) return;

        const match = message.content.match(/💖\s*(.+?)\s+and\s+(.+?)\s+are now married! 💖/);
        if (!match) return;

        // Strip the markdown "**" from the names so lookups & DB match properly
        const claimerUsername = match[1].replace(/\*\*/g, '').trim();
        const characterName = match[2].replace(/\*\*/g, '').trim();
        
        // Lookup the pending claim using the cleaned character name
        const pending = pendingClaims.get(characterName);
        const series = pending ? pending.series : null;

        let userId = null;
        try {
            // Lookup user ID now works because claimerUsername isn't wrapped in asterisks
            const member = message.guild.members.cache.find(m => m.user.username === claimerUsername);
            if (member) userId = member.id;
        } catch (err) {}

        try {
            const { error } = await supabase.from('games_mudae_claims').insert({
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

    process.on('beforeExit', () => {
        for (const timeout of activeTimeouts.values()) clearTimeout(timeout);
        activeTimeouts.clear();
        pendingClaims.clear();
    });
}

module.exports = initMudaeMessageHandler;
