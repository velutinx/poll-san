// commands/games/mudae-roll.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const supabase = require('../../services/supabase');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mudae-roll')
        .setDescription('Roll for a random character!'),
    async execute(interaction) {
        // Your existing handleMudaeRoll logic, but adapted for slash command
        await interaction.deferReply({ ephemeral: false });

        const userId = interaction.user.id;
        const username = interaction.member.displayName || interaction.user.username;
        const now = new Date();

        // Get or create user state
        let { data: userState, error } = await supabase
            .from('games_mudae_user_state')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();
        if (error) console.error(error);

        // Hourly reset
        if (!userState || (now - new Date(userState.last_reset)) > 60 * 60 * 1000) {
            const resetData = {
                user_id: userId,
                username,
                rolls_left: 5,
                claims_left: 2,
                last_reset: now.toISOString()
            };
            if (userState) {
                await supabase.from('games_mudae_user_state').update(resetData).eq('user_id', userId);
            } else {
                await supabase.from('games_mudae_user_state').insert(resetData);
            }
            userState = resetData;
        }

        if (userState.rolls_left <= 0) {
            return interaction.editReply({ content: '❌ You have no rolls left this hour!' });
        }

        // Deduct roll
        await supabase.from('games_mudae_user_state').update({ rolls_left: userState.rolls_left - 1 }).eq('user_id', userId);

        // Fetch random character
        const { data: characters } = await supabase
            .from('games_mudae_characters')
            .select('*')
            .limit(1)
            .order('random()');
        const character = characters?.[0];
        if (!character) {
            return interaction.editReply({ content: '❌ No characters in pool. Contact admin.' });
        }

        // Build embed
        const embed = new EmbedBuilder()
            .setTitle(`🎲 ${interaction.user.displayName} rolled:`)
            .setDescription(`**${character.name}** from *${character.series}*`)
            .setImage(character.image_url || 'https://via.placeholder.com/300?text=No+Image')
            .setColor(0x00ffcc)
            .setFooter({ text: 'React ✅ to claim | ❌ to pass' });

        const rollMsg = await interaction.channel.send({ embeds: [embed] });
        await rollMsg.react('✅');
        await rollMsg.react('❌');

        // Store active roll in memory
        const activeRolls = global.mudaeActiveRolls || new Map();
        if (!global.mudaeActiveRolls) global.mudaeActiveRolls = activeRolls;
        activeRolls.set(rollMsg.id, {
            userId,
            username,
            characterId: character.id,
            characterName: character.name,
            series: character.series,
            expiresAt: Date.now() + 5 * 60 * 1000,
            priorityUntil: Date.now() + 10 * 1000,
            claimed: false
        });

        // Auto-delete after 5 minutes
        setTimeout(async () => {
            const active = activeRolls.get(rollMsg.id);
            if (active && !active.claimed) {
                try {
                    await rollMsg.delete();
                    activeRolls.delete(rollMsg.id);
                } catch (err) {}
            }
        }, 5 * 60 * 1000);

        // Acknowledge the slash command (already deferred, but we need to send a reply)
        await interaction.editReply({ content: '✅ Roll placed! Check the message above.' });
    }
};
