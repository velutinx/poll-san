// commands/giveaway.js

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionsBitField,
    AttachmentBuilder,
    MessageFlags
} = require('discord.js');
const path = require('path');
const fs = require('fs').promises;
const { colors, releaseEmojis } = require('../utils/helpers');
const h = require('../utils/helpers');
const db = require('../services/database');

const activeGiveaways = new Map();
const GIVEAWAY_IMAGE_URL = process.env.GIVEAWAY_IMAGE_URL;
const USE_HOSTED_IMAGE = !!GIVEAWAY_IMAGE_URL;
const MAX_TIMEOUT = 2147483647;

const entrantsCache = new Map();
const CACHE_TTL = 60000;

async function getEntrants(messageId) {
    const cached = entrantsCache.get(messageId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.entrants;
    }
    const row = await db.query(
        `SELECT entrants FROM ${h.tables.GIVEAWAYS} WHERE message_id = ? LIMIT 1`,
        [messageId],
        true
    );
    const entrants = row ? JSON.parse(row.entrants || '[]') : [];
    entrantsCache.set(messageId, { entrants, timestamp: Date.now() });
    return entrants;
}

async function setEntrants(messageId, entrants) {
    const entrantsJson = JSON.stringify(entrants);
    await db.query(
        `UPDATE ${h.tables.GIVEAWAYS} SET entrants = ? WHERE message_id = ?`,
        [entrantsJson, messageId]
    );
    entrantsCache.set(messageId, { entrants, timestamp: Date.now() });
}

function invalidateEntrantsCache(messageId) {
    entrantsCache.delete(messageId);
}

async function getBlacklistIds() {
    const rows = await db.query(
        `SELECT user_id FROM ${h.tables.GIVEAWAY_BLACKLIST}`
    );
    return rows.map(r => r.user_id);
}

function safeTimeout(callback, delayMs) {
    if (delayMs <= MAX_TIMEOUT) {
        return setTimeout(callback, delayMs);
    }
    return setTimeout(() => {
        safeTimeout(callback, delayMs - MAX_TIMEOUT);
    }, MAX_TIMEOUT);
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
    
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    
    const userId = interaction.user.id;
    const messageId = interaction.message.id;
    const client = interaction.client;
    let giveaway = activeGiveaways.get(messageId);
    
    if (!giveaway) {
        const row = await db.query(
            `SELECT * FROM ${h.tables.GIVEAWAYS} WHERE message_id = ? AND ended = 0`,
            [messageId],
            true
        );
        if (!row) {
            return interaction.editReply('This giveaway has already ended or does not exist.');
        }
        const endTime = new Date(row.end_time).getTime();
        const timeLeft = endTime - Date.now();
        let timeoutId = null;
        
        if (timeLeft > 0) {
            timeoutId = safeTimeout(() => endGiveaway(messageId, client), timeLeft);
        } else {
            await endGiveaway(messageId, client);
            return interaction.editReply('This giveaway has already ended.');
        }
        
        const entrantsArray = await getEntrants(messageId);
        giveaway = {
            messageId: row.message_id,
            channelId: row.channel_id,
            hostId: row.host_id,
            hostMention: `<@${row.host_id}>`,
            endTime,
            winnersCount: row.winners_count,
            prize: row.prize,
            entrants: new Set(entrantsArray),
            ended: false,
            timeoutId
        };
        activeGiveaways.set(messageId, giveaway);
    }
    
    if (giveaway.ended) {
        return interaction.editReply('This giveaway has already ended.');
    }
    
    if (giveaway.entrants.has(userId)) {
        return interaction.editReply('You have already entered!');
    }
    
    giveaway.entrants.add(userId);
    const entrantsArray = Array.from(giveaway.entrants);
    
    try {
        await setEntrants(messageId, entrantsArray);
        return interaction.editReply(`${releaseEmojis?.getRandomVerify?.() || '✅'} You entered the giveaway!`);
    } catch (error) {
        console.error('Failed to update entrants:', error);
        giveaway.entrants.delete(userId);
        return interaction.editReply('Failed to enter giveaway due to a database error.');
    }
}

