// handlers/mudaeReaction.js
const supabase = require('../services/supabase');
const { EmbedBuilder } = require('discord.js');

async function handleMudaeReaction(reaction, user, type) {
    if (user.bot) return;
    if (type !== 'add') return;

    const activeRolls = global.mudaeActiveRolls;
    if (!activeRolls) return;

    const rollData = activeRolls.get(reaction.message.id);
    if (!rollData) return;

    if (reaction.emoji.name === '❌') return;
    if (reaction.emoji.name !== '✅') return;

    if (rollData.claimed) {
        await reaction.message.reply({ content: 'This character was already claimed!', ephemeral: true }).catch(() => {});
        return;
    }

    const now = Date.now();
    const isRoller = (user.id === rollData.userId);
    const isPriority = now < rollData.priorityUntil;

    if (isPriority && !isRoller) {
        const secondsLeft = Math.ceil((rollData.priorityUntil - now) / 1000);
        await reaction.message.reply({ content: `⏳ Only <@${rollData.userId}> can claim for the next ${secondsLeft} seconds.`, ephemeral: true }).catch(() => {});
        return;
    }

    // Get user's claims left
    const { data: userState, error } = await supabase
        .from('games_mudae_user_state')
        .select('claims_left')
        .eq('user_id', user.id)
        .maybeSingle();

    if (error) console.error(error);
    if (!userState || userState.claims_left <= 0) {
        await reaction.message.reply({ content: '❌ You have no claims left this hour!', flags: 64 }).catch(() => {});
        return;
    }

    // Deduct claim
    await supabase.from('games_mudae_user_state').update({ claims_left: userState.claims_left - 1 }).eq('user_id', user.id);

    // Record claim with username
    const claimerUsername = reaction.message.guild.members.cache.get(user.id)?.displayName || user.username;
    await supabase.from('games_mudae_claims').insert({
        user_id: user.id,
        username: claimerUsername,
        character_name: rollData.characterName,
        series: rollData.series
    });

    rollData.claimed = true;
    activeRolls.set(reaction.message.id, rollData);

    // Update embed
    const embed = EmbedBuilder.from(reaction.message.embeds[0]);
    embed.setDescription(`**${rollData.characterName}** from *${rollData.series}*\n\n✅ Claimed by <@${user.id}>!`);
    embed.setColor(0x88ff88);
    await reaction.message.edit({ embeds: [embed] });
    await reaction.message.reactions.removeAll();

    // Send DM confirmation
    try {
        await user.send(`🎉 You claimed **${rollData.characterName}** from *${rollData.series}*! Use it later to request a character from the same series.`);
    } catch (err) {}
}

module.exports = handleMudaeReaction;
