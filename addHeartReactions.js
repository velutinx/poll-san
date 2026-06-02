// addHeartReactions.js
const { Client, GatewayIntentBits, Partials } = require('discord.js');
require('dotenv').config();

const PREVIEW_FORUM_ID = '1465938599378812980';
const SUPPORTER_FORUM_ID = '1465937644394512516';
const HEART_EMOJI = '<a:heart:1511391137825558628>'; // animated heart – falls back to 💖 if invalid

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.once('ready', async () => {
    console.log('🤖 Bot is ready. Starting heart reaction scan...');

    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild) {
        console.error('❌ Guild not found. Check GUILD_ID in .env');
        process.exit(1);
    }

    // Helper to add heart reaction to a message if it has zero reactions
    async function addHeartIfNoReactions(message) {
        // Fetch full message to get up-to-date reactions (partials may be empty)
        const fullMessage = await message.fetch();
        const hasAnyReaction = fullMessage.reactions.cache.size > 0;
        if (!hasAnyReaction) {
            try {
                await fullMessage.react(HEART_EMOJI);
                console.log(`❤️ Added heart reaction to thread: ${fullMessage.channel.name} (${fullMessage.id})`);
            } catch (err) {
                console.warn(`⚠️ Could not react to message ${fullMessage.id}:`, err.message);
            }
        } else {
            console.log(`⏩ Skipped (has reactions): ${fullMessage.channel.name}`);
        }
    }

    // Process all threads in a given forum channel
    async function processForum(channelId, channelName) {
        const channel = await guild.channels.fetch(channelId);
        if (!channel || !channel.isThreadOnly()) {
            console.error(`❌ ${channelName} forum channel not found or not a forum`);
            return;
        }
        console.log(`\n📁 Processing ${channelName} (${channelId})...`);

        // Get active threads
        const activeThreads = await channel.threads.fetchActive();
        for (const thread of activeThreads.threads.values()) {
            const starter = await thread.fetchStarterMessage().catch(() => null);
            if (starter) await addHeartIfNoReactions(starter);
        }

        // Get archived threads (Discord limits to 100 per request, but we paginate)
        let archivedCursor = null;
        let hasMore = true;
        while (hasMore) {
            const archived = await channel.threads.fetchArchived({ before: archivedCursor, limit: 100 });
            for (const thread of archived.threads.values()) {
                const starter = await thread.fetchStarterMessage().catch(() => null);
                if (starter) await addHeartIfNoReactions(starter);
            }
            archivedCursor = archived.threads.last()?.id;
            hasMore = archived.hasMore;
            if (archivedCursor && hasMore) await new Promise(resolve => setTimeout(resolve, 500)); // rate limit delay
        }
    }

    await processForum(PREVIEW_FORUM_ID, 'Preview Forum');
    await processForum(SUPPORTER_FORUM_ID, 'Supporter Forum');

    console.log('\n✅ All done. Shutting down...');
    client.destroy();
    process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
