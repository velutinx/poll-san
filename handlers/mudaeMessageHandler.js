// handlers/mudaeMessageHandler.js
const helpers = require('../utils/helpers');
const supabase = require('../services/supabase');

const activeTimeouts = new Map();
const pendingClaims = new Map();
const ROLL_LIFETIME_MS = 5 * 60 * 1000;
const CLAIM_LOOKUP_TIMEOUT_MS = 2 * 60 * 1000;

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

        // --- 2. Roll message detection and series extraction ---
        let characterName = null;
        let series = null;
        let isRoll = false;

        if (message.embeds.length > 0) {
            const embed = message.embeds[0];
            const description = embed.description || '';

            if (description.includes('React with any emoji to claim!')) {
                isRoll = true;

                // Extract character name and series using regex
                // Format: "CharacterName\nSeriesName\nReact with any emoji to claim!"
                const match = description.match(/^([^\n]+)\n([^\n]+)\nReact with any emoji to claim!/);
                if (match) {
                    characterName = match[1].trim();
                    series = match[2].trim();
                } else {
                    // Fallback: split by newline and filter empty lines
                    const lines = description.split('\n').filter(l => l.trim().length > 0);
                    if (lines.length >= 2) {
                        characterName = lines[0].trim();
                        series = lines[1].trim();
                    } else if (embed.title) {
                        characterName = embed.title;
                        // Attempt to extract series from description before the claim phrase
                        const claimIndex = description.indexOf('React with any emoji to claim!');
                        if (claimIndex > 0) {
                            const beforeClaim = description.slice(0, claimIndex).trim();
                            const lastLine = beforeClaim.split('\n').pop();
                            if (lastLine) series = lastLine.trim();
                        }
                    }
                }

                console.log(`[DEBUG] Extracted: character="${characterName}", series="${series}"`);
            }
        }

        if (isRoll && characterName && series) {
            // Store for later claim matching
            pendingClaims.set(characterName, {
                series,
                messageId: message.id,
                timestamp: Date.now()
            });
            setTimeout(() => {
                if (pendingClaims.has(characterName) && pendingClaims.get(characterName).messageId === message.id) {
                    pendingClaims.delete(characterName);
                }
            }, CLAIM_LOOKUP_TIMEOUT_MS);

            // Add reaction
            try {
                await message.react(helpers.releaseEmojis.VERIFY);
                console.log(`✅ Added VERIFY to ${characterName} (${series})`);
            } catch (err) {
                console.error(`Failed to react: ${err.message}`);
            }
        }

        // --- 3. Claim confirmation detection ---
        if (message.content && message.content.includes('are now married!')) {
            const match = message.content.match(/💖\s*(.+?)\s+and\s+(.+?)\s+are now married! 💖/);
            if (match) {
                const claimerUsername = match[1].trim();
                const characterName = match[2].trim();
                const pending = pendingClaims.get(characterName);
                const series = pending ? pending.series : null;

                // Try to get user ID (optional, may fail)
                let userId = null;
                try {
                    const member = message.guild.members.cache.find(m => m.user.username === claimerUsername);
                    if (member) userId = member.id;
                } catch (err) {}

                // Insert into database
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
