const pollManager = require('./pollManager'); // Make sure this is required

async function resumePoll(client) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    const res = await fetch(
      `${supabaseUrl}/rest/v1/active_polls?active=eq.true&select=*`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`
        }
      }
    );

    if (!res.ok) {
      console.error(`Failed to fetch active poll: ${res.status} - ${await res.text()}`);
      return;
    }

    const rows = await res.json();
    if (rows.length === 0) {
      console.log('No active poll found in database');
      return;
    }

    const activeRow = rows[0];

    const channel = await client.channels.fetch(activeRow.channel_id).catch(() => null);
    if (!channel) {
      console.error('Poll channel not found');
      return;
    }

    const message = await channel.messages.fetch(activeRow.message_id).catch(() => null);
    if (!message) {
      console.error('Poll message not found');
      return;
    }

    const charsRes = await fetch(
      `${supabaseUrl}/rest/v1/poll_result?poll_id=eq.${activeRow.poll_id}&select=option_id,character_name&order=option_id.asc`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`
        }
      }
    );

    let characters = [];
    if (charsRes.ok) {
      const charRows = await charsRes.json();
      characters = charRows.map(r => r.character_name);
    }

    if (characters.length !== 12) {
      console.error('Incomplete character list from poll_result');
      return;
    }

    const pollData = {
      characters,
      endTime: new Date(activeRow.ends_at).getTime(),
      message,
      collector: null
    };

    pollManager.activePoll = pollData;

    // Re-add reactions if needed
    for (const emoji of pollManager.NUMBER_EMOJIS) {
      if (!message.reactions.cache.has(emoji)) {
        try {
          await message.react(emoji);
        } catch (err) {
          console.error('Failed to re-react:', err);
        }
      }
    }

    // NEW: Double-check & sync all current Discord votes
    await pollManager.syncCurrentVotes(message);

    // Resume collector
    const filter = (reaction, user) => !user.bot && pollManager.NUMBER_EMOJIS.includes(reaction.emoji.toString());
    const collector = message.createReactionCollector({
      filter,
      dispose: true,
      time: pollData.endTime - Date.now()
    });

    pollManager.activePoll.collector = collector;

    collector.on('collect', async (reaction, user) => {
      try {
        const optionIndex = pollManager.NUMBER_EMOJIS.indexOf(reaction.emoji.toString());
        if (optionIndex === -1) return;

        await require('./pollVote').saveDiscordVote(pollManager.activePoll, user, optionIndex);

        const otherReactions = message.reactions.cache.filter(r =>
          pollManager.NUMBER_EMOJIS.includes(r.emoji.toString()) &&
          r.emoji.toString() !== reaction.emoji.toString() &&
          r.users.cache.has(user.id)
        );

        for (const r of otherReactions.values()) {
          await r.users.remove(user.id);
        }

        const updatedContent = await pollManager.buildPollMessage();
        await message.edit(updatedContent);
      } catch (err) {
        console.error('Failed to process resumed vote:', err);
      }
    });

    collector.on('dispose', async (reaction, user) => {
      try {
        const updatedContent = await pollManager.buildPollMessage();
        await message.edit(updatedContent);
      } catch (err) {
        console.error('Failed to update on dispose (resumed):', err);
      }
    });

    // Resume timer
    pollManager.updateInterval = setInterval(async () => {
      try {
        if (!pollManager.activePoll) return;

        const timeLeft = pollManager.activePoll.endTime - Date.now();

        if (timeLeft <= 0) {
          clearInterval(pollManager.updateInterval);
          pollManager.updateInterval = null;
          if (pollManager.activePoll?.collector) pollManager.activePoll.collector.stop();

          if (pollManager.activePoll?.message) {
            const finalContent = await pollManager.buildPollMessage();
            const finalText = finalContent.replace(/⏳ Time remaining: .*\n/, '🛑 Poll has ended.\n');
            await pollManager.activePoll.message.edit(finalText);
          }

          pollManager.activePoll = null;
          pollManager.winners = new Set();
          return;
        }

        const updatedContent = await pollManager.buildPollMessage();
        if (pollManager.activePoll?.message) {
          await pollManager.activePoll.message.edit(updatedContent);
        }
      } catch (err) {
        console.error('Resumed poll update error:', err);
      }
    }, 10000);

    console.log('Poll resumed successfully from database');
  } catch (err) {
    console.error('Failed to resume poll:', err);
  }
}

module.exports = { resumePoll };