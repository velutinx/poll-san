// events/triviaGuess.js
const { handleTriviaGuess } = require('../services/triviaService');

module.exports = async (message) => {
    // Ignore bots
    if (message.author.bot) return;
    // Only handle messages in threads (or check if it's a trivia thread)
    if (!message.channel.isThread()) return;

    // Let the service decide if it's a trivia thread
    await handleTriviaGuess(message.client, message);
};
