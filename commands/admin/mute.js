// commands/admin/mute.js
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const helpers = require('../../utils/helpers');
const { applyDenyOverwrites } = require('../../features/avatarScanner');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mute')
        .setDescription('[ADMIN] Mutes a user from the restricted channels.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to mute')
                .setRequired(true)
        ),

    async execute(interaction) {
        if (!interaction.memberPermissions.has('Administrator')) {
            return interaction.reply({
                content: `${helpers.releaseEmojis?.BATSU || '❌'} Admin only.`,
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const targetUser = interaction.options.getUser('user');

        let member;
        try {
            member = await interaction.guild.members.fetch(targetUser.id);
        } catch {
            return interaction.editReply({
                content: `${helpers.releaseEmojis?.BATSU || '❌'} User not found in this server.`
            });
        }

        if (member.user.bot) {
            return interaction.editReply({
                content: `${helpers.releaseEmojis?.BATSU || '❌'} You can't mute a bot.`
            });
        }

        if (member.id === interaction.guild.ownerId) {
            return interaction.editReply({
                content: `${helpers.releaseEmojis?.BATSU || '❌'} You can't mute the server owner.`
            });
        }

        try {
            await applyDenyOverwrites(interaction.guild, member);
            return interaction.editReply({
                content: `${helpers.releaseEmojis?.getRandomVerify?.() || '✅'} <@${member.id}> is now muted from the restricted channels. Use \`/unmute\` to restore access.`
            });
        } catch (err) {
            console.error('[Mute] Error:', err);
            return interaction.editReply({
                content: `${helpers.releaseEmojis?.BATSU || '❌'} Failed to mute: ${err.message}`
            });
        }
    }
};
