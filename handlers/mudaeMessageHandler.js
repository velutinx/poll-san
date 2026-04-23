// handlers/mudaeMessageHandler.js
const helpers = require('../utils/helpers');
const supabase = require('../services/supabase');

const activeRolls = new Map();           // messageId -> timeout for deletion
const pendingClaims = new Map();         // characterName -> { series, messageId, timestamp }

const ROLL_LIFETIME_MS = 5 * 60 * 1000;  // 5 minutes
const CLAIM_LOOKUP_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes to match a claim

function initMudaeMessageHandler(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.id !== helpers.ids.bots.mudae) return;
        if (message.channel.id !== helpers.ids.channels.mudae_roll) return;

        // --- 1. Handle roll messages (embed with claim instruction) ---
        let isRoll = false;
        let characterName = null;
        let series = null;
        if (message.embeds.length > 0) {
            const embed = message.embeds[0];
            const description = embed.description || '';
            if (description.includes('React with any emoji to claim!')) {
                isRoll = true;
                // Try to extract character name and series from embed title/description
                // Example format: "Bridgette\nTotal Drama Island\nReact with any emoji to claim!"
                const lines = description.split('\n');
                if (lines.length >= 2) {
                    characterName = lines[0].trim();
                    series = lines[1].trim();
                } else if (embed.title) {
                    // Some rolls might have title as character name
                    characterName = embed.title;
                    // Series might be in the description
                    if (description) {
                        const seriesMatch = description.match(/^(.+?)\n/);
                        if (seriesMatch) series = seriesMatch[1];
                    }
                }
            }
        }

        if (isRoll && characterName && series) {
            // Store for later claim matching
            pendingClaims.set(characterName, {
                series,
                messageId: message.id,
                timestamp: Date.now()
            });
            // Auto‑remove after timeout to avoid memory leak
            setTimeout(() => {
                if (pendingClaims.has(characterName)) {
                    const entry = pendingClaims.get(characterName);
                    if (entry.messageId === message.id) pendingClaims.delete(characterName);
                }
            }, CLAIM_LOOKUP_TIMEOUT_MS);

            // Add VERIFY reaction (existing feature)
            try {
                await message.react(helpers.releaseEmojis.VERIFY);
                console.log(`✅ Added VERIFY reaction to Mudae roll ${message.id} (${characterName})`);
            } catch (err) {
                console.error(`Failed to add VERIFY reaction to ${message.id}:`, err);
            }

            // Schedule auto‑deletion (existing feature)
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
                    // Also remove from pendingClaims if still there
                    if (pendingClaims.has(characterName)) {
                        const entry = pendingClaims.get(characterName);
                        if (entry.messageId === message.id) pendingClaims.delete(characterName);
                    }
                }
            }, ROLL_LIFETIME_MS);
            activeRolls.set(message.id, timeout);
        }

        // --- 2. Handle claim confirmation messages ("... are now married! ...") ---
        if (message.content && message.content.includes('are now married!')) {
            // Example: "💖 velutinxx and Bridgette are now married! 💖"
            const match = message.content.match(/💖\s*(.+?)\s+and\s+(.+?)\s+are now married! 💖/);
            if (match) {
                const claimerUsername = match[1].trim();   // Discord username (not ID)
                const characterName = match[2].trim();

                // Look up series from pendingClaims
                const pending = pendingClaims.get(characterName);
                const series = pending ? pending.series : null;

                // Get Discord user ID (optional – we can store username only)
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
                        console.error('Failed to insert claim:', error);
                    } else {
                        console.log(`📝 Recorded claim: ${claimerUsername} claimed ${characterName} (${series || 'unknown series'})`);
                    }
                } catch (err) {
                    console.error('Database error on claim recording:', err);
                }

                // Optionally remove from pendingClaims (but keep for other potential claims? Usually one claim per roll)
                if (pending) pendingClaims.delete(characterName);
            }
        }
    });

    // Clean up timeouts on shutdown
    process.on('beforeExit', () => {
        for (const timeout of activeRolls.values()) clearTimeout(timeout);
        activeRolls.clear();
        pendingClaims.clear();
    });
}

module.exports = initMudaeMessageHandler;
