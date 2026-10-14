// commands/admin/unmute.js
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const helpers = require('../../utils/helpers');
const { removeDenyOverwrites } = require('../../features/avatarScanner');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('[ADMIN] Removes the mute from a user.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to unmute')
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

        try {
            await removeDenyOverwrites(interaction.guild, member);
            return interaction.editReply({
                content: `${helpers.releaseEmojis?.getRandomVerify?.() || '✅'} <@${member.id}> has been unmuted.`
            });
        } catch (err) {
            console.error('[Unmute] Error:', err);
            return interaction.editReply({
                content: `${helpers.releaseEmojis?.BATSU || '❌'} Failed to unmute: ${err.message}`
            });
        }
    }
};
