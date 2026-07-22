// services/shopHandler.js

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const h = require('../utils/helpers');
const db = require('./database');

const SHOP_ITEMS = [
    {
        id: 'custom_request',
        name: 'Custom Request',
        description: 'Fully custom AI art piece tailored to your request.',
        cost: 15,
        emoji: '🎨'
    }
];

async function handleShopSelect(interaction) {
    await interaction.deferUpdate();

    const selectedId = interaction.values[0];
    const item = SHOP_ITEMS.find(i => i.id === selectedId);
    if (!item) {
        return interaction.followUp({ content: `${h.releaseEmojis?.BATSU || '❌'} Item not found.`, flags: MessageFlags.Ephemeral });
    }

    // Fetch ticket balance from games_user_data
    let balance = 0;
    try {
        const row = await db.query(
            `SELECT tickets FROM ${h.tables.GAMES_USER_DATA} WHERE user_id = ?`,
            [interaction.user.id],
            true
        );
        balance = row?.tickets || 0;
    } catch (err) {
        console.error('Balance fetch error in shop select:', err);
        return interaction.followUp({ content: `${h.releaseEmojis?.BATSU || '❌'} Could not retrieve your balance.`, flags: MessageFlags.Ephemeral });
    }

    const canAfford = balance >= item.cost;
    const randomCheck = h.releaseEmojis?.getRandomVerify?.() || '✅';

    const embed = new EmbedBuilder()
        .setTitle(`${item.emoji} ${item.name}`)
        .setDescription(item.description || 'No description available.')
        .addFields(
            { name: 'Cost', value: `${item.cost} Tickets`, inline: true },
            { name: 'Your Balance', value: `${balance} Tickets`, inline: true },
            { name: 'Status', value: canAfford ? `${randomCheck} You can afford this!` : `${h.releaseEmojis?.BATSU || '❌'} Insufficient tickets`, inline: false }
        )
        .setColor(canAfford ? '#00FFCC' : '#FF0000');

    const buyButton = new ButtonBuilder()
        .setCustomId('shop_buy_confirm')
        .setLabel(`Buy for ${item.cost} Tickets`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(!canAfford);

    const row = new ActionRowBuilder().addComponents(buyButton);

    await interaction.editReply({
        embeds: [embed],
        components: [row],
        flags: MessageFlags.Ephemeral
    });
}

async function handleShopPurchase(interaction) {
    await interaction.deferUpdate();

    const item = SHOP_ITEMS[0];

    // Fetch current ticket count from games_user_data
    let balance = 0;
    try {
        const row = await db.query(
            `SELECT tickets FROM ${h.tables.GAMES_USER_DATA} WHERE user_id = ?`,
            [interaction.user.id],
            true
        );
        balance = row?.tickets || 0;
    } catch (fetchError) {
        console.error('Fetch balance error:', fetchError);
        return interaction.followUp({ content: `${h.releaseEmojis?.BATSU || '❌'} Error checking balance.`, flags: MessageFlags.Ephemeral });
    }

    if (balance < item.cost) {
        return interaction.followUp({ content: `${h.releaseEmojis?.BATSU || '❌'} You do not have enough tickets.`, flags: MessageFlags.Ephemeral });
    }

    // Deduct tickets
    const newBalance = balance - item.cost;
    try {
        await db.query(
            `UPDATE ${h.tables.GAMES_USER_DATA} SET tickets = ? WHERE user_id = ?`,
            [newBalance, interaction.user.id]
        );
    } catch (deductError) {
        console.error('Deduct error:', deductError);
        return interaction.followUp({ content: `${h.releaseEmojis?.BATSU || '❌'} Purchase failed. Please try again.`, flags: MessageFlags.Ephemeral });
    }

    // Log the purchase
    try {
        await db.query(
            `INSERT INTO ${h.tables.GAMES_PURCHASES} (discord_id, discord_username, item_name, ticket_cost, status)
             VALUES (?, ?, ?, ?, ?)`,
            [interaction.user.id, interaction.user.username, item.name, item.cost, 'pending']
        );
    } catch (logError) {
        console.error('Logging error:', logError);
    }

    // Notify admin via channel
    try {
        const adminChannelId = h.ids.channels.admin_channel;
        const adminChannel = await interaction.client.channels.fetch(adminChannelId);
        await adminChannel.send({
            content: `🛒 **New Purchase!**\nUser: ${interaction.user.tag} (${interaction.user.id})\nItem: ${item.name}\nTickets: ${item.cost}\nRemaining balance: ${newBalance}`,
            allowedMentions: { users: [] }
        });
    } catch (err) {
        console.error('Could not send to admin channel:', err);
    }

    const embed = new EmbedBuilder()
        .setTitle(`${h.releaseEmojis?.getRandomVerify?.() || '✅'} Purchase Successful!`)
        .setDescription(`You bought **${item.name}** for ${item.cost} tickets.`)
        .addFields(
            { name: 'New Balance', value: `${newBalance} Tickets` },
            { name: 'Next Steps', value: 'The admin will contact you soon to fulfill your request.' }
        )
        .setColor('#00FFCC');

    await interaction.editReply({
        embeds: [embed],
        components: [],
        flags: MessageFlags.Ephemeral
    });
}

module.exports = { handleShopSelect, handleShopPurchase };
