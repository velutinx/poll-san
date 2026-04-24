// handlers/mudaeMessageHandler.js

const helpers = require('../utils/helpers');
const supabase = require('../services/supabase');

const activeTimeouts = new Map();
const pendingClaims = new Map();

const ROLL_LIFETIME_MS = 5 * 60 * 1000;
const CLAIM_LOOKUP_TIMEOUT_MS = 2 * 60 * 1000;

function normalizeName(str) {
    return str
        ?.replace(/\*\*/g, '')
        ?.replace(/[\u200B-\u200D\uFEFF]/g, '')
        ?.trim()
        ?.toLowerCase();
}

function parseRollEmbed(description) {
    if (!description) return null;

    const lines = description
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);

    const claimIdx = lines.findIndex(l =>
        l.includes('React with any emoji to claim!')
    );

    if (claimIdx === -1) return null;

    const data = lines.slice(0, claimIdx);

    if (!data.length) return null;

    // FIRST line = character (correct for most cases)
    let character = data[0];
    let series = data.slice(1).join(' ').trim() || null;

    return { character, series };
}

function initMudaeMessageHandler(client) {

client.on('messageCreate', async (message) => {

    if (message.author.id !== helpers.ids.bots.mudae) return;
    if (message.channel.id !== helpers.ids.channels.mudae_roll) return;

    // auto delete
    if (activeTimeouts.has(message.id))
        clearTimeout(activeTimeouts.get(message.id));

    const timeout = setTimeout(async () => {
        try {
            await message.delete();
        } catch {}
        finally {
            activeTimeouts.delete(message.id);
        }
    }, ROLL_LIFETIME_MS);

    activeTimeouts.set(message.id, timeout);

    if (!message.embeds.length) return;

    const embed = message.embeds[0];
    const description = embed.description || '';

    if (!description.includes('React with any emoji to claim!')) return;

    const parsed = parseRollEmbed(description);

    if (!parsed) return;

    const { character, series } = parsed;

    pendingClaims.set(normalizeName(character), {
        embedDescription: description,
        messageId: message.id,
        timestamp: Date.now()
    });

    setTimeout(() => {
        const key = normalizeName(character);
        if (
            pendingClaims.has(key) &&
            pendingClaims.get(key).messageId === message.id
        ) {
            pendingClaims.delete(key);
        }
    }, CLAIM_LOOKUP_TIMEOUT_MS);

    try {
        await message.react(helpers.releaseEmojis.VERIFY);
        console.log(`✅ Added VERIFY to ${character} (${series || 'series unknown'})`);
    } catch (err) {
        console.error(`Failed to react: ${err.message}`);
    }

});

client.on('messageCreate', async (message) => {

    if (message.author.id !== helpers.ids.bots.mudae) return;
    if (message.channel.id !== helpers.ids.channels.mudae_roll) return;

    if (!message.content.includes('are now married!')) return;

    const match = message.content.match(
        /💖\s*(.+?)\s+and\s+(.+?)\s+are now married! 💖/
    );

    if (!match) return;

    const claimerUsername = match[1].trim();
    const characterName = match[2].trim();

    const pending = pendingClaims.get(
        normalizeName(characterName)
    );

    let series = null;

    if (pending) {
        const parsed = parseRollEmbed(
            pending.embedDescription
        );

        if (parsed) {
            // fix flipped order
            if (
                normalizeName(parsed.character) ===
                normalizeName(characterName)
            ) {
                series = parsed.series;
            } else {
                // flipped
                series = parsed.character;
            }
        }
    }

    let userId = null;

    try {
        const member =
            message.guild.members.cache.find(
                m => m.user.username === claimerUsername
            );

        if (member) userId = member.id;
    } catch {}

    try {
        const { error } =
            await supabase
                .from('games_mudae_claims')
                .insert({
                    user_id: userId,
                    username: claimerUsername,
                    character_name: characterName,
                    series: series,
                    claimed_at: new Date().toISOString()
                });

        if (error) {
            console.error('Insert error:', error);
        } else {
            console.log(
                `📝 Recorded: ${claimerUsername} claimed ${characterName} (${series || 'unknown series'})`
            );
        }

    } catch (err) {
        console.error('DB error:', err);
    }

    if (pending) {
        pendingClaims.delete(
            normalizeName(characterName)
        );
    }

});

process.on('beforeExit', () => {
    for (const timeout of activeTimeouts.values())
        clearTimeout(timeout);

    activeTimeouts.clear();
    pendingClaims.clear();
});

}

module.exports = initMudaeMessageHandler;
