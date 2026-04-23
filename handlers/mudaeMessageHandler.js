// handlers/mudaeMessageHandler.js
const helpers = require('../utils/helpers');
const supabase = require('../services/supabase');

const activeRolls = new Map();
const pendingClaims = new Map();
const ROLL_LIFETIME_MS = 5 * 60 * 1000;
const CLAIM_LOOKUP_TIMEOUT_MS = 2 * 60 * 1000;

function initMudaeMessageHandler(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.id !== helpers.ids.bots.mudae) return;
        if (message.channel.id !== helpers.ids.channels.mudae_roll) return;

        // --- 1. Roll detection (embed) ---
        let isRoll = false;
        let characterName = null;
        let series = null;
        if (message.embeds.length > 0) {
            const embed = message.embeds[0];
            const description = embed.description || '';
            if (description.includes('React with any emoji to claim!')) {
                isRoll = true;
                const lines = description.split('\n');
                if (lines.length >= 2) {
                    characterName = lines[0].trim();
                    series = lines[1].trim();
                } else if (embed.title) {
                    characterName = embed.title;
                    if (description) {
                        const seriesMatch = description.match(/^(.+?)\n/);
                        if (seriesMatch) series = seriesMatch[1];
                    }
                }
            }
        }

        if (isRoll && characterName && series) {
            pendingClaims.set(characterName, {
                series,
                messageId: message.id,
                timestamp: Date.now()
            });
            setTimeout(() => {
                if (pendingClaims.has(characterName)) {
                    const entry = pendingClaims.get(characterName);
                    if (entry.messageId === message.id) pendingClaims.delete(characterName);
                }
            }, CLAIM_LOOKUP_TIMEOUT_MS);

            // Add reaction
            try {
                await message.react(helpers.releaseEmojis.VERIFY);
                console.log(`✅ Added VERIFY reaction to Mudae roll ${message.id} (${characterName})`);
            } catch (err) {
                console.error(`Failed to add VERIFY reaction to ${message.id}:`, err);
            }

            // Auto‑delete
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
                    if (pendingClaims.has(characterName)) {
                        const entry = pendingClaims.get(characterName);
                        if (entry.messageId === message.id) pendingClaims.delete(characterName);
                    }
                }
            }, ROLL_LIFETIME_MS);
            activeRolls.set(message.id, timeout);
        }

        // --- 2. Claim confirmation detection ---
        if (message.content && message.content.includes('are now married!')) {
            // Regex to extract claimer and character
            const match = message.content.match(/💖\s*(.+?)\s+and\s+(.+?)\s+are now married! 💖/);
            if (match) {
                const claimerUsername = match[1].trim();
                const characterName = match[2].trim();

                const pending = pendingClaims.get(characterName);
                const series = pending ? pending.series : null;

                // Try to get Discord user ID (optional, may fail)
                let userId = null;
                try {
                    const member = message.guild.members.cache.find(m => m.user.username === claimerUsername);
                    if (member) userId = member.id;
                } catch (err) {}

                // Insert into database (user_id is now nullable)
                try {
                    const { error } = await supabase.from('games_mudae_claims').insert({
                        user_id: userId,
                        username: claimerUsername,
                        character_name: characterName,
                        series: series,
                        claimed_at: new Date().toISOString()
                    });
                    if (error) {
                        console.error('Failed to insert claim:', error);
                    } else {
                        console.log(`📝 Recorded claim: ${claimerUsername} claimed ${characterName} (${series || 'unknown series'})`);
                    }
                } catch (err) {
                    console.error('Database error on claim recording:', err);
                }

                if (pending) pendingClaims.delete(characterName);
            }
        }
    });

    process.on('beforeExit', () => {
        for (const timeout of activeRolls.values()) clearTimeout(timeout);
        activeRolls.clear();
        pendingClaims.clear();
    });
}

module.exports = initMudaeMessageHandler;
