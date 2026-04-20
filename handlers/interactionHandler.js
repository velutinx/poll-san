// handlers/interactionHandler.js
const supabase = require('../services/supabase');
const helpers = require('../utils/helpers');
const giveawayCommand = require('../commands/giveaway');
const { handleShopSelect, handleShopPurchase } = require('../services/shopHandler');
const { handleSlotsBet } = require('../services/slotsHandler');
const { startHangmanGame } = require('../services/hangmanGame');
const { handleTriviaMessage, processEndOfDayAwards } = require('../services/triviaJanitor'); // if needed

module.exports = async function handleInteraction(interaction) {
    try {
        // Chat input commands
        if (interaction.isChatInputCommand()) {
            switch (interaction.commandName) {
                case 'level': require('../commands/level')(interaction); break;
                case 'giveaway': await giveawayCommand.execute(interaction); break;
                case 'tickets': await require('../commands/tickets/balance').execute(interaction); break;
                case 'shop': await require('../commands/tickets/shop').execute(interaction); break;
                case 'slots': await require('../commands/games/slots').execute(interaction); break;
                case 'post_slots_ui': await require('../commands/admin/post-slots-ui').execute(interaction); break;
                case 'post_hangman_ui': await require('../commands/admin/post-hangman-ui').execute(interaction); break;
                case 'post_verify_ui': await require('../commands/admin/post-verify-ui').execute(interaction); break;
                case 'post_checkin_ui': await require('../commands/admin/post-checkin-ui').execute(interaction); break;
                default: break;
            }
        }
        // User context menu
        else if (interaction.isUserContextMenuCommand() && interaction.commandName === 'View Level') {
            require('../commands/level')(interaction);
        }
        // Buttons
        else if (interaction.isButton()) {
            if (interaction.customId === 'shop_buy_confirm') {
                await handleShopPurchase(interaction);
            } 
            else if (interaction.customId === 'slots_bet_1') {
                await handleSlotsBet(interaction, 1);
            } 
            else if (interaction.customId === 'slots_bet_5') {
                await handleSlotsBet(interaction, 5);
            } 
            else if (interaction.customId === 'slots_bet_25') {
                await handleSlotsBet(interaction, 25);
            } 
            else if (interaction.customId === 'hangman_start_button') {
                await startHangmanGame(interaction);
            } 
            else if (interaction.customId === 'verify_start') {
                await handleVerifyStart(interaction);
            } 
            else if (interaction.customId === 'checkin_claim') {
                await handleCheckinClaim(interaction);
            } 
            else {
                await giveawayCommand.handleGiveawayButton(interaction);
            }
        }
        // Select menus
        else if (interaction.isStringSelectMenu() && interaction.customId === 'shop_select') {
            await handleShopSelect(interaction);
        }
    } catch (err) {
        console.error('Interaction Error:', err);
        // Avoid double-reply if already replied
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred.', ephemeral: true }).catch(() => {});
        }
    }
};

// ----- Helper functions for button handlers -----
async function handleVerifyStart(interaction) {
    const member = interaction.member;
    const supporterRoleId = helpers.ids.roles.supporter;
    const memberRoleId = helpers.ids.roles.member;
    const hasSupporter = member.roles.cache.has(supporterRoleId);
    const hasMember = member.roles.cache.has(memberRoleId);
    
    if (hasSupporter || hasMember) {
        return interaction.reply({
            content: '✅ You are already verified! No need to verify again.',
            flags: 64
        });
    }
    
    const workerUrl = process.env.VERIFY_WORKER_URL;
    if (!workerUrl) {
        return interaction.reply({
            content: '❌ Verification service is not configured. Please contact an admin.',
            flags: 64
        });
    }
    const uniqueUrl = `${workerUrl}?user=${interaction.user.id}&guild=${interaction.guild.id}`;
    await interaction.reply({
        content: `🔗 **Your verification link** (expires after 10 minutes):\n${uniqueUrl}\n\nComplete the CAPTCHA in your browser to gain access.`,
        flags: 64
    });
}

async function handleCheckinClaim(interaction) {
    const userId = interaction.user.id;
    
    // Rate limiting (memory)
    const cooldownMap = global.checkinCooldown || new Map();
    if (!global.checkinCooldown) global.checkinCooldown = cooldownMap;
    const lastClick = cooldownMap.get(userId);
    if (lastClick && Date.now() - lastClick < 5000) {
        return interaction.reply({
            content: '⏳ You’re clicking too fast! Please wait a few seconds.',
            flags: 64
        });
    }
    cooldownMap.set(userId, Date.now());
    
    await interaction.deferReply({ flags: 64 });
    
    // Database cooldown check
    const { data: checkin, error } = await supabase
        .from('games_daily_checkins')
        .select('last_checkin')
        .eq('user_id', userId)
        .maybeSingle();
    
    if (error) console.error('Checkin DB error:', error);
    
    const now = new Date();
    let canClaim = true;
    let timeLeft = '';
    
    if (checkin && checkin.last_checkin) {
        const last = new Date(checkin.last_checkin);
        const diffMs = now - last;
        const diffHours = diffMs / (1000 * 60 * 60);
        if (diffHours < 24) {
            canClaim = false;
            const remainingMs = 24 * 60 * 60 * 1000 - diffMs;
            const hoursLeft = Math.floor(remainingMs / (1000 * 60 * 60));
            const minutesLeft = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
            timeLeft = `${hoursLeft}h ${minutesLeft}m`;
        }
    }
    
    if (!canClaim) {
        cooldownMap.delete(userId);
        return interaction.editReply({
            content: `⏳ You already claimed your daily reward! Come back in **${timeLeft}**.`
        });
    }
    
    // Add tickets
    const ticketAmount = helpers.CHECKIN_REWARD_TICKETS;
    const { data: userTickets } = await supabase
        .from('user_tickets')
        .select('balance')
        .eq('user_id', userId)
        .maybeSingle();
    
    if (userTickets) {
        await supabase
            .from('user_tickets')
            .update({ balance: userTickets.balance + ticketAmount })
            .eq('user_id', userId);
    } else {
        await supabase
            .from('user_tickets')
            .insert({ user_id: userId, balance: ticketAmount });
    }
    
    // Reset game cooldowns (database)
    const gameTables = ['wordle_stats', 'hangman_stats', 'trivia_stats'];
    for (const table of gameTables) {
        await supabase
            .from(table)
            .update({ last_played: null, cooldown_end: null })
            .eq('user_id', userId);
    }
    
    // Update last checkin
    await supabase
        .from('games_daily_checkins')
        .upsert({ user_id: userId, last_checkin: now.toISOString() }, { onConflict: 'user_id' });
    
    await interaction.editReply({
        content: `${helpers.releaseEmojis.VERIFY} **Daily Check-In Successful!**\n\n` +
                 `You received **${ticketAmount} tickets**! 🎫\n` +
                 `Your Wordle, Hangman, and Trivia cooldowns have been reset.`
    });
    
    // Clean up rate limit after 5 seconds
    setTimeout(() => cooldownMap.delete(userId), 5000);
}
