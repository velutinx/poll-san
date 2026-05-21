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
    await interaction.deferReply({ flags: 64 });
    const member = interaction.member;
    const supporterRoleId = helpers.ids.roles.supporter;
    const memberRoleId = helpers.ids.roles.member;
    const hasSupporter = member.roles.cache.has(supporterRoleId);
    const hasMember = member.roles.cache.has(memberRoleId);

    if (hasSupporter || hasMember) {
        return interaction.editReply({ content: '✅ You are already verified! No need to verify again.' });
    }

    const workerUrl = process.env.VERIFY_WORKER_URL;
    if (!workerUrl) {
        return interaction.editReply({ content: '❌ Verification service is not configured.' });
    }
    const uniqueUrl = `${workerUrl}?user=${interaction.user.id}&guild=${interaction.guild.id}`;
    await interaction.editReply({
        content: `🔗 **Your verification link** (expires after 10 minutes):\n${uniqueUrl}\n\nComplete the CAPTCHA in your browser to gain access.`
    });
}

async function handleCheckinClaim(interaction) {
    const userId = interaction.user.id;
    const gameKey = userId;

    const cooldownMap = global.checkinCooldown || new Map();
    if (!global.checkinCooldown) global.checkinCooldown = cooldownMap;

    // Look for an existing valid message session to edit
    let existingSession = checkinSessions.get(gameKey);
    let hasValidSession = existingSession && (Date.now() - existingSession.timestamp < 14 * 60 * 1000);

    let finalContent = '';
    let runDatabaseCheck = true;

    // 1. Rate Limit Check (Anti-spam protection)
    const lastClick = cooldownMap.get(userId);
    if (lastClick && Date.now() - lastClick < 2000) {
        finalContent = '⏳ You’re clicking too fast!';
        runDatabaseCheck = false; // Bypass database transactions if spamming
    } else {
        cooldownMap.set(userId, Date.now());
    }

    // 2. Cooldown & Claim Verification
    if (runDatabaseCheck) {
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
                finalContent = '❌ Database error.';
            } else {
                // Reset hangman cooldown status
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
    }

    // 3. Response Execution Engine (Binds layout states together)
    let messageUpdated = false;

    if (hasValidSession) {
        try {
            // Acknowledge the instant button interaction securely 
            await interaction.deferUpdate();
            messageUpdated = true;
        } catch (err) {
            checkinSessions.delete(gameKey);
        }
    }

    if (messageUpdated) {
        try {
            // Update context onto the original active ephemeral target 
            await existingSession.interaction.webhook.editMessage(existingSession.messageId, { content: finalContent });
        } catch {
            // If the message was dismissed or expired, provide a clean replacement fallback
            const msg = await interaction.followUp({ content: finalContent, flags: 64, fetchReply: true });
            checkinSessions.set(gameKey, { interaction, messageId: msg.id, timestamp: Date.now() });
        }
    } else {
        // Build out the baseline fallback if no tracking context was found
        await interaction.deferReply({ flags: 64 });
        const msg = await interaction.editReply({ content: finalContent });
        checkinSessions.set(gameKey, { interaction, messageId: msg.id, timestamp: Date.now() });
    }

    setTimeout(() => cooldownMap.delete(userId), 2000);
}

function buildSuccessMessage(ticketAmount, newBalance) {
    return `${helpers.releaseEmojis?.VERIFY || '✅'} **Daily Check-In Successful!**\n\n` +
           `You received **${ticketAmount} tickets**! New balance: **${newBalance}** 🎫\n` +
           `Your Wordle, Hangman, and Trivia cooldowns have been reset.\n` +
           `Your Hangman ticket cooldown has also been reset – you can earn another ticket immediately!`;
}
