const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('View available rewards'),

    async execute(interaction) {
        const embed = {
            title: '🎁 Ticket Shop',
            description: 'Spend your tickets here!',
            fields: [
                { name: 'Character Pack (Basic)', value: '5 tickets - 3 character prompts', inline: true },
                { name: 'Character Pack (Premium)', value: '10 tickets - 5 character prompts + outfit variations', inline: true },
                { name: 'Custom Request', value: '15 tickets - Fully custom AI art piece', inline: true }
            ],
            color: 0xFFD700
        };

        await interaction.reply({ embeds: [embed] });
    }
};
