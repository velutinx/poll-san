// services/triviaService.js
const db = require('./database');
const h = require('../utils/helpers');
const { getOriginalImage, uploadTriviaImage } = require('./triviaImage');

const LOGO_URL = h.urls.LOGO_URL;
const SECTIONS = 12;

function formatHintMessage(hintTemplate, series) {
    if (!hintTemplate) {
        return `Yes, **${series}** is indeed his series, keep trying to guess the character name!`;
    }
    return hintTemplate.replace(/\{series\}/g, series);
}

async function updateTriviaEmbed(client, game, imageUrl) {
    const emoji = h.releaseEmojis.PIXELSKY || '✨';
    const embed = {
        description: `${emoji} **Try to guess the character name!** ${emoji}\n\n` +
            `**Rules:**\n` +
            `• Guess the character name to win!\n` +
            `• Type the series name for a hint.\n` +
            `• A new section of the image will be revealed every **${game.interval_minutes} minute(s)**.`,
        color: 0x9B59B6,
        image: { url: `${imageUrl}?t=${Date.now()}` },
    };

    // Debug: log the stored credentials and message_id
    console.log(`🔍 Debug: game ${game.id}, webhook_id=${game.webhook_id || 'missing'}, webhook_token=${game.webhook_token ? 'exists' : 'missing'}, message_id=${game.message_id}`);

    // Try using the dedicated webhook
    if (game.webhook_id && game.webhook_token) {
        try {
            const webhook = await client.fetchWebhook(game.webhook_id, game.webhook_token);
            await webhook.editMessage(game.message_id, { embeds: [embed], content: null });
            console.log(`✅ Updated embed for game ${game.id}`);
            return true;
        } catch (err) {
            console.error(`Webhook edit failed for game ${game.id}:`, err.message);
        }
    }

    // Fallback: send a new message in the thread and update message_id
    try {
        const channel = await client.channels.fetch(game.channel_id);
        const webhookName = `Trivia-${game.id}`;
        let webhook = (await channel.fetchWebhooks()).find(w => w.name === webhookName);
        if (!webhook) {
            webhook = await channel.createWebhook({
                name: webhookName,
                avatar: LOGO_URL,
            });
            const updateResult = await db.query(
                `UPDATE games_trivia SET webhook_id = ?, webhook_token = ? WHERE id = ?`,
                [webhook.id, webhook.token, game.id]
            );
            console.log(`🔍 Updated webhook credentials for game ${game.id}, result:`, updateResult);
            // Update the game object with new webhook credentials
            game.webhook_id = webhook.id;
            game.webhook_token = webhook.token;
        }
        const newMessage = await webhook.send({
            embeds: [embed],
            threadId: game.thread_id,
            username: 'Trivia',
            avatarURL: LOGO_URL,
        });
        // Update message_id in the database
        const updateResult = await db.query(
            `UPDATE games_trivia SET message_id = ? WHERE id = ?`,
            [newMessage.id, game.id]
        );
        console.log(`🔍 Updated message_id to ${newMessage.id} for game ${game.id}, result:`, updateResult);
        // Update the game object so subsequent attempts use the new message_id
        game.message_id = newMessage.id;
        console.log(`✅ Sent new embed message for game ${game.id}`);
        return true;
    } catch (err) {
        console.error(`Failed to send new message for game ${game.id}:`, err.message);
        return false;
    }
}

async function performReveal(client, gameId) {
    const game = await db.query(
        `SELECT * FROM games_trivia WHERE id = ? AND status = 'active'`,
        [gameId],
        true
    );
    if (!game) {
        console.warn(`Game ${gameId} not found or not active.`);
        return;
    }

    const revealOrder = JSON.parse(game.reveal_order || '[]');
    const revealedSections = JSON.parse(game.revealed_sections || '[]');
    const total = game.total_sections || SECTIONS;

    if (revealedSections.length >= total) {
        console.log(`Game ${gameId} already fully revealed.`);
        return;
    }

    const nextIndex = revealedSections.length;
    const nextSection = revealOrder[nextIndex];
    if (nextSection === undefined) {
        for (let i = 0; i < total; i++) {
            if (!revealedSections.includes(i)) {
                revealedSections.push(i);
                break;
            }
        }
    } else {
        revealedSections.push(nextSection);
    }

    await db.query(
        `UPDATE games_trivia SET revealed_sections = ?, revealed_count = ?, next_reveal_at = ? WHERE id = ?`,
        [
            JSON.stringify(revealedSections),
            revealedSections.length,
            new Date(Date.now() + game.interval_minutes * 60 * 1000).toISOString(),
            gameId
        ]
    );

    const folderName = `trivia_${gameId}`;
    const originalImageBuffer = await getOriginalImage(folderName);
    const { url: imageUrl } = await uploadTriviaImage(originalImageBuffer, folderName, revealedSections);

    await updateTriviaEmbed(client, game, imageUrl);

    if (game.status === 'active') {
        await startTriviaTimer(client, gameId);
    }
}

