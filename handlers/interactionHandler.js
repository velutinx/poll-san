// handlers/interactionHandler.js

const supabase = require('../services/supabase');
const helpers = require('../utils/helpers');
const giveawayCommand = require('../commands/giveaway');
const { handleSlotsBet } = require('../services/slotsHandler');
const { startHangmanGame } = require('../services/hangmanGame');
const { handleCoinTossBet } = require('../services/coinTossHandler');
const { handleShopSelect, handleShopPurchase } = require('../services/shopHandler');
const {
    handleRedeemStart,
    handleRedeemSeries,
    handleRedeemCancel,
    handleRedeemVoteBoost,
    handleRedeemSuggestCharacter,
    handleSuggestModalSubmit
} = require('../services/redeemHandler');

const checkinSessions = new Map();
const verifySessions = new Map(); // Track verification ephemeral sessions

module.exports = async function handleInteraction(interaction) {
    try {
        if (interaction.isChatInputCommand()) {
            switch (interaction.commandName) {
                case 'level': require('../commands/level')(interaction); break;
                case 'giveaway': await giveawayCommand.execute(interaction); break;
                case 'post_slots_ui': await require('../commands/admin/post-slots-ui').execute(interaction); break;
                case 'post_hangman_ui': await require('../commands/admin/post-hangman-ui').execute(interaction); break;
                case 'post_verify_ui': await require('../commands/admin/post-verify-ui').execute(interaction); break;
                case 'post_checkin_ui': await require('../commands/admin/post-checkin-ui').execute(interaction); break;
                case 'post_cointoss_ui': await require('../commands/admin/post-cointoss-ui').execute(interaction); break;
                case 'post_redeem_ui': await require('../commands/admin/post-redeem-ui').execute(interaction); break;
                default: break;
            }
        }
        else if (interaction.isUserContextMenuCommand() && interaction.commandName === 'View Level') {
            require('../commands/level')(interaction);
        }
        else if (interaction.isButton()) {
            switch (interaction.customId) {
                case 'shop_buy_confirm': await handleShopPurchase(interaction); break;
                case 'slots_bet_1': await handleSlotsBet(interaction, 1); break;
                case 'slots_bet_5': await handleSlotsBet(interaction, 5); break;
                case 'slots_bet_25': await handleSlotsBet(interaction, 25); break;
                case 'hangman_start_button': await startHangmanGame(interaction); break;
                case 'verify_start': await handleVerifyStart(interaction); break;
                case 'checkin_claim': await handleCheckinClaim(interaction); break;
                case 'cointoss_bet_1': await handleCoinTossBet(interaction, 1); break;
                case 'cointoss_bet_5': await handleCoinTossBet(interaction, 5); break;
                case 'cointoss_bet_25': await handleCoinTossBet(interaction, 25); break;
                case 'redeem_start': await handleRedeemStart(interaction); break;
                case 'redeem_vote_power': await handleRedeemVoteBoost(interaction); break;
                case 'redeem_suggest_character': await handleRedeemSuggestCharacter(interaction); break;
                case 'redeem_cancel': await handleRedeemCancel(interaction); break;
                default: {
                    if (interaction.customId.startsWith('redeem_series_')) {
                        const index = parseInt(interaction.customId.split('_')[2]);
                        await handleRedeemSeries(interaction, index);
                    } else {
                        await giveawayCommand.handleGiveawayButton(interaction);
                    }
                }
            }
        }
        else if (interaction.isModalSubmit()) {
            if (interaction.customId === 'redeem_suggest_modal') {
                await handleSuggestModalSubmit(interaction);
            }
        }
        else if (interaction.isStringSelectMenu() && interaction.customId === 'shop_select') {
            await handleShopSelect(interaction);
        }
    } catch (err) {
        console.error('Interaction Error:', err);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred.', flags: 64 }).catch(() => {});
        }
    }
};

