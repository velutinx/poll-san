// handlers/interactionHandler.js

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
const { handleVerifyStart } = require('../services/verifyHandler');
const { handleCheckinClaim } = require('../services/checkinHandler');

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
