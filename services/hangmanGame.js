// services/hangmanGame.js

const { EmbedBuilder, MessageFlags } = require('discord.js');
const helpers = require('../utils/helpers');
const db = require('./database');
const fs = require('fs');
const path = require('path');
const h = helpers;

const rawLines = fs.readFileSync(path.join(__dirname, '../utility/words.txt'), { encoding: 'utf-8' })
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

const words = rawLines.map(line => {
    const hintMatch = line.match(/^(.+?)\s*\{\s*(.+?)\s*\}$/);
    if (hintMatch) {
        return { word: hintMatch[1].toLowerCase().trim(), hint: hintMatch[2].trim() };
    }
    return { word: line.toLowerCase().trim(), hint: null };
}).filter(item => item.word.length > 3);

const COOLDOWN_HOURS = 24;

const HANGMAN_STAGES = [
    `🟫🟫🟫🟫🟫\n🟫😀🟫\n🟫\n🟫\n🟫`,
    `🟫🟫🟫🟫🟫\n🟫😀🟫\n🟫💪\n🟫\n🟫`,
    `🟫🟫🟫🟫🟫\n🟫😀🟫\n🟫💪💪\n🟫\n🟫`,
    `🟫🟫🟫🟫🟫\n🟫😧🟫\n🟫💪💪\n🟫 🦵\n🟫`,
    `🟫🟫🟫🟫🟫\n🟫😧🟫\n🟫💪💪\n🟫🦵🦵\n🟫`,
    `🟫🟫🟫🟫🟫\n🟫😵🟫\n🟫💪💪\n🟫🦵🦵\n🟫`,
    `🟫🟫🟫🟫🟫\n🟫${h.releaseEmojis?.SKULL || '💀'}🟫\n🟫💪💪\n🟫🦵🦵\n🟫`,
    `🟫🟫🟫🟫🟫\n🟫${h.releaseEmojis?.SKULL || '💀'}🟫💧\n🟫💪💪\n🟫🦵🦵\n🟫`,
    `🟫🟫🟫🟫🟫\n🟫${h.releaseEmojis?.SKULL || '💀'}🟫💧💧\n🟫💪💪\n🟫🦵🦵\n🟫`,
    `🟫🟫🟫🟫🟫\n🟫${h.releaseEmojis?.SKULL || '💀'}🟫💧💧💧\n🟫💪💪\n🟫🦵🦵\n🟫`,
    `🟫🟫🟫🟫🟫\n🟫${h.releaseEmojis?.SKULL || '💀'}🟫💧💧💧💧\n🟫💪💪\n🟫🦵🦵\n🟫`,
    `🟫🟫🟫🟫🟫\n🟫${h.releaseEmojis?.SKULL || '💀'}🟫💧💧💧💧💧\n🟫💪💪\n🟫🦵🦵\n🟫`,
    `🟫🟫🟫🟫🟫\n🟫${h.releaseEmojis?.SKULL || '💀'}🟫💧💧💧💧💧💧\n🟫💪💪\n🟫🦵🦵\n🟫`
];

async function awardTicket(userId, username) {
    const now = new Date();

    // Check cooldown from games_user_data
    let userData;
    try {
        userData = await db.query(
            `SELECT hangman_last_played, tickets FROM ${h.tables.GAMES_USER_DATA} WHERE user_id = ?`,
            [userId],
            true
        );
    } catch (fetchError) {
        console.error('Cooldown fetch error:', fetchError);
        return { awarded: false, reason: 'error' };
    }

    if (userData?.hangman_last_played) {
        const lastPlayed = new Date(userData.hangman_last_played);
        const hoursSince = (now - lastPlayed) / (1000 * 60 * 60);
        if (hoursSince < COOLDOWN_HOURS) {
            const remainingHours = COOLDOWN_HOURS - hoursSince;
            const remainingMinutes = Math.floor(remainingHours * 60);
            return { awarded: false, reason: 'cooldown', remainingMinutes };
        }
    }

    // Increment tickets
    const currentTickets = userData?.tickets ?? 0;
    const newTickets = currentTickets + 1;

    try {
        await db.query(
            `INSERT INTO ${h.tables.GAMES_USER_DATA} (user_id, tickets, hangman_last_played, discord_username, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
                 tickets = excluded.tickets,
                 hangman_last_played = excluded.hangman_last_played,
                 discord_username = excluded.discord_username,
                 updated_at = excluded.updated_at`,
            [userId, newTickets, now.toISOString(), username, now.toISOString()]
        );
    } catch (upsertError) {
        console.error('Ticket increment error:', upsertError);
        return { awarded: false, reason: 'error' };
    }

    return { awarded: true, newCount: newTickets };
}

