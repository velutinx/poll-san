// commands/admin/give-member-to-all.js (run once)
const { SlashCommandBuilder } = require('discord.js');
const helpers = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('give_member_to_all')
        .setDescription('[ADMIN] Give Member role to all existing non-supporters (run once)'),
    async execute(interaction) {
        if (!interaction.memberPermissions.has('Administrator')) return;
        await interaction.deferReply({ ephemeral: true });
        
        const guild = interaction.guild;
        const memberRole = guild.roles.cache.get(helpers.ids.roles.member);
        const supporterRole = guild.roles.cache.get(helpers.ids.roles.supporter);
        
        let count = 0;
        const members = await guild.members.fetch();
        for (const [, member] of members) {
            if (member.user.bot) continue;
            if (!member.roles.cache.has(supporterRole.id)) {
                if (!member.roles.cache.has(memberRole.id)) {
                    await member.roles.add(memberRole);
                    count++;
                }
            }
        }
        await interaction.editReply(`✅ Added Member role to ${count} existing members.`);
    }
};
