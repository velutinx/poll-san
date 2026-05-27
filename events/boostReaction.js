// events/boostReaction.js
const { MessageType } = require('discord.js');
const h = require('../utils/helpers');

module.exports = async (message) => {
    if (message.type === MessageType.UserPremiumGuildSubscription) {
        try {
            const confettiEmoji = h.releaseEmojis?.CONFETTI || '🎉';
            await message.react(confettiEmoji);
        } catch (err) {
        }
    }
};