async function getCooldownRemaining(userId) {
    try {
        const row = await db.query(
            `SELECT hangman_last_played FROM ${h.tables.GAMES_USER_DATA} WHERE user_id = ?`,
            [userId],
            true
        );
        if (!row?.hangman_last_played) return 0;

        const lastPlayed = new Date(row.hangman_last_played);
        const now = new Date();
        const hoursSince = (now - lastPlayed) / (1000 * 60 * 60);
        if (hoursSince >= COOLDOWN_HOURS) return 0;

        return Math.floor((COOLDOWN_HOURS - hoursSince) * 60);
    } catch (err) {
        console.error('getCooldownRemaining error:', err);
        return 0;
    }
}

async function startHangmanGame(interaction) {
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (error) {
        return;
    }

    const confettiEmoji = h.releaseEmojis?.CONFETTI || '🎉';

    // (Optional) We no longer check for cooldown reset notification via separate table.
    // If needed, we could add a simple check and notify, but we'll keep it minimal.

    const item = words[Math.floor(Math.random() * words.length)];
    const word = item.word;
    const hint = item.hint;

    let maxWrongGuesses = word.length >= 7 ? word.length : 6;
    maxWrongGuesses = Math.min(maxWrongGuesses, HANGMAN_STAGES.length - 1);

    let wrongGuesses = 0;
    const usedLetters = new Set();
    let gameOver = false;
    let gameWon = false;
    let activeBoardMsgId = null;

    const generateEmbed = () => {
        let wordDisplay;
        if (gameWon) {
            wordDisplay = word.toUpperCase().split('').join(' ');
        } else {
            wordDisplay = word.split('').map(l => usedLetters.has(l) ? l.toUpperCase() : '\\_').join(' ');
        }
        const stageIndex = Math.min(wrongGuesses, maxWrongGuesses);
        const stage = HANGMAN_STAGES[stageIndex];
        const usedList = [...usedLetters].sort().join(', ') || 'None';

        let color = 0x0099FF;
        let title = '🎮 Hangman';
        let footerText = `Guesses left: ${maxWrongGuesses - wrongGuesses}`;

        if (gameWon) {
            color = 0x00FF00;
            title = `${confettiEmoji} You won!`;
            footerText = 'Great job!';
        } else if (wrongGuesses >= maxWrongGuesses) {
            color = 0xFF0000;
            title = `${h.releaseEmojis?.SKULL || '💀'} Game Over`;
            footerText = `The word was "${word}".`;
        }

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(`\`\`\`${wordDisplay}\`\`\`\n${stage}`)
            .addFields({ name: '📝 Letters used', value: usedList, inline: true });

        if (hint && !gameWon && wrongGuesses < maxWrongGuesses) {
            embed.addFields({ name: '💡 Hint', value: hint, inline: true });
        }

        embed.setColor(color).setFooter({ text: footerText });
        return embed;
    };

    try {
        const initialReply = await interaction.editReply({
            embeds: [generateEmbed()],
            content: 'Type a single letter or the whole word in this channel to guess!'
        });
        const fetchedReply = await interaction.fetchReply();
        activeBoardMsgId = fetchedReply.id;
    } catch (e) {
        return;
    }

    const filter = (msg) => {
        return msg.author.id === interaction.user.id &&
               msg.channel.id === interaction.channel.id &&
               !gameOver;
    };

    const collector = interaction.channel.createMessageCollector({ filter, time: 180000 });

    collector.on('collect', async (msg) => {
        const content = msg.content.toLowerCase().trim();
        msg.delete().catch(() => {});

        let tempWarning = null;

        if (content.length > 1) {
            if (content === word) {
                for (const letter of word) usedLetters.add(letter);
                gameWon = true;
                gameOver = true;
                collector.stop();
            } else {
                wrongGuesses++;
                tempWarning = await interaction.followUp({
                    content: `${h.releaseEmojis?.BATSU || '❌'} "${msg.content}" is not the correct word. You lost a guess.`,
                    flags: MessageFlags.Ephemeral,
                    fetchReply: true
                });

                if (wrongGuesses >= maxWrongGuesses) {
                    gameOver = true;
                    collector.stop();
                }
            }
        } else {
            const letter = content;
            if (!/[a-zA-Z]/.test(letter)) return;

            if (usedLetters.has(letter)) {
                const warningMsg = await interaction.followUp({ 
                    content: `${h.releaseEmojis?.ALERT || '⚠️'} You already guessed "${letter}".`,
                    flags: MessageFlags.Ephemeral,
                    fetchReply: true 
                });
                setTimeout(() => interaction.webhook.deleteMessage(warningMsg.id).catch(() => {}), 2000);
                return;
            }

            usedLetters.add(letter);
            if (!word.includes(letter)) wrongGuesses++;

            const wordGuessed = word.split('').every(l => usedLetters.has(l));
            if (wordGuessed) {
                gameWon = true;
                gameOver = true;
                collector.stop();
            } else if (wrongGuesses >= maxWrongGuesses) {
                gameOver = true;
                collector.stop();
            }
        }

        if (activeBoardMsgId) {
            try {
                await interaction.webhook.deleteMessage(activeBoardMsgId);
            } catch (err) {
            }
        }

        try {
            const updatedBoardMsg = await interaction.followUp({ 
                embeds: [generateEmbed()], 
                content: gameOver ? 'Game ended.' : 'Type a single letter or the whole word in this channel to guess!',
                flags: MessageFlags.Ephemeral,
                fetchReply: true
            });
            activeBoardMsgId = updatedBoardMsg.id;
        } catch (err) {
            console.error('Failed to update hangman board:', err.message);
        }

        if (tempWarning) {
            setTimeout(() => interaction.webhook.deleteMessage(tempWarning.id).catch(() => {}), 3000);
        }
    });

    collector.on('end', async () => {
        if (gameOver) {
            setTimeout(async () => {
                try {
                    const messages = await interaction.channel.messages.fetch({ limit: 20 });
                    const userMessages = messages.filter(m => m.author.id === interaction.user.id && !m.pinned);
                    for (const m of userMessages.values()) {
                        m.delete().catch(() => {});
                    }
                } catch (err) {}
            }, 2000);
        }

        if (gameWon) {
            const result = await awardTicket(interaction.user.id, interaction.user.username);
            if (result.awarded) {
                const winMsg = `${confettiEmoji} You solved the hangman! You've earned **1 ticket**! You now have **${result.newCount}** ticket(s).\n\nYou can earn another ticket from Hangman in 24 hours.`;
                await interaction.followUp({ content: winMsg, flags: MessageFlags.Ephemeral });
            } else if (result.reason === 'cooldown') {
                const minutes = result.remainingMinutes;
                const hours = Math.floor(minutes / 60);
                const mins = minutes % 60;
                const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins} minutes`;
                const cooldownMsg = `${h.releaseEmojis?.HOURGLASS || '⏳'} You can earn another ticket from Hangman in **${timeStr}**.`;
                await interaction.followUp({ content: cooldownMsg, flags: MessageFlags.Ephemeral });
            }
        } else if (!gameOver) {
            if (activeBoardMsgId) {
                interaction.webhook.deleteMessage(activeBoardMsgId).catch(() => {});
            }
            await interaction.followUp({ content: '⏰ Game timed out.', flags: MessageFlags.Ephemeral });
        }
    });
}

module.exports = { startHangmanGame };
