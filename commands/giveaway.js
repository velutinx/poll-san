const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, AttachmentBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const fs = require('fs');
const supabase = require(path.join(__dirname, '..', 'services', 'supabase'));

// In-memory cache for quick access
const activeGiveaways = new Map();

// Get image configuration from environment
const GIVEAWAY_IMAGE_URL = process.env.GIVEAWAY_IMAGE_URL; // e.g., https://i.imgur.com/abc123.jpg
const USE_HOSTED_IMAGE = !!GIVEAWAY_IMAGE_URL;

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

        // Prepare image
        let imageUrl = null;
        let imageAttachment = null;

        if (USE_HOSTED_IMAGE) {
            imageUrl = GIVEAWAY_IMAGE_URL;
        } else {
            const imagePath = path.join(__dirname, '..', 'assets', 'giveaway.jpg');
            if (fs.existsSync(imagePath)) {
                imageAttachment = new AttachmentBuilder(imagePath);
                imageUrl = 'attachment://giveaway.jpg';
                console.warn('Using local file – image will appear as attachment AND in embed if set. Set GIVEAWAY_IMAGE_URL to avoid duplication.');
            }
        }

        const giveawayId = Date.now(); // unique ID used in footer

        // Create embed
        const embed = new EmbedBuilder()
            .setTitle(prize)
            .setDescription('Click the button below to join the giveaway!')
            .addFields(
                { name: 'Ends', value: `<t:${Math.floor(endTime.getTime() / 1000)}:R>`, inline: true },
                { name: 'Hosts', value: `${interaction.user}`, inline: true },
                { name: 'Winners', value: `${winnersCount}`, inline: true }
            )
            .setColor('#FF69B4')
            .setFooter({ text: `Giveaway ID: ${giveawayId}` });

        if (imageUrl) embed.setImage(imageUrl);

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('enter_giveaway')
                    .setLabel('Enter Giveaway')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🎁')
            );

        const messageOptions = { embeds: [embed], components: [row] };
        if (imageAttachment) messageOptions.files = [imageAttachment];

        const giveawayMessage = await channel.send(messageOptions);

        // Log startup
        console.log(`Starting giveaway ID: ${giveawayId} - ${prize} for ${durationStr}`);

        // Insert into database
        const { error } = await supabase
            .from('giveaways')
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
            await channel.send('⚠️ Giveaway created but failed to save to database. It may not persist after restart.');
        }

        // Store in memory cache with setTimeout
        const timeoutId = setTimeout(() => endGiveaway(giveawayMessage.id, interaction.client), durationMs);
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

    let giveaway = activeGiveaways.get(interaction.message.id);
    if (!giveaway) {
        const { data, error } = await supabase
            .from('giveaways')
            .select('*')
            .eq('message_id', interaction.message.id)
            .eq('ended', false)
            .single();

        if (error || !data) {
            return interaction.reply({ 
                content: 'This giveaway has already ended or does not exist.', 
                flags: [MessageFlags.Ephemeral] 
            });
        }

        const endTime = new Date(data.end_time).getTime();
        const timeLeft = endTime - Date.now();
        let timeoutId = null;
        if (timeLeft > 0) {
            timeoutId = setTimeout(() => endGiveaway(interaction.message.id, interaction.client), timeLeft);
        } else {
            return endGiveaway(interaction.message.id, interaction.client);
        }

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
        activeGiveaways.set(interaction.message.id, giveaway);
    }

    if (giveaway.ended) {
        return interaction.reply({ 
            content: 'This giveaway has already ended.', 
            flags: [MessageFlags.Ephemeral] 
        });
    }

    if (giveaway.entrants.has(interaction.user.id)) {
        return interaction.reply({ 
            content: 'You have already entered!', 
            flags: [MessageFlags.Ephemeral] 
        });
    }

    giveaway.entrants.add(interaction.user.id);

    const { error } = await supabase
        .from('giveaways')
        .update({ entrants: Array.from(giveaway.entrants) })
        .eq('message_id', interaction.message.id);

    if (error) {
        console.error('Failed to update entrants:', error);
        giveaway.entrants.delete(interaction.user.id);
        return interaction.reply({ 
            content: 'Failed to enter giveaway due to a database error.', 
            flags: [MessageFlags.Ephemeral] 
        });
    }

    await interaction.reply({ 
        content: '✅ You entered the giveaway!', 
        flags: [MessageFlags.Ephemeral] 
    });
}

