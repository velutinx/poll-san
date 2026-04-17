// This is poll-san/commands/admin/post-wordle-ui.js

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const h = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('post_wordle_ui')
        .setDescription('[ADMIN] Posts the Wordle button interface in this channel.')
        .addChannelOption(option =>
            option.setName('voice_channel')
                .setDescription('Select the voice channel for the Wordle activity')
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const voiceChannel = interaction.options.getChannel('voice_channel');
        const guildId = interaction.guildId;

        // --- 1. Build the direct link to the Activity Shelf ---
        const activityLink = `https://discord.com/channels/${guildId}/${voiceChannel.id}`;

        // --- 2. Create the button with the direct link ---
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('🎮 Play Wordle')
                    .setStyle(ButtonStyle.Link)
                    .setURL(activityLink)
                    .setEmoji('🎮') // A little extra flair
            );

        // --- 3. Send the persistent message in the current channel ---
        await interaction.channel.send({
            content: `# 🎮 Wordle Arena\nClick the button below and then start the **Wordle** activity in the **${voiceChannel.name}** voice channel!`,
            components: [row]
        });

        // --- 4. Confirm to the admin ---
        await interaction.reply({ content: '✅ Wordle button has been posted!', flags: MessageFlags.Ephemeral });
    }
};
