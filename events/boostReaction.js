// events/boostReaction.js
const { MessageType } = require('discord.js');
const h = require('../utils/helpers');

module.exports = async (message) => {
    if (message.type === MessageType.UserPremiumGuildSubscription) {
        try {
            await message.react(h.releaseEmojis.CONFETTI);
        } catch (err) {
            // Ignore if reaction fails (e.g., missing permissions)
        }
    }
};
