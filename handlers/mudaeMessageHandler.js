// handlers/mudaeMessageHandler.js
const helpers = require('../utils/helpers');
const supabase = require('../services/supabase');

const activeTimeouts = new Map();
const pendingClaims = new Map();       // characterName -> { series, messageId, timestamp }
const ROLL_LIFETIME_MS = 5 * 60 * 1000;
const CLAIM_LOOKUP_TIMEOUT_MS = 2 * 60 * 1000;

function initMudaeMessageHandler(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.id !== helpers.ids.bots.mudae) return;
        if (message.channel.id !== helpers.ids.channels.mudae_roll) return;

        // --- 1. Schedule deletion for EVERY Mudae message in this channel ---
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

        // --- 2. Process roll messages for reaction and claim tracking ---
        let isRoll = false;
        let characterName = null;
        let series = null;
        if (message.embeds.length > 0) {
            const embed = message.embeds[0];
            const description = embed.description || '';
            if (description.includes('React with any emoji to claim!')) {
                isRoll = true;
                // Split by newline and filter out empty lines
                const lines = description.split('\n').filter(line => line.trim().length > 0);
                // Expected: [character, series, "React with any emoji to claim!", ...]
                if (lines.length >= 2) {
                    characterName = lines[0].trim();
                    series = lines[1].trim();
                } else if (embed.title) {
                    characterName = embed.title;
                    // Try to find series in the description before the claim instruction
                    const claimIndex = description.indexOf('React with any emoji to claim!');
                    if (claimIndex > 0) {
                        const beforeClaim = description.substring(0, claimIndex).trim();
                        const seriesMatch = beforeClaim.match(/^(.+?)(?:\n|$)/);
                        if (seriesMatch) series = seriesMatch[1].trim();
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

            // Add VERIFY reaction
            try {
                await message.react(helpers.releaseEmojis.VERIFY);
                console.log(`✅ Added VERIFY reaction to Mudae roll ${message.id} (${characterName} - ${series})`);
            } catch (err) {
                console.error(`Failed to add reaction to ${message.id}:`, err.message);
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
        for (const timeout of activeTimeouts.values()) clearTimeout(timeout);
        activeTimeouts.clear();
        pendingClaims.clear();
    });
}

module.exports = initMudaeMessageHandler;
