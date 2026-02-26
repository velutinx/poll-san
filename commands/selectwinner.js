require('dotenv').config();
const { SlashCommandBuilder } = require('discord.js');

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '') || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const POLL_ID = 'character_poll_new';
const OWNER_ID = '1380051214766444617';  // ← your ID

async function safeFetch(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeout);
    return res;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

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

    await interaction.deferReply({ ephemeral: true });

    if (interaction.user.id !== OWNER_ID) {
      return interaction.editReply({ content: '❌ You are not allowed to select winners.' });
    }

    try {
      const winnerNumber = interaction.options.getInteger('number');

      // ─────────────────────────────────────────────
      // 1. Fetch current poll results
      // ─────────────────────────────────────────────
      const resultRes = await safeFetch(
        `${SUPABASE_URL}/rest/v1/poll_result?poll_id=eq.${POLL_ID}&select=option_id,character_name,score&order=option_id.asc`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`
          }
        }
      );

      if (!resultRes.ok) {
        console.error('poll_result fetch failed:', await resultRes.text());
        return interaction.editReply({ content: '❌ Failed to fetch poll results.' });
      }

      const rows = await resultRes.json();
      if (!rows.length) {
        return interaction.editReply({ content: '⚠️ No poll results found.' });
      }

      const characters = rows.map(r => r.character_name);
      const counts = rows.map(r => parseFloat(r.score ?? 0));

      // ─────────────────────────────────────────────
      // 2. Fetch ALL previous winners from poll_winners
      // ─────────────────────────────────────────────
      const winnersRes = await safeFetch(
        `${SUPABASE_URL}/rest/v1/poll_winners?poll_id=eq.${POLL_ID}&select=option_id`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`
          }
        }
      );

      if (!winnersRes.ok) {
        console.error('poll_winners fetch failed:', await winnersRes.text());
        // Continue anyway - treat as no previous winners
        var winnerIds = new Set([winnerNumber]);
      } else {
        const winnerRows = await winnersRes.json();
        var winnerIds = new Set(winnerRows.map(r => r.option_id));
        winnerIds.add(winnerNumber);  // include the one we just selected
      }

      // ─────────────────────────────────────────────
      // 3. Build announcement text with ALL winners spoiled
      // ─────────────────────────────────────────────
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      const formattedNow = `${dateStr}, ${timeStr}`;

      let resultText = `📊 Current Results (${formattedNow})\n\n`;

      for (let i = 0; i < characters.length; i++) {
        const emoji = [
          '1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣',
          '7️⃣','8️⃣','9️⃣','🔟',
          '<:eleven:1475214132268761129>',
          '<:twelve:1475214143589056713>'
        ][i];

        const line = `${emoji} = ${counts[i].toFixed(1)} -- ${characters[i]}`;
        const isWinner = winnerIds.has(i + 1);

        resultText += isWinner ? `||${line}||\n` : `${line}\n`;
      }

      const winnerName = characters[winnerNumber - 1] || `Option ${winnerNumber}`;
      const announcement = `**${winnerName} has been marked as a poll winner! 🎉**\n\n${resultText}`;

      // ─────────────────────────────────────────────
      // 4. Save the new winner to database
      // ─────────────────────────────────────────────
      const selectedAt = now.toISOString();

      // Update poll_result (if not already set)
      await safeFetch(
        `${SUPABASE_URL}/rest/v1/poll_result?poll_id=eq.${POLL_ID}&option_id=eq.${winnerNumber}`,
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

      // Insert into poll_winners (merge-duplicates prevents duplicates)
      await safeFetch(
        `${SUPABASE_URL}/rest/v1/poll_winners`,
        {
          method: 'POST',
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates'
          },
          body: JSON.stringify({
            poll_id: POLL_ID,
            option_id: winnerNumber,
            selected_at: selectedAt
          })
        }
      );

      // ─────────────────────────────────────────────
      // 5. Optional: post to thread
      // ─────────────────────────────────────────────
      try {
        const channel = await interaction.client.channels.fetch(process.env.POLL_CHANNEL_ID);
        const messages = await channel.messages.fetch({ limit: 10 });

        const pollMessage = messages.find(m =>
          m.author.id === interaction.client.user.id &&
          m.content.includes('Time remaining')
        );

        if (pollMessage?.hasThread) {
          const thread = await pollMessage.thread.fetch();
          await thread.send(announcement);
        }
      } catch (threadErr) {
        console.warn('Thread post skipped:', threadErr.message);
      }

      // ─────────────────────────────────────────────
      // 6. Success reply
      // ─────────────────────────────────────────────
      await interaction.editReply({
        content: `✅ Winner #${winnerNumber} (${winnerName}) marked! All winners are now spoiled in the announcement.`
      });

    } catch (err) {
      console.error('SELECTWINNER ERROR:', err);
      await interaction.editReply({
        content: '❌ Failed to select winner. Check logs.'
      }).catch(() => {});
    }
  }
};