async function endGiveaway(messageId, client) {
    const giveaway = activeGiveaways.get(messageId);
    if (giveaway?.ended) return;
    
    if (giveaway) giveaway.ended = true;
    if (giveaway?.timeoutId) clearTimeout(giveaway.timeoutId);
    activeGiveaways.delete(messageId);
    
    try {
        const row = await db.query(
            `SELECT * FROM ${h.tables.GIVEAWAYS} WHERE message_id = ?`,
            [messageId],
            true
        );
        
        if (!row) {
            console.error('Giveaway not found in database at end time:', messageId);
            return;
        }
        
        await db.query(
            `UPDATE ${h.tables.GIVEAWAYS} SET ended = 1 WHERE message_id = ?`,
            [messageId]
        );
        invalidateEntrantsCache(messageId);
        
        const channel = await client.channels.fetch(row.channel_id).catch(() => null);
        if (!channel) {
            console.error(`Channel ${row.channel_id} not found for giveaway ${messageId}`);
            return;
        }
        
        const webhook = await getGiveawayWebhook(channel);
        const message = await channel.messages.fetch(messageId).catch(() => null);
        
        if (!message) {
            console.error(`Message ${messageId} was deleted before the giveaway ended.`);
            return;
        }

        if (row.reminder_message_id && row.reminder_message_id !== messageId) {
            try {
                const reminderMsg = await channel.messages.fetch(row.reminder_message_id).catch(() => null);
                if (reminderMsg) {
                    await reminderMsg.delete();
                    console.log(`🗑️ Deleted reminder message ${row.reminder_message_id} for giveaway ${messageId}`);
                }
            } catch (err) {
                console.warn(`Failed to delete reminder message ${row.reminder_message_id}:`, err);
            }
        }
        
        const entrantsArray = await getEntrants(messageId);
        const totalEntries = entrantsArray.length;
        
        if (totalEntries === 0) {
            await webhook.send({
                content: 'No one entered the giveaway. 😢',
                username: 'Giveaway',
                avatar: h.urls.LOGO_URL
            });
            return;
        }
        
        const blacklistIds = await getBlacklistIds();
        const nonBlacklisted = entrantsArray.filter(id => !blacklistIds.includes(id));
        
        let firstWinner = null;
        let secondWinner = null;
        let thirdWinner = null;
        
        let remaining = [...nonBlacklisted];
        
        if (remaining.length > 0) {
            const idx = Math.floor(Math.random() * remaining.length);
            firstWinner = remaining.splice(idx, 1)[0];
        }
        if (remaining.length > 0) {
            const idx = Math.floor(Math.random() * remaining.length);
            secondWinner = remaining.splice(idx, 1)[0];
        }
        // Fixed: Ensure blacklisted entrants don't win 3rd place!
        const allRemaining = [...remaining]; 
        if (allRemaining.length > 0) {
            const idx = Math.floor(Math.random() * allRemaining.length);
            thirdWinner = allRemaining.splice(idx, 1)[0];
        }
        
        const winners = [firstWinner, secondWinner, thirdWinner].filter(Boolean);
        let announcement = `${releaseEmojis?.CONFETTI || '🎉'} Giveaway for ${row.prize} ended! Winners:\n`;
        
        if (winners.length > 0) {
            announcement += `In case 🥇 fails to claim prize within 4 days, the reward will be passed to 🥈 and so on:\n`;
            const emojis = ['🥇', '🥈', '🥉'];
            winners.forEach((id, index) => {
                announcement += `${emojis[index] || '🏅'} <@${id}>\n`;
            });
        } else {
            announcement = 'No non-blacklisted winners could be selected. 😢';
        }
        
        await webhook.send({
            content: announcement,
            username: 'Giveaway',
            avatar: h.urls.LOGO_URL
        });
        
        const oldEmbed = message.embeds[0];
        if (oldEmbed) {
            const endedTitle = `${row.prize} Giveaway Ended ${releaseEmojis?.CONFETTI || '🎉'}`;
            const newEmbed = EmbedBuilder.from(oldEmbed)
                .setTitle(endedTitle)
                .setDescription(null)
                .setColor(colors.ended)
                .setFooter({ text: 'Ended' })
                .setFields(
                    { name: 'Hosts', value: `<@${row.host_id}>`, inline: true },
                    { name: 'Winner', value: `${row.winners_count}`, inline: true },
                    { name: 'Total Entries', value: `${totalEntries}`, inline: true }
                );
                
            if (USE_HOSTED_IMAGE) newEmbed.setImage(GIVEAWAY_IMAGE_URL);
            else newEmbed.setImage(null);
            
            try {
                await webhook.editMessage(message.id, { embeds: [newEmbed], components: [] });
            } catch (editErr) {
                if (editErr.code === 10008) {
                    console.warn(`Giveaway message ${message.id} was already deleted – skipping edit.`);
                } else {
                    console.error('Failed to edit giveaway message:', editErr);
                }
            }
        }
    } catch (err) {
        console.error('Error ending giveaway:', err);
    }
}

