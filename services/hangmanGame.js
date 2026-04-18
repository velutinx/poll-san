// This is poll-san/services/hangmanGame.js

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');
const supabase = require('./supabase');
const h = require('../utils/helpers');
const fs = require('fs');
const path = require('path');

// Load words
const words = fs.readFileSync(path.join(__dirname, '../utility/words.txt'), { encoding: 'utf-8' }).split('\n').filter(w => w.length > 3);

const MAX_WRONG_GUESSES = 6;
const COOLDOWN_HOURS = 24;

// Draw hangman image
async function createHangmanImage(wrongGuesses) {
    const canvas = createCanvas(300, 350);
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 5;

    const createLine = (fromX, fromY, toX, toY, color = "#000000") => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();
        ctx.closePath();
    };

    // Base, pole, etc.
    createLine(ctx, 50, 330, 150, 330);
    createLine(ctx, 100, 330, 100, 50);
    createLine(ctx, 100, 50, 200, 50);
    createLine(ctx, 200, 50, 200, 80);

    // Head
    ctx.strokeStyle = wrongGuesses < 1 ? "#a3a3a3" : "#000000";
    ctx.beginPath();
    ctx.arc(200, 100, 20, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.closePath();

    // Body
    createLine(ctx, 200, 120, 200, 200, wrongGuesses < 2 ? "#a3a3a3" : "#000000");
    // Arms
    createLine(ctx, 200, 150, 170, 130, wrongGuesses < 3 ? "#a3a3a3" : "#000000");
    createLine(ctx, 200, 150, 230, 130, wrongGuesses < 4 ? "#a3a3a3" : "#000000");
    // Legs
    createLine(ctx, 200, 200, 180, 230, wrongGuesses < 5 ? "#a3a3a3" : "#000000");
    createLine(ctx, 200, 200, 220, 230, wrongGuesses < 6 ? "#a3a3a3" : "#000000");

    return canvas.toBuffer();
}

// Award ticket
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

/**
 * Start a Hangman game for a given interaction (can be slash command or button)
 * @param {Interaction} interaction - The interaction that triggered the game
 */
async function startHangmanGame(interaction) {
    // Defer reply ephemerally so only the player sees it
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const word = words[Math.floor(Math.random() * words.length)].toLowerCase();
    let wrongGuesses = 0;
    const usedLetters = [];
    let gameOver = false;
    let gameWon = false;

    const generateEmbed = async () => {
        const wordDisplay = word.split('').map(l => usedLetters.includes(l) ? l.toUpperCase() : '\\_').join(' ');
        const hangmanImage = await createHangmanImage(wrongGuesses);

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
            .setDescription(`\`\`\`${wordDisplay}\`\`\``)
            .setColor(color)
            .setFooter({ text: footerText })
            .setImage('attachment://hangman.png');
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

    const initialImage = await createHangmanImage(0);
    const embed = await generateEmbed();
    const rows = createButtonRows();

    await interaction.editReply({
        embeds: [embed],
        files: [{ attachment: initialImage, name: 'hangman.png' }],
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

        const newEmbed = await generateEmbed();
        const newImage = await createHangmanImage(wrongGuesses);
        const newRows = createButtonRows();

        await buttonInteraction.update({
            embeds: [newEmbed],
            files: [{ attachment: newImage, name: 'hangman.png' }],
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
