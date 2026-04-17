// This is poll-san/commands/tickets/shop.js

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const h = require('../../utils/helpers');

const SHOP_ITEMS = [
    {
        id: 'custom_request',
        name: 'Custom Request',
        description: 'Fully custom AI art piece tailored to your request.',
        cost: 15,
        emoji: '🎨'
    }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Browse and purchase items with your tickets'),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle(`${h.releaseEmojis.CHAT} Ticket Shop ${h.releaseEmojis.CHAT}`)
            .setDescription('Select an item from the dropdown below to purchase.')
            .setColor('#FFD700')
            .setFooter({ text: 'Use /tickets to check your balance' });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('shop_select')
            .setPlaceholder('Choose an item to buy...')
            .addOptions(
                SHOP_ITEMS.map(item => ({
                    label: `${item.name} — ${item.cost} Tickets`,
                    description: item.description,
                    value: item.id,
                    emoji: item.emoji
                }))
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
            embeds: [embed],
            components: [row],
            flags: MessageFlags.Ephemeral
        });
    }
};
