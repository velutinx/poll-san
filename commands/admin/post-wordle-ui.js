// This is poll-san/commands/admin/post-wordle-ui.js

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType, InviteTargetType, MessageFlags } = require('discord.js');
const h = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('post_wordle_ui')
        .setDescription('[ADMIN] Posts the Wordle button interface in this channel.')
        .addChannelOption(option =>
            option.setName('voice_channel')
                .setDescription('Select the voice channel where the Wordle activity will take place')
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const voiceChannel = interaction.options.getChannel('voice_channel');
        const wordleAppId = h.games.wordle.activityAppId;

        try {
            const invite = await voiceChannel.createInvite({
                maxAge: 0,
                maxUses: 0,
                unique: true,
                targetType: InviteTargetType.EmbeddedApplication,
                targetApplication: wordleAppId
            });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('🎮 Play Wordle')
                        .setStyle(ButtonStyle.Link)
                        .setURL(invite.url)
                );

            await interaction.channel.send({
                content: `# 🎮 Wordle Arena\nClick the button below to start a session in **${voiceChannel.name}**!`,
                components: [row]
            });

            await interaction.reply({ content: '✅ Wordle button has been posted!', flags: MessageFlags.Ephemeral });
        } catch (error) {
            console.error('Failed to create Wordle invite:', error);
            await interaction.reply({ content: '❌ Failed to create Wordle invite. Ensure the bot has permission to create invites.', flags: MessageFlags.Ephemeral });
        }
    }
};
