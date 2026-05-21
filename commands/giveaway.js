// commands/giveaway.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, AttachmentBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const fs = require('fs').promises;
const { colors, releaseEmojis } = require('../utils/helpers');
const h = require('../utils/helpers');

const activeGiveaways = new Map();
const giveawaySessions = new Map();

const GIVEAWAY_IMAGE_URL = process.env.GIVEAWAY_IMAGE_URL;
const USE_HOSTED_IMAGE = !!GIVEAWAY_IMAGE_URL;

let supabase;
let supabasePromise;

async function getSupabase() {
    if (supabase) return supabase;
    if (!supabasePromise) {
        supabasePromise = import('../services/supabase.js').then(module => {
            supabase = module.default;
            return supabase;
        });
    }
    return supabasePromise;
}

async function getGiveawayWebhook(channel) {
    let webhook = (await channel.fetchWebhooks()).find(w => w.name === 'Giveaway');
    if (!webhook) {
        webhook = await channel.createWebhook({
            name: 'Giveaway',
            avatar: h.urls.LOGO_URL
        });
    }
    return webhook;
}
const MAX_TIMEOUT = 2147483647;

function safeTimeout(callback, delayMs) {
    if (delayMs <= MAX_TIMEOUT) {
        return setTimeout(callback, delayMs);
    }
    return setTimeout(() => {
        safeTimeout(callback, delayMs - MAX_TIMEOUT);
    }, MAX_TIMEOUT);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Create a giveaway')
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Duration (e.g., 7d, 12h, 30m)')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('winners')
                .setDescription('Number of winners')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('prize')
                .setDescription('Prize description')
                .setRequired(true))
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Channel to post the giveaway')
                .setRequired(true)),

    async execute(interaction) {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({
                content: 'You need `Manage Server` permission to create giveaways.',
                flags: [MessageFlags.Ephemeral]
            });
        }

        const durationStr = interaction.options.getString('duration');
        const winnersCount = interaction.options.getInteger('winners');
        const prize = interaction.options.getString('prize');
        const channel = interaction.options.getChannel('channel');

        const durationMs = parseDuration(durationStr);
        if (!durationMs) {
            return interaction.reply({
                content: 'Invalid duration format. Use e.g., `7d`, `12h`, `30m`.',
                flags: [MessageFlags.Ephemeral]
            });
        }

        const endTime = new Date(Date.now() + durationMs);

        let imageUrl = null;
        let imageAttachment = null;
        if (USE_HOSTED_IMAGE) {
            imageUrl = GIVEAWAY_IMAGE_URL;
        } else {
            const imagePath = path.join(__dirname, '..', 'assets', 'giveaway.jpg');
            try {
                await fs.access(imagePath);
                imageAttachment = new AttachmentBuilder(imagePath);
                imageUrl = 'attachment://giveaway.jpg';
                console.warn('Using local file – image will appear as attachment AND in embed if set. Set GIVEAWAY_IMAGE_URL to avoid duplication.');
            } catch {}
        }

        const giveawayId = Date.now();

        // Build active title with two different gift boxes
        const { left: leftBox, right: rightBox } = h.getTwoRandomPresents();
        const activeTitle = `${leftBox} ${prize} Giveaway ${rightBox}`;

        const embed = new EmbedBuilder()
            .setTitle(activeTitle)
            .setDescription(`${releaseEmojis?.CHAT || '💬'} Click the button below to join the giveaway! ${releaseEmojis?.CHAT || '💬'}`)
            .addFields(
                { name: 'Ends', value: `<t:${Math.floor(endTime.getTime() / 1000)}:R>`, inline: true },
                { name: 'Hosts', value: `${interaction.user}`, inline: true },
                { name: 'Winners', value: `${winnersCount}`, inline: true }
            )
            .setColor(colors.giveaway)
            .setFooter({ text: `Giveaway ID: ${giveawayId}` });

        if (imageUrl) embed.setImage(imageUrl);

        const presentEmojiStr = h.getRandomPresent();
        const match = presentEmojiStr.match(/^<a?:(\w+):(\d+)>$/);
        const emojiData = match ? { name: match[1], id: match[2] } : { name: '🎁' };

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('enter_giveaway')
                    .setLabel('Enter Giveaway')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji(emojiData)
            );

        const messageOptions = { embeds: [embed], components: [row] };
        if (imageAttachment) messageOptions.files = [imageAttachment];

        const webhook = await getGiveawayWebhook(channel);
        const giveawayMessage = await webhook.send({
            ...messageOptions,
            username: 'Giveaway',
            avatar: h.urls.LOGO_URL
        });

        // Ghost ping with confetti
        try {
            const pingMessage = await webhook.send({
                content: `${releaseEmojis?.CONFETTI || '🎉'} New giveaway! <@&1472273843665113139>`,
                username: 'Giveaway',
                avatar: h.urls.LOGO_URL
            });
            setTimeout(() => {
                pingMessage.delete().catch(() => {});
            }, 2000);
        } catch (err) {
            console.error('Failed to send ghost ping:', err);
        }

        console.log(`Starting giveaway ID: ${giveawayId} - ${prize} for ${durationStr}`);

        const supabaseClient = await getSupabase();
        const { error } = await supabaseClient
            .from(h.tables.GIVEAWAYS)
            .insert({
                message_id: giveawayMessage.id,
                channel_id: channel.id,
                host_id: interaction.user.id,
                prize: prize,
                winners_count: winnersCount,
                end_time: endTime.toISOString(),
                entrants: [],
                ended: false
            });

        if (error) {
            console.error('Failed to save giveaway to database:', error);
            await webhook.send({
                content: `${releaseEmojis?.ALERT || '⚠'} Giveaway created but failed to save to database. It may not persist after restart.`,
                username: 'Giveaway',
                avatar: h.urls.LOGO_URL
            });
        }

        const timeoutId = safeTimeout(() => endGiveaway(giveawayMessage.id, interaction.client), durationMs);
        activeGiveaways.set(giveawayMessage.id, {
            messageId: giveawayMessage.id,
            channelId: channel.id,
            hostId: interaction.user.id,
            hostMention: `${interaction.user}`,
            endTime: endTime.getTime(),
            winnersCount,
            prize,
            entrants: new Set(),
            ended: false,
            imageUrl,
            timeoutId
        });

        await interaction.reply({
            content: `Giveaway created in ${channel}!`,
            flags: [MessageFlags.Ephemeral]
        });
    }
};

