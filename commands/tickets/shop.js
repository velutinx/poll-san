// This is poll-san/commands/tickets/shop.js

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const h = require('../../utils/helpers');
const supabase = require('../../services/supabase');

// Define shop items (easily add more later)
const SHOP_ITEMS = [
    {
        id: 'custom_request',
        name: 'Custom Request',
        description: 'Fully custom AI art piece',
        cost: 15,
        emoji: '🎨'
    }
    // Add more items here in the future
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Browse and purchase items with your tickets'),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle(`${h.releaseEmojis.CONFETTI} Ticket Shop`)
            .setDescription('Select an item from the dropdown below to purchase.')
            .setColor('#FFD700')
            .setFooter({ text: `You have tickets? Use /tickets to check` });

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
            ephemeral: true
        });
    }
};
