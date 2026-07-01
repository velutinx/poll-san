// services/triviaService.js
const db = require('./database');
const h = require('../utils/helpers');
const { processAndUploadTriviaImage, getTriviaImageKey, SECTIONS } = require('./triviaImage');
const { putR2Image, getR2Image } = require('./r2Storage');

const DISCORD_API = 'https://discord.com/api/v10';
const LOGO_URL = h.urls.LOGO_URL;

// ─── Webhook helper ──────────────────────────────────────────
async function getWebhook(channel, name) {
    let webhook = (await channel.fetchWebhooks()).find(w => w.name === name);
    if (webhook) {
        if (webhook.name !== name || webhook.avatar !== LOGO_URL) {
            await webhook.edit({ name, avatar: LOGO_URL });
        }
        return webhook;
    }
    webhook = await channel.createWebhook({ name, avatar: LOGO_URL });
    return webhook;
}

// ─── Format hint message ─────────────────────────────────────
function formatHintMessage(hintTemplate, series) {
    if (!hintTemplate) {
        return `Yes, **${series}** is indeed his series, keep trying to guess the character name!`;
    }
    return hintTemplate.replace(/\{series\}/g, series);
}

// ─── Update the embed in Discord ─────────────────────────────
async function updateTriviaEmbed(webhook, game, sectionsVisible, imageUrl) {
    const total = game.total_sections || 12;
    const progress = Math.round((sectionsVisible / total) * 100);
    const emoji = h.releaseEmojis.PIXELSKY || '✨';

    const embed = {
        title: '🧩 Character Trivia',
        description: `${emoji} **Try to guess the character name!** ${emoji}\n\n` +
            `**Hint:** Type the **series name** (e.g., "${game.series}") to get a hint!\n\n` +
            `**Rules:**\n` +
            `• Guess the character name to win!\n` +
            `• Type the series name for a hint.\n` +
            `• A new section of the image will be revealed every **${game.interval_minutes} minute(s)**.`,
        color: 0x9B59B6,
        image: { url: imageUrl },
        footer: { text: `Game ID: ${game.id} • ${sectionsVisible}/${total} revealed (${progress}%)` },
    };

    await webhook.editMessage(game.message_id, { embeds: [embed], content: null });
}

// ─── Reveal the next section ──────────────────────────────────
async function performReveal(client, gameId) {
    const game = await db.query(
        `SELECT * FROM games_trivia WHERE id = ? AND status = 'active'`,
        [gameId],
        true
    );
    if (!game) return;

    const revealed = JSON.parse(game.revealed_sections || '[]');
    const total = game.total_sections || 12;

    if (revealed.length >= total) {
        // All sections revealed, but game not won – it will stay like this until someone guesses
        return;
    }

    // Find the next unrevealed section (random or sequential)
    // We'll do sequential: find first missing index from 0 to total-1
    let nextSection = 0;
    for (let i = 0; i < total; i++) {
        if (!revealed.includes(i)) {
            nextSection = i;
            break;
        }
    }

    revealed.push(nextSection);
    const revealedCount = revealed.length;

    // Update database
    await db.query(
        `UPDATE games_trivia SET revealed_count = ?, revealed_sections = ?, next_reveal_at = ? WHERE id = ?`,
        [
            revealedCount,
            JSON.stringify(revealed),
            new Date(Date.now() + game.interval_minutes * 60 * 1000).toISOString(),
            gameId
        ]
    );

    // Generate new image with updated revealed sections
    const originalImageBuffer = await getR2Image(game.image_key.replace(/trivia_\d+\.jpg$/, 'original.jpg'));
    const { url: newImageUrl } = await processAndUploadTriviaImage(
        originalImageBuffer,
        gameId,
        revealedCount
    );

    // Update Discord embed
    const channel = await client.channels.fetch(game.channel_id);
    const webhook = await getWebhook(channel, 'Trivia');
    await updateTriviaEmbed(webhook, game, revealedCount, newImageUrl);

    // Schedule next reveal if game still active
    if (game.status === 'active') {
        startTriviaTimer(client, gameId);
    }
}