function parseDuration(str) {
    const match = str.match(/^(\d+)([dhm])$/i);
    if (!match) return null;
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    const multipliers = { d: 24 * 60 * 60 * 1000, h: 60 * 60 * 1000, m: 60 * 1000 };
    return value * multipliers[unit];
}

async function handleGiveawayButton(interaction) {
    if (!interaction.isButton() || interaction.customId !== 'enter_giveaway') return;

    const userId = interaction.user.id;
    const messageId = interaction.message.id;
    const sessionKey = `${userId}-${messageId}`;

    let existingSession = giveawaySessions.get(sessionKey);
    let messageUpdated = false;

    if (existingSession && (Date.now() - existingSession.timestamp < 14 * 60 * 1000)) {
        try {
            await interaction.deferUpdate();
            messageUpdated = true;
        } catch (err) {
            giveawaySessions.delete(sessionKey);
            // Interaction expired – just return, can't do anything
            return;
        }
    }

    if (!messageUpdated) {
        try {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        } catch (err) {
            return;
        }
    }

    let responseContent = '';

    let giveaway = activeGiveaways.get(messageId);
    
    if (!giveaway) {
        const supabaseClient = await getSupabase();
        const { data, error } = await supabaseClient
            .from(h.tables.GIVEAWAYS)
            .select('*')
            .eq('message_id', messageId)
            .eq('ended', false)
            .single();

        if (error || !data) {
            responseContent = 'This giveaway has already ended or does not exist.';
        } else {
            const endTime = new Date(data.end_time).getTime();
            const timeLeft = endTime - Date.now();
            let timeoutId = null;
            if (timeLeft > 0) {
                timeoutId = safeTimeout(() => endGiveaway(messageId, interaction.client), timeLeft);
            } else {
                await endGiveaway(messageId, interaction.client);
                responseContent = 'This giveaway has already ended.';
            }

            if (!responseContent) {
                giveaway = {
                    messageId: data.message_id,
                    channelId: data.channel_id,
                    hostId: data.host_id,
                    hostMention: `<@${data.host_id}>`,
                    endTime,
                    winnersCount: data.winners_count,
                    prize: data.prize,
                    entrants: new Set(data.entrants || []),
                    ended: false,
                    timeoutId
                };
                activeGiveaways.set(messageId, giveaway);
            }
        }
    }

    if (!responseContent) {
        if (giveaway.ended) {
            responseContent = 'This giveaway has already ended.';
        } else if (giveaway.entrants.has(userId)) {
            responseContent = 'You have already entered!';
        } else {
            giveaway.entrants.add(userId);

            const supabaseClient = await getSupabase();
            const { error } = await supabaseClient
                .from(h.tables.GIVEAWAYS)
                .update({ entrants: Array.from(giveaway.entrants) })
                .eq('message_id', messageId);

            if (error) {
                console.error('Failed to update entrants:', error);
                giveaway.entrants.delete(userId);
                responseContent = 'Failed to enter giveaway due to a database error.';
            } else {
                responseContent = `${releaseEmojis?.getRandomVerify?.() || '✅'} You entered the giveaway!`;
            }
        }
    }

    if (messageUpdated) {
        try {
            await existingSession.interaction.webhook.editMessage(existingSession.messageId, { content: responseContent });
        } catch (err) {
            const msg = await interaction.followUp({ content: responseContent, flags: [MessageFlags.Ephemeral], fetchReply: true });
            giveawaySessions.set(sessionKey, { interaction, messageId: msg.id, timestamp: Date.now() });
        }
    } else {
        const msg = await interaction.editReply({ content: responseContent });
        giveawaySessions.set(sessionKey, { interaction, messageId: msg.id, timestamp: Date.now() });
    }
}