async function restoreGiveaways(client) {
    try {
        const rows = await db.query(
            `SELECT * FROM ${h.tables.GIVEAWAYS} WHERE ended = 0 AND end_time > datetime('now')`,
            []
        );
        if (!rows || rows.length === 0) return;
        
        for (const g of rows) {
            const endTime = new Date(g.end_time).getTime();
            const timeLeft = endTime - Date.now();
            const entrantsArray = await getEntrants(g.message_id);
            
            if (timeLeft <= 0) {
                console.log(`Giveaway ${g.message_id} - ${g.prize} already ended, processing now.`);
                await endGiveaway(g.message_id, client);
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
                    entrants: new Set(entrantsArray),
                    ended: false,
                    timeoutId,
                    imageUrl: USE_HOSTED_IMAGE ? GIVEAWAY_IMAGE_URL : null
                });
                console.log(`Restoring giveaway ${g.message_id} - ${g.prize}`);
            }
        }
    } catch (err) {
        console.error('Failed to restore giveaways:', err);
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Create a giveaway – always picks 1 winner and 2 runner‑ups')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Duration (e.g., 7d, 12h, 30m)')
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
        if (interaction.isButton() && interaction.customId === 'enter_giveaway') {
            return handleGiveawayButton(interaction);
        }
        
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({
                content: 'You need `Manage Server` permission to create giveaways.',
                flags: [MessageFlags.Ephemeral]
            });
        }
        
        const durationStr = interaction.options.getString('duration');
        const prize = interaction.options.getString('prize');
        const channel = interaction.options.getChannel('channel');
        const durationMs = parseDuration(durationStr);
        
        if (!durationMs) {
            return interaction.reply({
                content: 'Invalid duration format. Use e.g., `7d`, `12h`, `30m`.',
                flags: [MessageFlags.Ephemeral]
            });
        }
        
        const winnersCount = 1;
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
        const { left: leftBox, right: rightBox } = h.getTwoRandomPresents();
        const activeTitle = `${leftBox} ${prize} Giveaway ${rightBox}`;
        
        const embed = new EmbedBuilder()
            .setTitle(activeTitle)
            .setDescription(`${releaseEmojis?.CHAT || '💬'} Click the button below to join the giveaway! ${releaseEmojis?.CHAT || '💬'}`)
            .addFields(
                { name: 'Ends', value: `<t:${Math.floor(endTime.getTime() / 1000)}:R>`, inline: true },
                { name: 'Hosts', value: `${interaction.user}`, inline: true },
                { name: 'Winner', value: `${winnersCount}`, inline: true }
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
        
        try {
            const pingMessage = await webhook.send({
                content: `${releaseEmojis?.CONFETTI || '🎉'} New giveaway! <@&1472273843665113139>`,
                username: 'Giveaway',
                avatar: h.urls.LOGO_URL
            });
            // Fixed: Safely delete webhook message using webhook API, not message wrapper.
            setTimeout(() => {
                webhook.deleteMessage(pingMessage.id).catch(() => {});
            }, 2000);
        } catch (err) {
            console.error('Failed to send ghost ping:', err);
        }
        
        console.log(`Starting giveaway ID: ${giveawayId} - ${prize} for ${durationStr}`);
        const sqliteEndTime = endTime.toISOString().slice(0, 19).replace('T', ' ');
        
        try {
            await db.query(
                `INSERT INTO ${h.tables.GIVEAWAYS} (message_id, channel_id, host_id, prize, winners_count, end_time, entrants, ended, reminder_sent) VALUES (?, ?, ?, ?, ?, ?, '[]', 0, 0)`,
                [giveawayMessage.id, channel.id, interaction.user.id, prize, winnersCount, sqliteEndTime]
            );
        } catch (error) {
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
    },

    // Handlers exposed for event files/loaders needing them
    handleGiveawayButton,
    restoreGiveaways,
    getBlacklistIds
};
