// This is poll-san/commands/tickets/shop.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const h = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('View available rewards'),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle(`${h.releaseEmojis.CONFETTI} Ticket Shop`)
            .setDescription('Spend your hard-earned tickets here!')
            .addFields(
                { name: '🎁 Character Pack (Basic)', value: '**5 tickets** - 3 character prompts', inline: true },
                { name: '🎁 Character Pack (Premium)', value: '**10 tickets** - 5 character prompts + outfit variations', inline: true },
                { name: '🎁 Custom Request', value: '**15 tickets** - Fully custom AI art piece', inline: true }
            )
            .setColor('#FFD700')
            .setFooter({ text: 'Use /buy <item> to redeem' });

        await interaction.reply({ embeds: [embed] });
    }
};