async function endGiveaway(messageId, client) {
    const giveaway = activeGiveaways.get(messageId);
    if (!giveaway || giveaway.ended) return;
    giveaway.ended = true;
    if (giveaway.timeoutId) clearTimeout(giveaway.timeoutId);
    activeGiveaways.delete(messageId);

    try {
        const supabaseClient = await getSupabase();
        const { data: dbGiveaway, error: fetchError } = await supabaseClient
            .from(h.tables.GIVEAWAYS)
            .select('*')
            .eq('message_id', messageId)
            .single();

        if (fetchError || !dbGiveaway) {
            console.error('Giveaway not found in database at end time:', messageId);
            return;
        }

        const channel = await client.channels.fetch(dbGiveaway.channel_id);
        const webhook = await getGiveawayWebhook(channel);
        const message = await channel.messages.fetch(messageId);

        if (dbGiveaway.reminder_message_id) {
            try {
                const reminderMsg = await channel.messages.fetch(dbGiveaway.reminder_message_id).catch(() => null);
                if (reminderMsg) await reminderMsg.delete();
            } catch (err) {}
        }

        const entrantsArray = dbGiveaway.entrants || [];
        const totalEntries = entrantsArray.length;

        if (totalEntries === 0) {
            await webhook.send({
                content: 'No one entered the giveaway. 😢',
                username: 'Giveaway',
                avatar: h.urls.LOGO_URL
            });
        } else {
            const winners = [];
            const shuffled = [...entrantsArray];
            for (let i = 0; i < Math.min(dbGiveaway.winners_count, shuffled.length); i++) {
                const randomIndex = Math.floor(Math.random() * shuffled.length);
                winners.push(shuffled.splice(randomIndex, 1)[0]);
            }
            const winnerMentions = winners.map(id => `<@${id}>`).join(', ');
            const { left, right } = h.getTwoRandomPresents();
            await webhook.send({
                content: `${releaseEmojis?.CONFETTI || '🎉'} Congratulations to ${winnerMentions} for winning ${left} **${dbGiveaway.prize}** ${right}!`,
                username: 'Giveaway',
                avatar: h.urls.LOGO_URL
            });
        }

        const oldEmbed = message.embeds[0];
        const endedTitle = `${dbGiveaway.prize} Giveaway Ended ${releaseEmojis?.CONFETTI || '🎉'}`;
        const newEmbed = EmbedBuilder.from(oldEmbed)
            .setTitle(endedTitle)
            .setDescription(null)
            .setColor(colors.ended)
            .setFooter({ text: 'Ended' })
            .setFields(
                { name: 'Hosts', value: `<@${dbGiveaway.host_id}>`, inline: true },
                { name: 'Winners', value: `${dbGiveaway.winners_count}`, inline: true },
                { name: 'Total Entries', value: `${totalEntries}`, inline: true }
            );

        if (USE_HOSTED_IMAGE) newEmbed.setImage(GIVEAWAY_IMAGE_URL);
        else newEmbed.setImage(null);

        await webhook.editMessage(message.id, { embeds: [newEmbed], components: [] });
        await supabaseClient.from(h.tables.GIVEAWAYS).delete().eq('message_id', messageId);
    } catch (err) {
        console.error('Error ending giveaway:', err);
    }
}