// ... (the rest of the file remains unchanged) ...
async function handleTriviaGuess(client, message) {
    const game = await db.query(
        `SELECT * FROM games_trivia WHERE thread_id = ? AND status = 'active'`,
        [message.channel.id],
        true
    );
    if (!game) return;

    const content = message.content.trim();
    const userId = message.author.id;
    const username = message.author.username;

    if (content.toLowerCase() === game.answer.toLowerCase()) {
        await completeTriviaGame(client, game.id, userId, username);
        return;
    }

    if (content.toLowerCase().includes(game.series.toLowerCase())) {
        const hintMsg = formatHintMessage(game.hint, game.series);
        const channel = message.channel;
        const webhookName = `Trivia-${game.id}`;
        let webhook = (await channel.fetchWebhooks()).find(w => w.name === webhookName);
        if (!webhook) {
            webhook = await channel.createWebhook({
                name: webhookName,
                avatar: LOGO_URL,
            });
        }
        await webhook.send({
            content: `${h.releaseEmojis.SPARKLES || '✨'} **Hint:** ${hintMsg}`,
            threadId: channel.id,
            username: 'Trivia',
            avatarURL: LOGO_URL,
        });
        return;
    }
}

async function completeTriviaGame(client, gameId, userId, username) {
    await db.query(
        `UPDATE games_trivia SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [gameId]
    );

    const game = await db.query(
        `SELECT * FROM games_trivia WHERE id = ?`,
        [gameId],
        true
    );

    const winners = JSON.parse(game.winners || '[]');
    winners.push({ user_id: userId, username, guessed_at: new Date().toISOString() });
    await db.query(
        `UPDATE games_trivia SET winners = ? WHERE id = ?`,
        [JSON.stringify(winners), gameId]
    );

    try {
        const thread = await client.channels.fetch(game.thread_id);
        if (thread && thread.isThread()) {
            await thread.setName(`🧩 Trivia: ${game.answer}`);
        }
    } catch (err) {
        console.warn(`Could not rename thread ${game.thread_id}:`, err.message);
    }

    const folderName = `trivia_${gameId}`;
    const totalSections = game.total_sections || SECTIONS;
    const allSections = Array.from({ length: totalSections }, (_, i) => i);
    const originalImageBuffer = await getOriginalImage(folderName);
    const { url: fullImageUrl } = await uploadTriviaImage(originalImageBuffer, folderName, allSections);

    const channel = await client.channels.fetch(game.channel_id);
    const webhookName = `Trivia-${game.id}`;
    let webhook = (await channel.fetchWebhooks()).find(w => w.name === webhookName);
    if (!webhook) {
        webhook = await channel.createWebhook({
            name: webhookName,
            avatar: LOGO_URL,
        });
    }

    const announceMsg = `${h.releaseEmojis.SPARKLES || '🎉'} **Congratulations, <@${userId}>!** You guessed correctly! ${h.releaseEmojis.SPARKLES || '🎉'}`;
    await webhook.send({
        content: announceMsg,
        threadId: game.thread_id,
        username: 'Trivia',
        avatarURL: LOGO_URL,
    });

    const embed = {
        description: `${h.releaseEmojis.SPARKLES || '🎉'} **${username}** guessed the character: **${game.answer}**!`,
        color: 0x4ADE80,
        image: { url: `${fullImageUrl}?t=${Date.now()}` },
    };
    await webhook.editMessage(game.message_id, { embeds: [embed], content: null });

    if (triviaTimers.has(gameId)) {
        clearTimeout(triviaTimers.get(gameId));
        triviaTimers.delete(gameId);
    }
}

const triviaTimers = new Map();

async function startTriviaTimer(client, gameId) {
    if (triviaTimers.has(gameId)) {
        clearTimeout(triviaTimers.get(gameId));
        triviaTimers.delete(gameId);
    }

    const game = await db.query(
        `SELECT * FROM games_trivia WHERE id = ? AND status = 'active'`,
        [gameId],
        true
    );
    if (!game) return;

    const now = Date.now();
    const nextReveal = new Date(game.next_reveal_at).getTime();
    const delay = Math.max(0, nextReveal - now);

    const timer = setTimeout(async () => {
        await performReveal(client, gameId);
    }, delay);

    triviaTimers.set(gameId, timer);
}

async function revealNextSectionAdmin(client, gameId) {
    const game = await db.query(
        `SELECT * FROM games_trivia WHERE id = ? AND status = 'active'`,
        [gameId],
        true
    );
    if (!game) throw new Error('Game not found or not active');
    await performReveal(client, gameId);
}

async function endTriviaGameAdmin(client, gameId) {
    const game = await db.query(
        `SELECT * FROM games_trivia WHERE id = ? AND status = 'active'`,
        [gameId],
        true
    );
    if (!game) throw new Error('Game not found or already ended');

    await db.query(
        `UPDATE games_trivia SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [gameId]
    );

    if (triviaTimers.has(gameId)) {
        clearTimeout(triviaTimers.get(gameId));
        triviaTimers.delete(gameId);
    }

    const channel = await client.channels.fetch(game.channel_id);
    const webhookName = `Trivia-${game.id}`;
    let webhook = (await channel.fetchWebhooks()).find(w => w.name === webhookName);
    if (!webhook) {
        webhook = await channel.createWebhook({
            name: webhookName,
            avatar: LOGO_URL,
        });
    }
    const embed = {
        description: `The game was ended by an admin. No winner this time.`,
        color: 0xEF4444,
    };
    try {
        await webhook.editMessage(game.message_id, { embeds: [embed], content: null });
    } catch (err) {
        console.warn(`Could not edit message ${game.message_id}:`, err.message);
        await webhook.send({
            embeds: [embed],
            threadId: game.thread_id,
            username: 'Trivia',
            avatarURL: LOGO_URL,
        });
    }
}

module.exports = {
    formatHintMessage,
    performReveal,
    handleTriviaGuess,
    completeTriviaGame,
    startTriviaTimer,
    revealNextSectionAdmin,
    endTriviaGameAdmin,
};
