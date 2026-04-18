// This is poll-san/services/hangmanGame.js

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const supabase = require('./supabase');
const h = require('../utils/helpers');
const fs = require('fs');
const path = require('path');

// Load words
const words = fs.readFileSync(path.join(__dirname, '../utility/words.txt'), { encoding: 'utf-8' }).split('\n').filter(w => w.length > 3);

const MAX_WRONG_GUESSES = 6;
const COOLDOWN_HOURS = 24;

// Hangman stages as emoji art
const HANGMAN_STAGES = [
    '🟫🟫🟫🟫🟫\n🟫😀🟫\n🟫\n🟫\n🟫',                          // 0 wrong
    '🟫🟫🟫🟫🟫\n🟫😀🟫\n🟫💪\n🟫\n🟫',                        // 1 wrong
    '🟫🟫🟫🟫🟫\n🟫😀🟫\n🟫💪💪\n🟫\n🟫',                      // 2 wrong
    '🟫🟫🟫🟫🟫\n🟫😧🟫\n🟫💪💪\n🟫 🦵\n🟫',                   // 3 wrong
    '🟫🟫🟫🟫🟫\n🟫😧🟫\n🟫💪💪\n🟫🦵🦵\n🟫',                 // 4 wrong
    '🟫🟫🟫🟫🟫\n🟫😵🟫\n🟫💪💪\n🟫🦵🦵\n🟫',                 // 5 wrong
    '🟫🟫🟫🟫🟫\n🟫💀🟫\n🟫💪💪\n🟫🦵🦵\n🟫'                  // 6 wrong (game over)
];

// Award ticket (same logic as before)
async function awardTicket(userId, username) {
    try {
        const { data: userData, error: fetchError } = await supabase
            .from('games_wordle')
            .select('last_win_at')
            .eq('discord_id', userId)
            .maybeSingle();

        if (fetchError) throw fetchError;

        const now = new Date();
        if (userData?.last_win_at) {
            const lastWin = new Date(userData.last_win_at);
            const hoursSince = (now - lastWin) / (1000 * 60 * 60);
            if (hoursSince < COOLDOWN_HOURS) {
                return { awarded: false, reason: 'cooldown' };
            }
        }

        const { data: newCount, error: rpcError } = await supabase
            .rpc('increment_wordle_ticket', { user_id: userId, user_name: username });

        if (rpcError) throw rpcError;

        return { awarded: true, newCount };
    } catch (error) {
        console.error('Ticket award error:', error);
        return { awarded: false, reason: 'error' };
    }
}

async function startHangmanGame(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const word = words[Math.floor(Math.random() * words.length)].toLowerCase();
    let wrongGuesses = 0;
    const usedLetters = [];
    let gameOver = false;
    let gameWon = false;

    const generateEmbed = () => {
        const wordDisplay = word.split('').map(l => usedLetters.includes(l) ? l.toUpperCase() : '\\_').join(' ');
        const stage = HANGMAN_STAGES[Math.min(wrongGuesses, MAX_WRONG_GUESSES)];

        let color = 0x0099FF;
        let footerText = `Guesses left: ${MAX_WRONG_GUESSES - wrongGuesses}`;

        if (gameWon) {
            color = 0x00FF00;
            footerText = '🎉 You won!';
        } else if (wrongGuesses >= MAX_WRONG_GUESSES) {
            color = 0xFF0000;
            footerText = `💀 Game Over! The word was "${word}".`;
        }

        return new EmbedBuilder()
            .setTitle('🎮 Hangman')
            .setDescription(`\`\`\`${wordDisplay}\`\`\`\n${stage}`)
            .setColor(color)
            .setFooter({ text: footerText });
    };

    const createButtonRows = () => {
        const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
        const rows = [];
        for (let i = 0; i < alphabet.length; i += 6) {
            const row = new ActionRowBuilder();
            alphabet.slice(i, i + 6).forEach(letter => {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`hangman_${letter}`)
                        .setLabel(letter.toUpperCase())
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(usedLetters.includes(letter) || gameOver)
                );
            });
            rows.push(row);
        }
        return rows;
    };

    const embed = generateEmbed();
    const rows = createButtonRows();

    await interaction.editReply({
        embeds: [embed],
        components: rows,
    });

    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120000,
    });

    collector.on('collect', async (buttonInteraction) => {
        if (buttonInteraction.user.id !== interaction.user.id) {
            return buttonInteraction.reply({ content: '❌ This game is not for you!', flags: MessageFlags.Ephemeral });
        }

        const guessedLetter = buttonInteraction.customId.replace('hangman_', '');
        if (!usedLetters.includes(guessedLetter)) {
            usedLetters.push(guessedLetter);
            if (!word.includes(guessedLetter)) wrongGuesses++;
        }

        const wordGuessed = word.split('').every(l => usedLetters.includes(l));
        if (wordGuessed) {
            gameOver = true;
            gameWon = true;
            collector.stop();
        } else if (wrongGuesses >= MAX_WRONG_GUESSES) {
            gameOver = true;
            collector.stop();
        }

        const newEmbed = generateEmbed();
        const newRows = createButtonRows();

        await buttonInteraction.update({
            embeds: [newEmbed],
            components: newRows,
        });
    });

    collector.on('end', async () => {
        if (gameWon) {
            const result = await awardTicket(interaction.user.id, interaction.user.username);
            if (result.awarded) {
                const dmMessage = `${h.releaseEmojis.CONFETTI} You solved the hangman! You've earned **1 ticket**! You now have **${result.newCount}** ticket(s).`;
                try {
                    await interaction.user.send(dmMessage);
                } catch {
                    await interaction.followUp({ content: dmMessage, flags: MessageFlags.Ephemeral });
                }
            }
        }
    });
}

module.exports = { startHangmanGame };
