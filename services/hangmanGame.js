// This is poll-san/services/hangmanGame.js

const { EmbedBuilder, MessageFlags } = require('discord.js');
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
    '🟫🟫🟫🟫🟫\n🟫😀🟫\n🟫\n🟫\n🟫',
    '🟫🟫🟫🟫🟫\n🟫😀🟫\n🟫💪\n🟫\n🟫',
    '🟫🟫🟫🟫🟫\n🟫😀🟫\n🟫💪💪\n🟫\n🟫',
    '🟫🟫🟫🟫🟫\n🟫😧🟫\n🟫💪💪\n🟫 🦵\n🟫',
    '🟫🟫🟫🟫🟫\n🟫😧🟫\n🟫💪💪\n🟫🦵🦵\n🟫',
    '🟫🟫🟫🟫🟫\n🟫😵🟫\n🟫💪💪\n🟫🦵🦵\n🟫',
    '🟫🟫🟫🟫🟫\n🟫💀🟫\n🟫💪💪\n🟫🦵🦵\n🟫'
];

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
    const usedLetters = new Set();
    let gameOver = false;
    let gameWon = false;

    const generateEmbed = () => {
        const wordDisplay = word.split('').map(l => usedLetters.has(l) ? l.toUpperCase() : '\\_').join(' ');
        const stage = HANGMAN_STAGES[Math.min(wrongGuesses, MAX_WRONG_GUESSES)];
        const usedList = [...usedLetters].sort().join(', ') || 'None';

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
            .addFields({ name: 'Letters used', value: usedList, inline: false })
            .setColor(color)
            .setFooter({ text: footerText });
    };

    const embed = generateEmbed();
    await interaction.editReply({
        embeds: [embed],
        content: 'Type a single letter in this channel to guess!'
    });

    // Create message collector for this user in the channel
    const filter = (msg) => {
        return msg.author.id === interaction.user.id && 
               msg.channel.id === interaction.channel.id &&
               msg.content.length === 1 &&
               /[a-zA-Z]/.test(msg.content) &&
               !gameOver;
    };

    const collector = interaction.channel.createMessageCollector({ filter, time: 120000 });

    collector.on('collect', async (msg) => {
        const letter = msg.content.toLowerCase();
        
        // Delete the guess message to keep channel clean
        msg.delete().catch(() => {});

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
            gameOver = true;
            gameWon = true;
            collector.stop();
        } else if (wrongGuesses >= MAX_WRONG_GUESSES) {
            gameOver = true;
            collector.stop();
        }

        const newEmbed = generateEmbed();
        await interaction.editReply({ embeds: [newEmbed], content: gameOver ? 'Game ended.' : 'Type a single letter in this channel to guess!' });
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
        } else if (!gameOver) {
            await interaction.editReply({ content: '⏰ Game timed out.', embeds: [], components: [] }).catch(() => {});
        }
    });
}

module.exports = { startHangmanGame };