// ─── Handle a guess in the thread ─────────────────────────────
async function handleTriviaGuess(client, message) {
    // Check if this message is in a trivia thread
    const game = await db.query(
        `SELECT * FROM games_trivia WHERE thread_id = ? AND status = 'active'`,
        [message.channel.id],
        true
    );
    if (!game) return;

    const content = message.content.trim();
    const userId = message.author.id;
    const username = message.author.username;

    // Check for exact match (character name)
    if (content.toLowerCase() === game.answer.toLowerCase()) {
        // WIN!
        await completeTriviaGame(client, game.id, userId, username);
        return;
    }

    // Check for series hint (if the message contains the series name case-insensitively)
    if (content.toLowerCase().includes(game.series.toLowerCase())) {
        // Send hint
        const hintMsg = formatHintMessage(game.hint, game.series);
        const channel = message.channel;
        const webhook = await getWebhook(channel, 'Trivia');
        await webhook.send({
            content: `${h.releaseEmojis.SPARKLES || '✨'} **Hint:** ${hintMsg}`,
            threadId: channel.id,
            username: 'Trivia',
            avatarURL: LOGO_URL,
        });
        return;
    }

    // Optional: If you want to ignore other messages, just return
}

// ─── Complete the trivia game ─────────────────────────────────
async function completeTriviaGame(client, gameId, userId, username) {
    // Update game status
    await db.query(
        `UPDATE games_trivia SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [gameId]
    );

    // Add winner
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

    // Reveal entire image
    const originalImageBuffer = await getR2Image(game.image_key.replace(/trivia_\d+\.jpg$/, 'original.jpg'));
    const total = game.total_sections || 12;
    const { url: fullImageUrl } = await processAndUploadTriviaImage(
        originalImageBuffer,
        gameId,
        total
    );

    // Send announcement
    const channel = await client.channels.fetch(game.channel_id);
    const webhook = await getWebhook(channel, 'Trivia');
    const announceMsg = `${h.releaseEmojis.SPARKLES || '🎉'} **Congratulations, <@${userId}>!** You guessed correctly! ${h.releaseEmojis.SPARKLES || '🎉'}`;
    await webhook.send({
        content: announceMsg,
        threadId: game.thread_id,
        username: 'Trivia',
        avatarURL: LOGO_URL,
    });

    // Update embed to show full image
    const embed = {
        title: '🧩 Character Trivia – Completed!',
        description: `${h.releaseEmojis.SPARKLES || '🎉'} **${username}** guessed the character: **${game.answer}**!`,
        color: 0x4ADE80,
        image: { url: fullImageUrl },
        footer: { text: `Game ended • Winner: ${username}` },
    };
    await webhook.editMessage(game.message_id, { embeds: [embed], content: null });

    // Clear timer
    if (triviaTimers.has(gameId)) {
        clearTimeout(triviaTimers.get(gameId));
        triviaTimers.delete(gameId);
    }
}

// ─── Timer management ─────────────────────────────────────────
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

// ─── Admin: reveal next section manually ──────────────────────
async function revealNextSectionAdmin(client, gameId) {
    const game = await db.query(
        `SELECT * FROM games_trivia WHERE id = ? AND status = 'active'`,
        [gameId],
        true
    );
    if (!game) throw new Error('Game not found or not active');

    const revealed = JSON.parse(game.revealed_sections || '[]');
    const total = game.total_sections || 12;
    if (revealed.length >= total) {
        throw new Error('All sections already revealed');
    }

    // Force reveal
    await performReveal(client, gameId);
}

// ─── Admin: end game ──────────────────────────────────────────
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

    // Update embed to show ended state
    const channel = await client.channels.fetch(game.channel_id);
    const webhook = await getWebhook(channel, 'Trivia');
    const embed = {
        title: '🧩 Character Trivia – Ended',
        description: `The game was ended by an admin. No winner this time.`,
        color: 0xEF4444,
    };
    await webhook.editMessage(game.message_id, { embeds: [embed], content: null });
}

module.exports = {
    getWebhook,
    formatHintMessage,
    performReveal,
    handleTriviaGuess,
    completeTriviaGame,
    startTriviaTimer,
    revealNextSectionAdmin,
    endTriviaGameAdmin,
};
