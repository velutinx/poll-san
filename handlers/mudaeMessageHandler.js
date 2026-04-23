// handlers/mudaeMessageHandler.js
const helpers = require('../utils/helpers');
const supabase = require('../services/supabase');

const activeTimeouts = new Map();
const pendingClaims = new Map();
const ROLL_LIFETIME_MS = 5 * 60 * 1000;
const CLAIM_LOOKUP_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Parse character and series from a Mudae embed description.
 * Returns { character, series } or null.
 */
function parseRollEmbed(description, embedTitle) {
    if (!description) return null;
    // Split into non‑empty lines, ignoring lines that only contain the claim phrase
    let rawLines = description.split('\n').filter(l => l.trim().length > 0);
    // Remove any line that is exactly "React with any emoji to claim!" (may appear multiple times)
    const lines = rawLines.filter(l => l !== 'React with any emoji to claim!');
    
    // Find the index of the claim phrase (there should be at least one)
    const claimIndex = rawLines.findIndex(l => l.includes('React with any emoji to claim!'));
    if (claimIndex === -1) return null;
    
    // The series is the line immediately before the claim phrase (if any)
    // The character is the line before that (if any)
    let series = null;
    let character = null;
    if (claimIndex >= 2) {
        character = rawLines[claimIndex - 2].trim();
        series = rawLines[claimIndex - 1].trim();
    } else if (claimIndex === 1) {
        character = rawLines[0].trim();
        // No series line; try to use embed.title (if provided)
        if (embedTitle) series = embedTitle.trim();
    } else {
        // No lines before claim phrase; use embed.title for character, series = null
        if (embedTitle) character = embedTitle.trim();
    }
    
    return { character, series };
}

function initMudaeMessageHandler(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.id !== helpers.ids.bots.mudae) return;
        if (message.channel.id !== helpers.ids.channels.mudae_roll) return;

        // Auto-delete every Mudae message after 5 minutes
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

        const parsed = parseRollEmbed(description, embed.title);
        if (!parsed || !parsed.character) {
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
            console.log(`✅ Added VERIFY to ${character} (${series || 'unknown series'})`);
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

        const claimerUsername = match[1].trim();
        const characterName = match[2].trim();
        const pending = pendingClaims.get(characterName);
        let series = null;
        if (pending) {
            const parsed = parseRollEmbed(pending.embedDescription, null);
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
