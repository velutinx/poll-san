// This is poll-san/commands/admin/post-wordle-ui.js

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType, InviteTargetType } = require('discord.js');
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
            // Generate a permanent invite to the embedded activity
            const invite = await voiceChannel.createInvite({
                maxAge: 0,                     // Never expires
                maxUses: 0,                    // Unlimited uses
                unique: true,                  // Create a new unique invite each time
                targetType: InviteTargetType.EmbeddedApplication,
                targetApplication: wordleAppId
            });

            // Create the button with the invite link
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('🎮 Play Wordle')
                        .setStyle(ButtonStyle.Link)
                        .setURL(invite.url)
                );

            // Send the persistent message in the current channel
            await interaction.channel.send({
                content: `# 🎮 Wordle Arena\nClick the button below to start a session in **${voiceChannel.name}**!`,
                components: [row]
            });

            // Confirm to the admin (ephemeral)
            await interaction.reply({ content: '✅ Wordle button has been posted!', flags: { ephemeral: true } });
        } catch (error) {
            console.error('Failed to create Wordle invite:', error);
            await interaction.reply({ content: '❌ Failed to create Wordle invite. Ensure the bot has permission to create invites.', flags: { ephemeral: true } });
        }
    }
};
