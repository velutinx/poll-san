// services/triviaService.js
const db = require('./database');
const h = require('../utils/helpers');
const { getR2Image } = require('./r2Storage');
const { updateTriviaImage, SECTIONS } = require('./triviaImage');

const LOGO_URL = h.urls.LOGO_URL;
const DISCORD_API = 'https://discord.com/api/v10';

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

function formatHintMessage(hintTemplate, series) {
    if (!hintTemplate) {
        return `Yes, **${series}** is indeed his series, keep trying to guess the character name!`;
    }
    return hintTemplate.replace(/\{series\}/g, series);
}

async function updateTriviaEmbed(webhook, messageId, game, revealedSections, imageUrl) {
    const total = game.total_sections || SECTIONS;
    const revealedCount = revealedSections.length;
    const progress = Math.round((revealedCount / total) * 100);
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
    };

    try {
        await webhook.editMessage(messageId, { embeds: [embed], content: null });
    } catch (err) {
        console.error(`Failed to update embed for message ${messageId}:`, err.message);
        await webhook.send({
            content: `🔄 **Image updated!** (${revealedCount}/${total} revealed)`,
            embeds: [embed],
            threadId: game.thread_id,
            username: 'Trivia',
            avatarURL: LOGO_URL,
        });
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
        `UPDATE games_trivia SET revealed_sections = ?, next_reveal_at = ? WHERE id = ?`,
        [
            JSON.stringify(revealedSections),
            new Date(Date.now() + game.interval_minutes * 60 * 1000).toISOString(),
            gameId
        ]
    );

    const folderName = `trivia_${gameId}`;
    const originalKey = `images/trivia/${folderName}/original.jpg`;
    const { url: newImageUrl } = await updateTriviaImage(
        folderName,
        revealedSections,
        originalKey
    );

    const channel = await client.channels.fetch(game.channel_id);
    const webhook = await getWebhook(channel, 'Trivia');
    await updateTriviaEmbed(webhook, game.message_id, game, revealedSections, newImageUrl);

    if (game.status === 'active') {
        await startTriviaTimer(client, gameId);
    }
}

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
        const webhook = await getWebhook(channel, 'Trivia');
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
    const originalKey = `images/trivia/${folderName}/original.jpg`;
    const { url: fullImageUrl } = await updateTriviaImage(
        folderName,
        allSections,
        originalKey
    );

    const channel = await client.channels.fetch(game.channel_id);
    const webhook = await getWebhook(channel, 'Trivia');
    const announceMsg = `${h.releaseEmojis.SPARKLES || '🎉'} **Congratulations, <@${userId}>!** You guessed correctly! ${h.releaseEmojis.SPARKLES || '🎉'}`;
    await webhook.send({
        content: announceMsg,
        threadId: game.thread_id,
        username: 'Trivia',
        avatarURL: LOGO_URL,
    });

    const embed = {
        title: '🧩 Character Trivia – Completed!',
        description: `${h.releaseEmojis.SPARKLES || '🎉'} **${username}** guessed the character: **${game.answer}**!`,
        color: 0x4ADE80,
        image: { url: fullImageUrl },
        footer: { text: `Game ended • Winner: ${username}` },
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
    const webhook = await getWebhook(channel, 'Trivia');
    const embed = {
        title: '🧩 Character Trivia – Ended',
        description: `The game was ended by an admin. No winner this time.`,
        color: 0xEF4444,
    };
    try {
        await webhook.editMessage(game.message_id, { embeds: [embed], content: null });
    } catch (err) {
        console.warn(`Could not edit message ${game.message_id}, sending new message instead.`);
        await webhook.send({
            embeds: [embed],
            threadId: game.thread_id,
            username: 'Trivia',
            avatarURL: LOGO_URL,
        });
    }
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