async function endGiveaway(messageId, client) {
    const giveaway = activeGiveaways.get(messageId);
    if (!giveaway || giveaway.ended) return;
    giveaway.ended = true;
    if (giveaway.timeoutId) clearTimeout(giveaway.timeoutId);
    activeGiveaways.delete(messageId);

    try {
        const { data: dbGiveaway, error: fetchError } = await supabase
            .from('giveaways')
            .select('*')
            .eq('message_id', messageId)
            .single();

        if (fetchError || !dbGiveaway) {
            console.error('Giveaway not found in database at end time:', messageId);
            return;
        }

        const channel = await client.channels.fetch(dbGiveaway.channel_id);
        const message = await channel.messages.fetch(messageId);

        const entrantsArray = dbGiveaway.entrants || [];
        const totalEntries = entrantsArray.length;

        if (totalEntries === 0) {
            await channel.send('No one entered the giveaway. 😢');
        } else {
            const winners = [];
            const shuffled = [...entrantsArray];
            for (let i = 0; i < Math.min(dbGiveaway.winners_count, shuffled.length); i++) {
                const randomIndex = Math.floor(Math.random() * shuffled.length);
                winners.push(shuffled.splice(randomIndex, 1)[0]);
            }
            const winnerMentions = winners.map(id => `<@${id}>`).join(', ');
            await channel.send(`🎉 Congratulations to ${winnerMentions} for winning **${dbGiveaway.prize}**!`);
        }

        const embed = message.embeds[0];
        const newEmbed = EmbedBuilder.from(embed)
            .setTitle(`${dbGiveaway.prize} Giveaway Ended`)  // ← changed here
            .setDescription(null)
            .setColor('#808080')
            .setFooter({ text: 'Ended' })
            .setFields(
                { name: 'Hosts', value: `<@${dbGiveaway.host_id}>`, inline: true },
                { name: 'Winners', value: `${dbGiveaway.winners_count}`, inline: true },
                { name: 'Total Entries', value: `${totalEntries}`, inline: true }
            );

        if (USE_HOSTED_IMAGE) {
            newEmbed.setImage(GIVEAWAY_IMAGE_URL);
        } else {
            newEmbed.setImage(null);
        }

        await message.edit({ embeds: [newEmbed], components: [] });

        await supabase.from('giveaways').delete().eq('message_id', messageId);
    } catch (err) {
        console.error('Error ending giveaway:', err);
    }
}

async function restoreGiveaways(client) {
    const now = new Date().toISOString();

    const { data, error } = await supabase
        .from('giveaways')
        .select('*')
        .eq('ended', false)
        .gt('end_time', now);

    if (error) {
        console.error('Failed to fetch giveaways for restoration:', error);
        return;
    }

    if (!data || data.length === 0) {
        return; // silent
    }

    for (const g of data) {
        const endTime = new Date(g.end_time).getTime();
        const timeLeft = endTime - Date.now();

        if (timeLeft <= 0) {
            console.log(`Giveaway ${g.message_id} - ${g.prize} already ended, processing now.`);
            await endGiveawayFromDB(g, client);
        } else {
            const timeoutId = setTimeout(() => endGiveaway(g.message_id, client), timeLeft);
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
        const channel = await client.channels.fetch(g.channel_id);
        const message = await channel.messages.fetch(g.message_id);

        const entrantsArray = g.entrants || [];
        const totalEntries = entrantsArray.length;

        if (totalEntries === 0) {
            await channel.send('No one entered the giveaway. 😢');
        } else {
            const winners = [];
            const shuffled = [...entrantsArray];
            for (let i = 0; i < Math.min(g.winners_count, shuffled.length); i++) {
                const randomIndex = Math.floor(Math.random() * shuffled.length);
                winners.push(shuffled.splice(randomIndex, 1)[0]);
            }
            const winnerMentions = winners.map(id => `<@${id}>`).join(', ');
            await channel.send(`🎉 Congratulations to ${winnerMentions} for winning **${g.prize}**!`);
        }

        const embed = message.embeds[0];
        const newEmbed = EmbedBuilder.from(embed)
            .setTitle(`${g.prize} Giveaway Ended`)  // ← changed here
            .setDescription(null)
            .setColor('#808080')
            .setFooter({ text: 'Ended' })
            .setFields(
                { name: 'Hosts', value: `<@${g.host_id}>`, inline: true },
                { name: 'Winners', value: `${g.winners_count}`, inline: true },
                { name: 'Total Entries', value: `${totalEntries}`, inline: true }
            );

        if (USE_HOSTED_IMAGE) {
            newEmbed.setImage(GIVEAWAY_IMAGE_URL);
        } else {
            newEmbed.setImage(null);
        }

        await message.edit({ embeds: [newEmbed], components: [] });

        await supabase.from('giveaways').delete().eq('message_id', g.message_id);
    } catch (err) {
        console.error(`Error ending giveaway from DB ${g.message_id}:`, err);
    }
}

module.exports.handleGiveawayButton = handleGiveawayButton;
module.exports.restoreGiveaways = restoreGiveaways;