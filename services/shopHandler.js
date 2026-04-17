// This is poll-san/services/shopHandler.js

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const h = require('../utils/helpers');
const supabase = require('./supabase');

// Shop items definition (same as in shop command)
const SHOP_ITEMS = [
    {
        id: 'custom_request',
        name: 'Custom Request',
        description: 'Fully custom AI art piece tailored to your request.',
        cost: 15,
        emoji: '🎨'
    }
    // Add more items here in the future
];

/**
 * Handle item selection from the dropdown
 */
async function handleShopSelect(interaction) {
    const selectedId = interaction.values[0];
    const item = SHOP_ITEMS.find(i => i.id === selectedId);
    if (!item) {
        return interaction.reply({ content: '❌ Item not found.', flags: { ephemeral: true } });
    }

    // Check user's ticket balance
    const { data: userData, error } = await supabase
        .from('games_wordle')
        .select('ticket_count')
        .eq('discord_id', interaction.user.id)
        .maybeSingle();

    if (error) {
        console.error('Balance fetch error in shop select:', error);
        return interaction.reply({ content: '❌ Could not retrieve your balance.', flags: { ephemeral: true } });
    }

    const balance = userData?.ticket_count || 0;

    // Ensure description exists
    const itemDescription = item.description || 'No description available.';

    const embed = new EmbedBuilder()
        .setTitle(`${item.emoji} ${item.name}`)
        .setDescription(itemDescription)
        .addFields(
            { name: 'Cost', value: `${item.cost} Tickets`, inline: true },
            { name: 'Your Balance', value: `${balance} Tickets`, inline: true },
            { name: 'Status', value: balance >= item.cost ? '✅ You can afford this!' : '❌ Insufficient tickets', inline: false }
        )
        .setColor(balance >= item.cost ? '#00FFCC' : '#FF0000');

    const buyButton = new ButtonBuilder()
        .setCustomId('shop_buy_confirm')
        .setLabel(`Buy for ${item.cost} Tickets`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(balance < item.cost);

    const row = new ActionRowBuilder().addComponents(buyButton);

    await interaction.update({
        embeds: [embed],
        components: [row],
        flags: MessageFlags.Ephemeral
    });
}

async function handleShopPurchase(interaction) {
    // For now, only one item exists, but we can prepare for future expansion
    const item = SHOP_ITEMS[0]; // Custom Request

    // Get user's current balance
    const { data: userData, error: fetchError } = await supabase
        .from('games_wordle')
        .select('ticket_count')
        .eq('discord_id', interaction.user.id)
        .maybeSingle();

    if (fetchError) {
        console.error('Fetch balance error:', fetchError);
        return interaction.reply({ content: '❌ Error checking balance.', flags: { ephemeral: true } });
    }

    const balance = userData?.ticket_count || 0;

    if (balance < item.cost) {
        return interaction.reply({ content: '❌ You do not have enough tickets.', flags: { ephemeral: true } });
    }

    // Deduct tickets using RPC (atomic)
    const { data: newBalance, error: deductError } = await supabase
        .rpc('deduct_tickets', { user_id: interaction.user.id, amount: item.cost });

    if (deductError) {
        console.error('Deduct error:', deductError);
        return interaction.reply({ content: '❌ Purchase failed. Please try again.', flags: { ephemeral: true } });
    }

    // Log purchase
    const { error: logError } = await supabase
        .from('games_purchases')
        .insert({
            discord_id: interaction.user.id,
            discord_username: interaction.user.username,
            item_name: item.name,
            ticket_cost: item.cost,
            status: 'pending'
        });

    if (logError) {
        console.error('Logging error:', logError);
        // Continue anyway, but notify admin
    }

    // Notify admin (you) via DM
    try {
        const adminUser = await interaction.client.users.fetch(h.ids.users.Velutinx);
        await adminUser.send(`🛒 **New Purchase!**\nUser: ${interaction.user.tag} (${interaction.user.id})\nItem: ${item.name}\nTickets: ${item.cost}\nRemaining balance: ${newBalance}`);
    } catch (err) {
        console.error('Could not DM admin:', err);
    }

    // Confirm to user
    const embed = new EmbedBuilder()
        .setTitle('✅ Purchase Successful!')
        .setDescription(`You bought **${item.name}** for ${item.cost} tickets.`)
        .addFields(
            { name: 'New Balance', value: `${newBalance} Tickets` },
            { name: 'Next Steps', value: 'The admin will contact you soon to fulfill your request.' }
        )
        .setColor('#00FFCC');

    await interaction.update({
        embeds: [embed],
        components: [],
        flags: MessageFlags.Ephemeral
    });
}

module.exports = { handleShopSelect, handleShopPurchase };
