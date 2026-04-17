// This is poll-san/commands/admin/post-wordle-ui.js

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const h = require('../../utils/helpers');
// 1. Import the library
const { DiscordTogether } = require('discord-together');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('post_wordle_ui')
        .setDescription('[ADMIN] Posts the Wordle button interface in this channel.')
        .addChannelOption(option =>
            option.setName('target_channel')
                .setDescription('Select the TEXT or VOICE channel to launch Wordle in.')
                // 2. Accept both text and voice channels
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice)
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const targetChannel = interaction.options.getChannel('target_channel');
        // 3. Initialize the library with your bot client
        const discordTogether = new DiscordTogether(interaction.client);

        try {
            // 4. Generate the activity invite code
            const invite = await discordTogether.createTogetherCode(targetChannel.id, 'wordle');

            // Create the button with the direct invite link
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('🎮 Play Wordle')
                        .setStyle(ButtonStyle.Link)
                        .setURL(invite.invite) // 5. Use the generated invite URL
                        .setEmoji('🎮')
                );

            const channelType = targetChannel.type === ChannelType.GuildText ? 'text' : 'voice';

            // Send the persistent message in the current channel
            await interaction.channel.send({
                content: `# 🎮 Wordle Arena\nClick the button below to start a session in the **${targetChannel.name}** ${channelType} channel!`,
                components: [row]
            });

            await interaction.reply({ content: '✅ Wordle button has been posted!', flags: MessageFlags.Ephemeral });
        } catch (error) {
            console.error('Failed to create Wordle activity:', error);
            await interaction.reply({ content: '❌ Failed to create Wordle activity. Make sure the `discord-together` library is installed.', flags: MessageFlags.Ephemeral });
        }
    }
};