async function handleVerifyStart(interaction) {
    const userId = interaction.user.id;
    const verifyKey = `${userId}-${interaction.channel.id}`;

    try {
        await interaction.deferUpdate();
    } catch (error) {
        return; 
    }

    const member = interaction.member;
    const supporterRoleId = helpers.ids.roles.supporter;
    const memberRoleId = helpers.ids.roles.member;
    const hasSupporter = member.roles.cache.has(supporterRoleId);
    const hasMember = member.roles.cache.has(memberRoleId);

    let finalContent = '';

    if (hasSupporter || hasMember) {
        finalContent = `${helpers.releaseEmojis?.getRandomVerify?.() || '✅'} You are already verified! No need to verify again.`;
    } else {
        const workerUrl = process.env.VERIFY_WORKER_URL;
        if (!workerUrl) {
            finalContent = `${helpers.releaseEmojis?.BATSU || '❌'} Verification service is not configured.`;
        } else {
            const uniqueUrl = `${workerUrl}?user=${interaction.user.id}&guild=${interaction.guild.id}`;
            finalContent = `${helpers.releaseEmojis?.LINK || '🔗'} **Your verification link** (expires after 10 minutes):\n${uniqueUrl}\n\nComplete the CAPTCHA in your browser to gain access.`;
        }
    }

    // Delete the old verification message if it exists
    let session = verifySessions.get(verifyKey);
    if (session && (Date.now() - session.timestamp < 14 * 60 * 1000)) {
        try {
            await session.interaction.webhook.deleteMessage(session.messageId);
        } catch (err) {
            // Ignore if message already dismissed or expired
        }
    }

    // Send new follow-up and store the session data
    try {
        const sentMsg = await interaction.followUp({ 
            content: finalContent, 
            ephemeral: true, 
            fetchReply: true 
        });

        verifySessions.set(verifyKey, {
            interaction: interaction,
            messageId: sentMsg.id,
            timestamp: Date.now()
        });
    } catch (err) {
        console.error('Failed to send followUp for verification:', err.message);
    }
}

async function handleCheckinClaim(interaction) {
    const userId = interaction.user.id;
    const gameKey = `${userId}-${interaction.channel.id}`;
    const cooldownMap = global.checkinCooldown || new Map();
    if (!global.checkinCooldown) global.checkinCooldown = cooldownMap;
    const lastClick = cooldownMap.get(userId);
    if (lastClick && Date.now() - lastClick < 2000) {
        return; 
    }
    cooldownMap.set(userId, Date.now());

    try {
        await interaction.deferUpdate();
    } catch (error) {
        return; 
    }
    let finalContent = '';
    let { data: userData, error } = await supabase
        .from(helpers.tables.GAMES_USER_DATA)
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) console.error('Fetch error:', error);

    const now = new Date();
    let canClaim = true;
    let timeLeft = '';

    if (userData?.last_checkin) {
        const diffHours = (now - new Date(userData.last_checkin)) / (1000 * 60 * 60);
        if (diffHours < 24) {
            canClaim = false;
            const remainingMs = 24 * 60 * 60 * 1000 - (now - new Date(userData.last_checkin));
            timeLeft = `${Math.floor(remainingMs / (1000 * 60 * 60))}h ${Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60))}m`;
        }
    }

    if (!canClaim) {
        finalContent = `${helpers.releaseEmojis?.HOURGLASS || '⏳'} You already claimed your daily reward! Come back in **${timeLeft}**.`;
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
            
            if (updateError) console.error('Update error:', updateError);
            else finalContent = buildSuccessMessage(ticketAmount, newBalance);
        } else {
            const { error: insertError } = await supabase
                .from(helpers.tables.GAMES_USER_DATA)
                .insert({ user_id: userId, ...updatePayload });
            
            if (insertError) console.error('Insert error:', insertError);
            else finalContent = buildSuccessMessage(ticketAmount, newBalance);
        }

        if (finalContent === '') {
            finalContent = `${helpers.releaseEmojis?.BATSU || '❌'} Database error.`;
        } else {
            try {
                await supabase
                    .from(helpers.tables.GAMES_COOLDOWNS)
                    .delete()
                    .eq('discord_id', userId)
                    .eq('game_type', 'hangman');
            } catch (err) {
                console.error('Cooldown delete error:', err);
            }
        }
    }

    let session = checkinSessions.get(gameKey);
    if (session && (Date.now() - session.timestamp < 14 * 60 * 1000)) {
        try {
            await session.interaction.webhook.deleteMessage(session.messageId);
        } catch (err) {
        }
    }

    try {
        const sentMsg = await interaction.followUp({ 
            content: finalContent, 
            ephemeral: true, 
            fetchReply: true 
        });

        checkinSessions.set(gameKey, {
            interaction: interaction,
            messageId: sentMsg.id,
            timestamp: Date.now()
        });
    } catch (err) {
        console.error('Failed to send followUp for check-in:', err.message);
    }
    setTimeout(() => cooldownMap.delete(userId), 2000);
}

function buildSuccessMessage(ticketAmount, newBalance) {
    return `${helpers.releaseEmojis?.getRandomVerify?.() || '✅'} **Daily Check-In Successful!**\n\n` +
           `You received **${ticketAmount} tickets**! New balance: **${newBalance}** ${helpers.releaseEmojis?.TICKET || '🎫'}\n` +
           `Your Wordle, Hangman, and Trivia cooldowns have been reset.\n` +
           `Your Hangman ticket cooldown has also been reset – you can earn another ticket immediately!`;
}
