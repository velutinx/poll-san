const { MessageType } = require('discord.js');
const h = require('../utils/helpers');

module.exports = async (message) => {
    const isBoost = message.type === MessageType.UserPremiumGuildSubscription ||
                    message.type === MessageType.PremiumGuildSubscription;
    if (isBoost) {
        try {
            const confettiEmoji = h.releaseEmojis?.CONFETTI || '🎉';
            await message.react(confettiEmoji);
            console.log(`🎉 Reacted to boost message from ${message.author?.tag || 'Unknown'}`);
        } catch (err) {
            console.warn('Failed to react to boost message:', err.message);
        }
    }
};
