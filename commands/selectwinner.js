// commands/selectwinner.js
const { SlashCommandBuilder } = require('discord.js');
const pollManager = require('../pollManager');

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '') || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('selectwinner')
    .setDescription('Mark a character as poll winner (Owner only)')
    .setDMPermission(false)
    .addIntegerOption(option =>
      option.setName('number')
        .setDescription('The number 1–12 of the winner')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(12)
    ),

  async execute(interaction) {
    try {
      const OWNER_ID = '1380051214766444617';

      if (interaction.user.id !== OWNER_ID) {
        return interaction.reply({
          content: '❌ You are not allowed to select winners.',
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const winnerNumber = interaction.options.getInteger('number');

      if (!pollManager.activePoll || !pollManager.activePoll.message) {
        return interaction.editReply({ content: '⚠️ No active poll.' });
      }

      const { message, characters } = pollManager.activePoll;
      const thread = message.hasThread ? await message.thread.fetch() : null;

      if (!thread) {
        return interaction.editReply({ content: '⚠️ No thread found.' });
      }

      // Get current results
      const counts = await pollManager.calculateCounts(message);

      // Format date: "Feb 20, 04:36 PM"
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      const formattedNow = `${dateStr}, ${timeStr}`;

      let resultText = `📊 Current Results (${formattedNow})\n\n`;

      // Use in-memory winners (add current one immediately)
      if (!pollManager.activePoll.winners) {
        pollManager.activePoll.winners = new Set();
      }
      pollManager.activePoll.winners.add(winnerNumber); // Add new winner

      for (let i = 0; i < characters.length; i++) {
        const line = `${pollManager.NUMBER_EMOJIS[i]} = ${counts[i].toFixed(1)} -- ${characters[i]}`;
        const isWinner = pollManager.activePoll.winners.has(i + 1);
        resultText += isWinner ? `||${line}||\n` : `${line}\n`;
      }

      const winnerName = characters[winnerNumber - 1];
      const announcement = `**${winnerName} has been marked as a poll winner! 🎉**\n\n${resultText}`;

      await thread.send(announcement);

      // Update DB
      const pollId = 'character_poll_new';
      const optionId = winnerNumber;
      const selectedAt = new Date().toISOString();

      console.log(`Marking winner: poll_id=${pollId}, option_id=${optionId}, selected_at=${selectedAt}`);

      // Update poll_result.selected_at
      const updateRes = await fetch(
        `${SUPABASE_URL}/rest/v1/poll_result?poll_id=eq.${pollId}&option_id=eq.${optionId}`,
        {
          method: 'PATCH',
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal'
          },
          body: JSON.stringify({ selected_at: selectedAt })
        }
      );

      if (!updateRes.ok) {
        const errorText = await updateRes.text();
        console.error(`Failed to update poll_result.selected_at: ${updateRes.status} - ${errorText}`);
      } else {
        console.log(`Updated poll_result.selected_at for option ${optionId}`);
      }

      // Insert into poll_winners
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/poll_winners`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          poll_id: pollId,
          option_id: optionId,
          selected_at: selectedAt
        })
      });

      if (!insertRes.ok) {
        const errorText = await insertRes.text();
        console.error(`Failed to insert into poll_winners: ${insertRes.status} - ${errorText}`);
      } else {
        console.log(`Inserted into poll_winners for option ${optionId}`);
      }

      await interaction.editReply({
        content: `✅ Winner #${winnerNumber} (${winnerName}) marked! Announcement posted in thread.`
      });

    } catch (err) {
      console.error('SELECTWINNER ERROR:', err);
      await interaction.editReply({
        content: '❌ Failed to select winner. Check logs.'
      });
    }
  }
};