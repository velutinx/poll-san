// handlers/interactionHandler.js

const supabase = require('../services/supabase');
const helpers = require('../utils/helpers');
const giveawayCommand = require('../commands/giveaway');
const { handleShopSelect, handleShopPurchase } = require('../services/shopHandler');
const { handleSlotsBet } = require('../services/slotsHandler');
const { startHangmanGame } = require('../services/hangmanGame');

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
            else if (interaction.customId === 'mudae_roll_start') {
                await handleMudaeRoll(interaction);
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

async function handleMudaeRoll(interaction) {
    const userId = interaction.user.id;
    const username = interaction.member.displayName || interaction.user.username;
    const now = new Date();

    // Get or create user state
    let { data: userState, error } = await supabase
        .from('games_mudae_user_state')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) console.error(error);

    // Hourly reset
    if (!userState || (now - new Date(userState.last_reset)) > 60 * 60 * 1000) {
        const resetData = {
            user_id: userId,
            username: username,
            rolls_left: 5,
            claims_left: 2,
            last_reset: now.toISOString()
        };
        if (userState) {
            await supabase.from('games_mudae_user_state').update(resetData).eq('user_id', userId);
        } else {
            await supabase.from('games_mudae_user_state').insert(resetData);
        }
        userState = resetData;
    } else if (userState.username !== username) {
        // Update username if changed
        await supabase.from('games_mudae_user_state').update({ username: username }).eq('user_id', userId);
        userState.username = username;
    }

    if (userState.rolls_left <= 0) {
        return interaction.reply({ content: '❌ You have no rolls left this hour!', flags: 64 });
    }

    // Deduct roll
    await supabase.from('games_mudae_user_state').update({ rolls_left: userState.rolls_left - 1 }).eq('user_id', userId);

    // Fetch random character
    const { data: characters } = await supabase
        .from('games_mudae_characters')
        .select('*')
        .limit(1)
        .order('random()');
    const character = characters[0];

    if (!character) {
        return interaction.reply({ content: '❌ No characters in pool. Contact admin.', flags: 64 });
    }

    // Build embed
    const embed = new EmbedBuilder()
        .setTitle(`🎲 ${interaction.user.displayName} rolled:`)
        .setDescription(`**${character.name}** from *${character.series}*`)
        .setImage(character.image_url || 'https://via.placeholder.com/300?text=No+Image')
        .setColor(0x00ffcc)
        .setFooter({ text: 'React ✅ to claim | ❌ to pass' });

    const rollMsg = await interaction.channel.send({ embeds: [embed] });
    await rollMsg.react('✅');
    await rollMsg.react('❌');

    // Store active roll in memory
    const activeRolls = global.mudaeActiveRolls || new Map();
    if (!global.mudaeActiveRolls) global.mudaeActiveRolls = activeRolls;

    activeRolls.set(rollMsg.id, {
        userId: userId,
        username: username,
        characterId: character.id,
        characterName: character.name,
        series: character.series,
        expiresAt: Date.now() + 5 * 60 * 1000,
        priorityUntil: Date.now() + 10 * 1000,
        claimed: false
    });

    // Auto‑delete after 5 minutes
    setTimeout(async () => {
        const active = activeRolls.get(rollMsg.id);
        if (active && !active.claimed) {
            try {
                await rollMsg.delete();
                activeRolls.delete(rollMsg.id);
            } catch (err) {}
        }
    }, 5 * 60 * 1000);

    await interaction.deferUpdate();
}


async function handleCheckinClaim(interaction) {
    const userId = interaction.user.id;
    
    // Rate limit (5 seconds)
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
    
    // Get user data
    let { data: userData, error } = await supabase
        .from('games_user_data')
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
    
    if (!canClaim) {
        cooldownMap.delete(userId);
        return interaction.editReply({
            content: `⏳ You already claimed your daily reward! Come back in **${timeLeft}**.`
        });
    }
    
    // Add tickets & reset cooldowns
    const ticketAmount = helpers.CHECKIN_REWARD_TICKETS;
    const currentTickets = userData?.tickets || 0;
    const newBalance = currentTickets + ticketAmount;
    const nowIso = now.toISOString();
    const discordUsername = interaction.user.tag;
    const displayName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
    
    if (userData) {
        const { error: updateError } = await supabase
            .from('games_user_data')
            .update({
                tickets: newBalance,
                last_checkin: nowIso,
                wordle_last_played: null,
                hangman_last_played: null,
                trivia_last_played: null,
                updated_at: nowIso,
                discord_username: discordUsername,
                display_name: displayName,
                reminder_sent: false
            })
            .eq('user_id', userId);
        if (updateError) {
            console.error('Update error:', updateError);
            return interaction.editReply({ content: '❌ Database error. Please try again later.' });
        }
        console.log(`[Checkin] Updated user ${userId} tickets: ${currentTickets} → ${newBalance}`);
    } else {
        const { error: insertError } = await supabase
            .from('games_user_data')
            .insert({
                user_id: userId,
                tickets: newBalance,
                last_checkin: nowIso,
                wordle_last_played: null,
                hangman_last_played: null,
                trivia_last_played: null,
                updated_at: nowIso,
                discord_username: discordUsername,
                display_name: displayName,
                reminder_sent: false
            });
        if (insertError) {
            console.error('Insert error:', insertError);
            return interaction.editReply({ content: '❌ Database error. Please try again later.' });
        }
        console.log(`[Checkin] Inserted user ${userId} with tickets ${newBalance}`);
    }
    
    // Success message
    await interaction.editReply({
        content: `${helpers.releaseEmojis.VERIFY} **Daily Check-In Successful!**\n\n` +
                 `You received **${ticketAmount} tickets**! New balance: **${newBalance}** 🎫\n` +
                 `Your Wordle, Hangman, and Trivia cooldowns have been reset.`
    });
    
    setTimeout(() => cooldownMap.delete(userId), 5000);
}
