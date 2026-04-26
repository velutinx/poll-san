// services/hangmanGame.js

const { EmbedBuilder, MessageFlags } = require('discord.js');
const helpers = require('../utils/helpers');
const supabase = require('./supabase');
const fs = require('fs');
const path = require('path');

// Load words with optional hints
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
    '🟫🟫🟫🟫🟫\n🟫😀🟫\n🟫\n🟫\n🟫',
    '🟫🟫🟫🟫🟫\n🟫😀🟫\n🟫💪\n🟫\n🟫',
    '🟫🟫🟫🟫🟫\n🟫😀🟫\n🟫💪💪\n🟫\n🟫',
    '🟫🟫🟫🟫🟫\n🟫😧🟫\n🟫💪💪\n🟫 🦵\n🟫',
    '🟫🟫🟫🟫🟫\n🟫😧🟫\n🟫💪💪\n🟫🦵🦵\n🟫',
    '🟫🟫🟫🟫🟫\n🟫😵🟫\n🟫💪💪\n🟫🦵🦵\n🟫',
    '🟫🟫🟫🟫🟫\n🟫💀🟫\n🟫💪💪\n🟫🦵🦵\n🟫',
    '🟫🟫🟫🟫🟫\n🟫💀🟫💧\n🟫💪💪\n🟫🦵🦵\n🟫',
    '🟫🟫🟫🟫🟫\n🟫💀🟫💧💧\n🟫💪💪\n🟫🦵🦵\n🟫',
    '🟫🟫🟫🟫🟫\n🟫💀🟫💧💧💧\n🟫💪💪\n🟫🦵🦵\n🟫',
    '🟫🟫🟫🟫🟫\n🟫💀🟫💧💧💧💧\n🟫💪💪\n🟫🦵🦵\n🟫',
    '🟫🟫🟫🟫🟫\n🟫💀🟫💧💧💧💧💧\n🟫💪💪\n🟫🦵🦵\n🟫',
    '🟫🟫🟫🟫🟫\n🟫💀🟫💧💧💧💧💧💧\n🟫💪💪\n🟫🦵🦵\n🟫'
];

async function awardTicket(userId, username) {
    const now = new Date();

    const { data: cooldownData, error: fetchError } = await supabase
        .from(h.tables.GAMES_COOLDOWNS)   // 👈 changed
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
        .from(h.tables.GAMES_COOLDOWNS)   // 👈 changed
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
        .from(h.tables.GAMES_COOLDOWNS)   // 👈 changed
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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const item = words[Math.floor(Math.random() * words.length)];
    const word = item.word;
    const hint = item.hint;

    let maxWrongGuesses = word.length >= 7 ? word.length : 6;
    maxWrongGuesses = Math.min(maxWrongGuesses, HANGMAN_STAGES.length - 1);

    let wrongGuesses = 0;
    const usedLetters = new Set();
    let gameOver = false;
    let gameWon = false;

    const generateEmbed = () => {
        let wordDisplay;
        if (gameWon) {
            // Show the full word in uppercase when won
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
            title = `${h.releaseEmojis.CONFETTI} You won!`;
            footerText = 'Great job!';
        } else if (wrongGuesses >= maxWrongGuesses) {
            color = 0xFF0000;
            title = '💀 Game Over';
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

    const embed = generateEmbed();
    await interaction.editReply({
        embeds: [embed],
        content: 'Type a single letter or the whole word in this channel to guess!'
    });

    const filter = (msg) => {
        return msg.author.id === interaction.user.id &&
               msg.channel.id === interaction.channel.id &&
               !gameOver;
    };

    const collector = interaction.channel.createMessageCollector({ filter, time: 180000 }); // 3 min

    collector.on('collect', async (msg) => {
        const content = msg.content.toLowerCase().trim();
        // Delete the user's guess message immediately
        msg.delete().catch(() => {});

        // ---- Word guess (length > 1) ----
        if (content.length > 1) {
            if (content === word) {
                // Add all letters of the word so the final display shows the full word
                for (const letter of word) {
                    usedLetters.add(letter);
                }
                gameWon = true;
                gameOver = true;
                collector.stop();
            } else {
                // Incorrect word guess: increment wrong guesses, no letters added
                wrongGuesses++;
                const warning = await interaction.followUp({
                    content: `❌ "${msg.content}" is not the correct word. You lost a guess.`,
                    flags: MessageFlags.Ephemeral
                });
                setTimeout(() => warning.delete().catch(() => {}), 3000);

                if (wrongGuesses >= maxWrongGuesses) {
                    gameOver = true;
                    collector.stop();
                }
            }
            const newEmbed = generateEmbed();
            await interaction.editReply({ embeds: [newEmbed], content: gameOver ? 'Game ended.' : 'Type a single letter or the whole word in this channel to guess!' });
            return;
        }

        // ---- Single letter guess ----
        const letter = content;
        if (!/[a-zA-Z]/.test(letter)) return;

        if (usedLetters.has(letter)) {
            const warning = await interaction.followUp({ content: `⚠️ You already guessed "${letter}".`, flags: MessageFlags.Ephemeral });
            setTimeout(() => warning.delete().catch(() => {}), 2000);
            return;
        }

        usedLetters.add(letter);
        if (!word.includes(letter)) {
            wrongGuesses++;
        }

        const wordGuessed = word.split('').every(l => usedLetters.has(l));
        if (wordGuessed) {
            gameWon = true;
            gameOver = true;
            collector.stop();
        } else if (wrongGuesses >= maxWrongGuesses) {
            gameOver = true;
            collector.stop();
        }

        const newEmbed = generateEmbed();
        await interaction.editReply({ embeds: [newEmbed], content: gameOver ? 'Game ended.' : 'Type a single letter or the whole word in this channel to guess!' });
    });

    collector.on('end', async () => {
        // Clean up any remaining messages from the player in this channel
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
                const dmMessage = `${h.releaseEmojis.CONFETTI} You solved the hangman! You've earned **1 ticket**! You now have **${result.newCount}** ticket(s).\n\n*You can earn another ticket from Hangman in 24 hours. I'll DM you when it's available.*`;
                try {
                    await interaction.user.send(dmMessage);
                } catch {
                    await interaction.followUp({ content: dmMessage, flags: MessageFlags.Ephemeral });
                }
            } else if (result.reason === 'cooldown') {
                const minutes = result.remainingMinutes;
                const hours = Math.floor(minutes / 60);
                const mins = minutes % 60;
                const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins} minutes`;
                const cooldownMsg = `⏳ You can earn another ticket from Hangman in **${timeStr}**. I'll DM you when it's available!`;
                await interaction.followUp({ content: cooldownMsg, flags: MessageFlags.Ephemeral });
            }
        } else if (!gameOver) {
            await interaction.editReply({ content: '⏰ Game timed out.', embeds: [], components: [] }).catch(() => {});
        }
    });
}

module.exports = { startHangmanGame };
