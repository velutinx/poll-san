// handlers/interactionHandler.js

const supabase = require('../services/supabase');
const helpers = require('../utils/helpers');
const giveawayCommand = require('../commands/giveaway');
const { handleSlotsBet } = require('../services/slotsHandler');
const { startHangmanGame } = require('../services/hangmanGame');
const { handleCoinTossBet } = require('../services/coinTossHandler');
const { handleShopSelect, handleShopPurchase } = require('../services/shopHandler');
const { handleRedeemStart, handleRedeemSeries, handleRedeemCancel } = require('../services/redeemHandler');

// Store checkin sessions to update the same ephemeral message
const checkinSessions = new Map(); // key: userId -> { interaction, messageId, timestamp }

module.exports = async function handleInteraction(interaction) {
    try {
        // Chat input commands
        if (interaction.isChatInputCommand()) {
            switch (interaction.commandName) {
                case 'level': require('../commands/level')(interaction); break;
                case 'giveaway': await giveawayCommand.execute(interaction); break;
                case 'tickets': await require('../commands/tickets/balance').execute(interaction); break;
                case 'shop': await require('../commands/tickets/shop').execute(interaction); break;
                case 'post_slots_ui': await require('../commands/admin/post-slots-ui').execute(interaction); break;
                case 'post_hangman_ui': await require('../commands/admin/post-hangman-ui').execute(interaction); break;
                case 'post_verify_ui': await require('../commands/admin/post-verify-ui').execute(interaction); break;
                case 'post_checkin_ui': await require('../commands/admin/post-checkin-ui').execute(interaction); break;
                case 'post_cointoss_ui': await require('../commands/admin/post-cointoss-ui').execute(interaction); break;
                case 'post_redeem_ui': await require('../commands/admin/post-redeem-ui').execute(interaction); break;
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
            else if (interaction.customId === 'cointoss_bet_1') {
                await handleCoinTossBet(interaction, 1);
            }
            else if (interaction.customId === 'cointoss_bet_5') {
                await handleCoinTossBet(interaction, 5);
            }
            else if (interaction.customId === 'cointoss_bet_25') {
                await handleCoinTossBet(interaction, 25);
            }
            // ----- Redeem flow -----
            else if (interaction.customId === 'redeem_start') {
                await handleRedeemStart(interaction);
            }
            else if (interaction.customId.startsWith('redeem_series_')) {
                const index = parseInt(interaction.customId.split('_')[2]);
                await handleRedeemSeries(interaction, index);
            }
            else if (interaction.customId === 'redeem_cancel') {
                await handleRedeemCancel(interaction);
            }
            // -----------------------
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
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred.', ephemeral: true }).catch(() => {});
        }
    }
};

// ----- Helper functions -----
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
    const gameKey = userId;
    
    // Rate limit (2 seconds)
    const cooldownMap = global.checkinCooldown || new Map();
    if (!global.checkinCooldown) global.checkinCooldown = cooldownMap;
    const lastClick = cooldownMap.get(userId);
    if (lastClick && Date.now() - lastClick < 2000) {
        return interaction.reply({
            content: '⏳ You’re clicking too fast! Please wait a moment.',
            flags: 64
        });
    }
    cooldownMap.set(userId, Date.now());

    // 1. Decide to deferUpdate (edit existing) or deferReply (create new)
    let existingSession = checkinSessions.get(gameKey);
    let messageUpdated = false;

    if (existingSession && (Date.now() - existingSession.timestamp < 14 * 60 * 1000)) {
        try {
            await interaction.deferUpdate();
            messageUpdated = true;
        } catch (err) {
            // Ignore if webhook/interaction expired, handled below
            checkinSessions.delete(gameKey);
        }
    }

    if (!messageUpdated) {
        await interaction.deferReply({ flags: 64 });
    }
    
    // Get user data
    let { data: userData, error } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
    
    if (error) console.error('Fetch error:', error);
    
    const now = new Date();
    let canClaim = true;
    let timeLeft = '';
    
    if (userData && userData.last_checkin) {
        const last = new Date(userData.last_checkin);
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
    
    let finalContent = '';

    if (!canClaim) {
        finalContent = `⏳ You already claimed your daily reward! Come back in **${timeLeft}**.`;
    } else {
        const ticketAmount = helpers.CHECKIN_REWARD_TICKETS;
        const currentTickets = userData?.tickets || 0;
        const newBalance = currentTickets + ticketAmount;
        const nowIso = now.toISOString();
        const discordUsername = interaction.user.tag;
        const displayName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
        
        const updatePayload = {
            tickets: newBalance,
            last_checkin: nowIso,
            wordle_last_played: null,
            hangman_last_played: null,
            trivia_last_played: null,
            updated_at: nowIso,
            discord_username: discordUsername,
            display_name: displayName,
            reminder_sent: false
        };

        if (userData) {
            const { error: updateError } = await supabase
                .from(helpers.tables.GAMES_USER_DATA)
                .update(updatePayload)
                .eq('user_id', userId);
            if (updateError) {
                console.error('Update error:', updateError);
                finalContent = '❌ Database error. Please try again later.';
            } else {
           //     console.log(`[Checkin] Updated user ${userId} tickets: ${currentTickets} → ${newBalance}`);
            }
        } else {
            const { error: insertError } = await supabase
                .from(helpers.tables.GAMES_USER_DATA)
                .insert({ user_id: userId, ...updatePayload });
            if (insertError) {
                console.error('Insert error:', insertError);
                finalContent = '❌ Database error. Please try again later.';
            } else {
       ///         console.log(`[Checkin] Inserted user ${userId} with tickets ${newBalance}`);
            }
        }
        
        // --- RESET HANGMAN COOLDOWN ---
        if (!finalContent.includes('Database error')) {
            const { error: deleteError } = await supabase
                .from(helpers.tables.GAMES_COOLDOWNS)
                .delete()
                .eq('discord_id', userId)
                .eq('game_type', 'hangman');
            if (deleteError) {
                console.error('Cooldown delete error:', deleteError);
            } else {
                console.log(`[Checkin] Deleted hangman cooldown for ${userId}`);
            }

            finalContent = `${helpers.releaseEmojis?.VERIFY || '✅'} **Daily Check-In Successful!**\n\n` +
                           `You received **${ticketAmount} tickets**! New balance: **${newBalance}** 🎫\n` +
                           `Your Wordle, Hangman, and Trivia cooldowns have been reset.\n` +
                           `Your Hangman ticket cooldown has also been reset – you can earn another ticket immediately!`;
        }
    }
    
    // 2. Final Execution: Edit vs FollowUp/EditReply
    if (messageUpdated) {
        try {
            await existingSession.interaction.webhook.editMessage(existingSession.messageId, { content: finalContent });
        } catch (err) {
            // Fallback
            const msg = await interaction.followUp({ content: finalContent, flags: 64, fetchReply: true });
            checkinSessions.set(gameKey, { interaction, messageId: msg.id, timestamp: Date.now() });
        }
    } else {
        // Because we used deferReply earlier, we use editReply here
        const msg = await interaction.editReply({ content: finalContent });
        checkinSessions.set(gameKey, { interaction, messageId: msg.id, timestamp: Date.now() });
    }
    
    setTimeout(() => cooldownMap.delete(userId), 2000);
}
