// services/triviaService.js
const db = require('./database');
const h = require('../utils/helpers');
const { getOriginalImage, uploadTriviaImage } = require('./triviaImage');

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
    const total = game.total_sections || 12;

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

    try {
        const channel = await client.channels.fetch(game.channel_id);
        let webhook = (await channel.fetchWebhooks()).find(w => w.name === 'Trivia');
        if (!webhook) {
            webhook = await channel.createWebhook({ name: 'Trivia', avatar: h.urls.LOGO_URL });
        }
        await webhook.send({
            content: `🔄 **Image updated!** (${revealedSections.length}/${total} revealed)`,
            threadId: game.thread_id,
            username: 'Trivia',
            avatarURL: h.urls.LOGO_URL,
        });
    } catch (err) {
        console.warn(`Could not send notification for game ${gameId}:`, err.message);
    }

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
        let webhook = (await channel.fetchWebhooks()).find(w => w.name === 'Trivia');
        if (!webhook) {
            webhook = await channel.createWebhook({ name: 'Trivia', avatar: LOGO_URL });
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
    const originalKey = `images/trivia/${folderName}/original.jpg`;
    const { url: fullImageUrl } = await updateTriviaImage(
        folderName,
        allSections,
        originalKey
    );

    const channel = await client.channels.fetch(game.channel_id);
    let webhook = (await channel.fetchWebhooks()).find(w => w.name === 'Trivia');
    if (!webhook) {
        webhook = await channel.createWebhook({ name: 'Trivia', avatar: LOGO_URL });
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
        image: { url: fullImageUrl },
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
    let webhook = (await channel.fetchWebhooks()).find(w => w.name === 'Trivia');
    if (!webhook) {
        webhook = await channel.createWebhook({ name: 'Trivia', avatar: LOGO_URL });
    }
    const embed = {
        description: `The game was ended by an admin. No winner this time.`,
        color: 0xEF4444,
    };
    try {
        await webhook.editMessage(game.message_id, { embeds: [embed], content: null });
    } catch (err) {
        console.warn(`Could not edit message ${game.message_id}:`, err.message);
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
