// handlers/mudaeMessageHandler.js
const helpers = require('../utils/helpers');
const supabase = require('../services/supabase');

const activeTimeouts = new Map();
const pendingClaims = new Map(); // characterName -> { embedDescription, messageId }
const ROLL_LIFETIME_MS = 5 * 60 * 1000;
const CLAIM_LOOKUP_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Parse a Mudae embed description to extract character name and series.
 * Expected format (lines may have empty lines):
 *   Character Name
 *   Series Name
 *   React with any emoji to claim!
 * Returns { character, series } or null.
 */
function parseRollEmbed(description) {
    if (!description) return null;
    const lines = description.split('\n').filter(l => l.trim().length > 0);
    // Find the line that contains the claim phrase
    let claimIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('React with any emoji to claim!')) {
            claimIdx = i;
            break;
        }
    }
    if (claimIdx === -1) return null;
    // The series is the line immediately before the claim phrase
    const series = claimIdx > 0 ? lines[claimIdx - 1].trim() : null;
    // The character is the line before that (if exists), otherwise null
    const character = claimIdx > 1 ? lines[claimIdx - 2].trim() : null;
    return { character, series };
}

function initMudaeMessageHandler(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.id !== helpers.ids.bots.mudae) return;
        if (message.channel.id !== helpers.ids.channels.mudae_roll) return;

        // --- 1. Auto‑delete all Mudae messages after 5 minutes ---
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

        // --- 2. Process roll messages ---
        if (message.embeds.length === 0) return;
        const embed = message.embeds[0];
        const description = embed.description || '';
        if (!description.includes('React with any emoji to claim!')) return;

        // Parse character and series
        const parsed = parseRollEmbed(description);
        if (!parsed || !parsed.character || !parsed.series) {
            console.log(`[DEBUG] Could not parse roll: ${description.substring(0, 100)}`);
            return;
        }
        const { character, series } = parsed;

        // Store for claim matching
        pendingClaims.set(character, {
            embedDescription: description,
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
            console.log(`✅ Added VERIFY to ${character} (${series})`);
        } catch (err) {
            console.error(`Failed to react: ${err.message}`);
        }
    });

    // --- 3. Claim detection (separate listener to avoid clutter) ---
    client.on('messageCreate', async (message) => {
        if (message.author.id !== helpers.ids.bots.mudae) return;
        if (message.channel.id !== helpers.ids.channels.mudae_roll) return;
        if (!message.content || !message.content.includes('are now married!')) return;

        const match = message.content.match(/💖\s*(.+?)\s+and\s+(.+?)\s+are now married! 💖/);
        if (!match) return;

        const claimerUsername = match[1].trim();
        const characterName = match[2].trim();
        const pending = pendingClaims.get(characterName);
        // If no pending roll, we may still record without series
        let series = null;
        if (pending) {
            const parsed = parseRollEmbed(pending.embedDescription);
            if (parsed) series = parsed.series;
        }

        let userId = null;
        try {
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
