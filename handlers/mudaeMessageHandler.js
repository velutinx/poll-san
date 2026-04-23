// handlers/mudaeMessageHandler.js
const helpers = require('../utils/helpers');
const supabase = require('../services/supabase');

const activeTimeouts = new Map();
const pendingClaims = new Map(); // characterName -> { embedDescription, messageId, timestamp }
const ROLL_LIFETIME_MS = 5 * 60 * 1000;
const CLAIM_LOOKUP_TIMEOUT_MS = 2 * 60 * 1000;

function extractSeriesFromDescription(description) {
    if (!description) return null;
    const lines = description.split('\n').filter(l => l.trim().length > 0);
    // Find the line containing "React with any emoji to claim!" and return the line before it
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('React with any emoji to claim!')) {
            if (i > 0) return lines[i - 1].trim();
            break;
        }
    }
    return null;
}

function extractCharacterNameFromDescription(description) {
    if (!description) return null;
    const lines = description.split('\n').filter(l => l.trim().length > 0);
    // The character name is usually the first non‑empty line that is NOT the series and NOT the claim phrase
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('React with any emoji to claim!')) continue;
        // Assume first line that doesn't look like a series name? Hard to guess.
        // We'll rely on embed.title instead.
    }
    return null;
}

function initMudaeMessageHandler(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.id !== helpers.ids.bots.mudae) return;
        if (message.channel.id !== helpers.ids.channels.mudae_roll) return;

        // --- 1. Delete every Mudae message after 5 minutes ---
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

        // --- 2. Roll detection ---
        let characterName = null;
        let embedDescription = null;
        let isRoll = false;

        if (message.embeds.length > 0) {
            const embed = message.embeds[0];
            const description = embed.description || '';
            if (description.includes('React with any emoji to claim!')) {
                isRoll = true;
                embedDescription = description;
                // Use embed.title if available (often the character name)
                if (embed.title) {
                    characterName = embed.title;
                } else {
                    // Fallback: try to extract character name from description (first non‑empty line)
                    const lines = description.split('\n').filter(l => l.trim().length > 0);
                    if (lines[0] && !lines[0].includes('React')) characterName = lines[0].trim();
                }
                console.log(`[DEBUG] Roll: character="${characterName}", desc preview="${description.substring(0, 80)}..."`);
            }
        }

        if (isRoll && characterName && embedDescription) {
            pendingClaims.set(characterName, {
                embedDescription,
                messageId: message.id,
                timestamp: Date.now()
            });
            setTimeout(() => {
                if (pendingClaims.has(characterName) && pendingClaims.get(characterName).messageId === message.id) {
                    pendingClaims.delete(characterName);
                }
            }, CLAIM_LOOKUP_TIMEOUT_MS);

            try {
                await message.react(helpers.releaseEmojis.VERIFY);
                console.log(`✅ Added VERIFY to ${characterName}`);
            } catch (err) {
                console.error(`Failed to react: ${err.message}`);
            }
        }

        // --- 3. Claim detection ---
        if (message.content && message.content.includes('are now married!')) {
            const match = message.content.match(/💖\s*(.+?)\s+and\s+(.+?)\s+are now married! 💖/);
            if (match) {
                const claimerUsername = match[1].trim();
                const characterName = match[2].trim();
                const pending = pendingClaims.get(characterName);
                let series = null;
                if (pending) {
                    series = extractSeriesFromDescription(pending.embedDescription);
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
            }
        }
    });

    process.on('beforeExit', () => {
        for (const timeout of activeTimeouts.values()) clearTimeout(timeout);
        activeTimeouts.clear();
        pendingClaims.clear();
    });
}

module.exports = initMudaeMessageHandler;