async function restoreGiveaways(client) {
    const supabaseClient = await getSupabase();
    const now = new Date().toISOString();

    const { data, error } = await supabaseClient
        .from(h.tables.GIVEAWAYS)
        .select('*')
        .eq('ended', false)
        .gt('end_time', now);

    if (error) {
        console.error('Failed to fetch giveaways for restoration:', error);
        return;
    }

    if (!data || data.length === 0) return;

    for (const g of data) {
        const endTime = new Date(g.end_time).getTime();
        const timeLeft = endTime - Date.now();

        if (timeLeft <= 0) {
            console.log(`Giveaway ${g.message_id} - ${g.prize} already ended, processing now.`);
            await endGiveawayFromDB(g, client);
        } else {
            const timeoutId = safeTimeout(() => endGiveaway(g.message_id, client), timeLeft);
            activeGiveaways.set(g.message_id, {
                messageId: g.message_id,
                channelId: g.channel_id,
                hostId: g.host_id,
                hostMention: `<@${g.host_id}>`,
                endTime,
                winnersCount: g.winners_count,
                prize: g.prize,
                entrants: new Set(g.entrants || []),
                ended: false,
                timeoutId,
                imageUrl: USE_HOSTED_IMAGE ? GIVEAWAY_IMAGE_URL : null
            });
            console.log(`Restoring giveaway ${g.message_id} - ${g.prize}`);
        }
    }
}

async function endGiveawayFromDB(g, client) {
    try {
        const supabaseClient = await getSupabase();
        const channel = await client.channels.fetch(g.channel_id);
        const webhook = await getGiveawayWebhook(channel);
        const message = await channel.messages.fetch(g.message_id);

        if (g.reminder_message_id) {
            try {
                const reminderMsg = await channel.messages.fetch(g.reminder_message_id).catch(() => null);
                if (reminderMsg) await reminderMsg.delete();
            } catch (err) {}
        }

        const entrantsArray = g.entrants || [];
        const totalEntries = entrantsArray.length;

        if (totalEntries === 0) {
            await webhook.send({
                content: 'No one entered the giveaway. 😢',
                username: 'Giveaway',
                avatar: h.urls.LOGO_URL
            });
        } else {
            const winners = [];
            const shuffled = [...entrantsArray];
            for (let i = 0; i < Math.min(g.winners_count, shuffled.length); i++) {
                const randomIndex = Math.floor(Math.random() * shuffled.length);
                winners.push(shuffled.splice(randomIndex, 1)[0]);
            }
            const winnerMentions = winners.map(id => `<@${id}>`).join(', ');
            const { left, right } = h.getTwoRandomPresents();
            await webhook.send({
                content: `${releaseEmojis?.CONFETTI || '🎉'} Congratulations to ${winnerMentions} for winning ${left} **${g.prize}** ${right}!`,
                username: 'Giveaway',
                avatar: h.urls.LOGO_URL
            });
        }

        const oldEmbed = message.embeds[0];
        const endedTitle = `${g.prize} Giveaway Ended ${releaseEmojis?.CONFETTI || '🎉'}`;
        const newEmbed = EmbedBuilder.from(oldEmbed)
            .setTitle(endedTitle)
            .setDescription(null)
            .setColor(colors.ended)
            .setFooter({ text: 'Ended' })
            .setFields(
                { name: 'Hosts', value: `<@${g.host_id}>`, inline: true },
                { name: 'Winners', value: `${g.winners_count}`, inline: true },
                { name: 'Total Entries', value: `${totalEntries}`, inline: true }
            );

        if (USE_HOSTED_IMAGE) newEmbed.setImage(GIVEAWAY_IMAGE_URL);
        else newEmbed.setImage(null);

        await webhook.editMessage(message.id, { embeds: [newEmbed], components: [] });
        await supabaseClient.from(h.tables.GIVEAWAYS).delete().eq('message_id', g.message_id);
    } catch (err) {
        console.error(`Error ending giveaway from DB ${g.message_id}:`, err);
    }
}

module.exports.handleGiveawayButton = handleGiveawayButton;
module.exports.restoreGiveaways = restoreGiveaways;
