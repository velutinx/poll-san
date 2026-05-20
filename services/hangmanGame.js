// services/hangmanGame.js

const { EmbedBuilder, MessageFlags } = require('discord.js');
const helpers = require('../utils/helpers');
const supabase = require('./supabase');
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
const GAME_TYPE = 'hangman';

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

    const { data: cooldownData, error: fetchError } = await supabase
        .from(h.tables.GAMES_COOLDOWNS)
        .select('last_win_at')
        .eq('discord_id', userId)
        .eq('game_type', GAME_TYPE)
        .maybeSingle();

    if (fetchError) {
        console.error('Cooldown fetch error:', fetchError);
        return { awarded: false, reason: 'error' };
    }

    if (cooldownData?.last_win_at) {
        const lastWin = new Date(cooldownData.last_win_at);
        const hoursSince = (now - lastWin) / (1000 * 60 * 60);
        if (hoursSince < COOLDOWN_HOURS) {
            const remainingHours = COOLDOWN_HOURS - hoursSince;
            const remainingMinutes = Math.floor(remainingHours * 60);
            return { awarded: false, reason: 'cooldown', remainingMinutes };
        }
    }

    const { data: newCount, error: rpcError } = await supabase
        .rpc('increment_wordle_ticket', { user_id: userId, user_name: username });

    if (rpcError) {
        console.error('Ticket increment error:', rpcError);
        return { awarded: false, reason: 'error' };
    }

    const { error: upsertError } = await supabase
        .from(h.tables.GAMES_COOLDOWNS)
        .upsert({
            discord_id: userId,
            discord_username: username,
            game_type: GAME_TYPE,
            last_win_at: now.toISOString(),
            notified_reset: false,
            updated_at: now.toISOString()
        }, { onConflict: 'discord_id,game_type' });

    if (upsertError) console.error('Cooldown upsert error:', upsertError);

    return { awarded: true, newCount };
}

async function getCooldownRemaining(userId) {
    const { data } = await supabase
        .from(h.tables.GAMES_COOLDOWNS)
        .select('last_win_at')
        .eq('discord_id', userId)
        .eq('game_type', GAME_TYPE)
        .maybeSingle();

    if (!data?.last_win_at) return 0;

    const lastWin = new Date(data.last_win_at);
    const now = new Date();
    const hoursSince = (now - lastWin) / (1000 * 60 * 60);
    if (hoursSince >= COOLDOWN_HOURS) return 0;

    return Math.floor((COOLDOWN_HOURS - hoursSince) * 60);
}

async function startHangmanGame(interaction) {
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (error) {
        return;
    }

    const confettiEmoji = h.releaseEmojis?.CONFETTI || '🎉';

    try {
        const { data: cooldownRow } = await supabase
            .from(h.tables.GAMES_COOLDOWNS)
            .select('last_win_at, notified_reset')
            .eq('discord_id', interaction.user.id)
            .eq('game_type', GAME_TYPE)
            .maybeSingle();

        if (cooldownRow && !cooldownRow.notified_reset) {
            const lastWin = new Date(cooldownRow.last_win_at);
            const hoursSince = (Date.now() - lastWin.getTime()) / (1000 * 60 * 60);
            if (hoursSince >= COOLDOWN_HOURS) {
                await interaction.followUp({
                    content: `${confettiEmoji} Your **Hangman** ticket cooldown has reset! You can now earn another ticket by winning a game.`,
                    flags: MessageFlags.Ephemeral
                });
                await supabase
                    .from(h.tables.GAMES_COOLDOWNS)
                    .update({ notified_reset: true, updated_at: new Date().toISOString() })
                    .eq('discord_id', interaction.user.id)
                    .eq('game_type', GAME_TYPE);
            }
        }
    } catch (err) {
        console.error('Cooldown reset check error:', err);
    }

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
