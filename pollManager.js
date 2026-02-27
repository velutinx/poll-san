require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const LEVEL_MULTIPLIER_PER_LEVEL = 0.02;

const TIER_WEIGHTS = {
  '1465444240845963326': 1.2,
  '1465670134743044139': 1.5,
  '1465904476417163457': 1.8,
  '1465904548320378956': 2.0,
  '1465952085026541804': 2.3
};

const BOOSTER_ROLE_ID = '1469284491456548976';

const pollManager = {
  activePoll: null,
  updateInterval: null,
  winners: new Set(),

  NUMBER_EMOJIS: [
    '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟',
    '<:eleven:1475214132268761129>', '<:twelve:1475214143589056713>'
  ],

  formatTime: function(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  },

  calculateWeight: async function(guild, userId) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    try {
      let member;
      try {
        member = await guild.members.fetch(userId);
      } catch (fetchErr) {
        if (fetchErr.code === 10007) { // Unknown Member
          console.log(`[Weight] User ${userId} not in guild anymore → weight 1`);
          return 1;
        }
        throw fetchErr;
      }

      let weight = 1;

      for (const [roleId, bonus] of Object.entries(TIER_WEIGHTS)) {
        if (member.roles.cache.has(roleId)) {
          weight = Math.max(weight, bonus);
        }
      }

      if (member.roles.cache.has(BOOSTER_ROLE_ID)) {
        weight += 0.5;
      }

      const xpRes = await fetch(
        `${supabaseUrl}/rest/v1/user_xp?user_id=eq.${userId}&guild_id=eq.${guild.id}`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`
          }
        }
      );

      if (xpRes.ok) {
        const xpRows = await xpRes.json();
        const lvl = xpRows[0]?.level ?? 0;
        weight += lvl * LEVEL_MULTIPLIER_PER_LEVEL;
      }

      return weight;
    } catch (err) {
      console.error(`[Weight] Calculation failed for ${userId}:`, err);
      return 1;
    }
  },

  syncCurrentVotes: async function(message) {
    if (!this.activePoll || !message?.guild) {
      console.warn('[Poll] Cannot sync votes: no active poll or message');
      return;
    }

    console.log('🔄 [Poll Resume] Syncing live Discord reactions to discord_votes table...');

    const currentUserOption = new Map(); // userId → last optionIndex

    for (let i = 0; i < this.NUMBER_EMOJIS.length; i++) {
      const emojiStr = this.NUMBER_EMOJIS[i];
      const reaction = message.reactions.cache.find(r => r.emoji.toString() === emojiStr);

      if (!reaction) continue;

      try {
        const users = await reaction.users.fetch();
        users.delete(message.client.user.id);

        for (const userId of users.keys()) {
          currentUserOption.set(userId, i);
        }
      } catch (err) {
        console.error(`Failed to fetch users for ${emojiStr}:`, err);
      }
    }

    let updatedCount = 0;
    for (const [userId, optionIndex] of currentUserOption) {
      try {
        const member = await message.guild.members.fetch(userId).catch(() => null);
        if (!member) continue;

        await this.saveDiscordVote(member.user, optionIndex);
        updatedCount++;
      } catch (err) {
        console.error(`Failed to sync user ${userId} → option ${optionIndex + 1}:`, err);
      }
    }

    console.log(`✅ [Poll Resume] Synced ${updatedCount} Discord votes`);

    // Force refresh message after sync (THIS FIXES THE STALE DISPLAY ISSUE)
    try {
      const updatedContent = await this.buildPollMessage();
      await message.edit(updatedContent);
      console.log('[Poll Resume] Message refreshed after vote sync');
    } catch (err) {
      console.error('[Poll Resume] Failed to refresh message after sync:', err);
    }
  },

  fetchWebsiteVotes: async function() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;
    const pollId = 'character_poll_new';
    const websiteCounts = new Array(12).fill(0.0);

    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/votes?poll_id=eq.${pollId}&source=eq.website`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`
          }
        }
      );

      if (!res.ok) throw new Error(`Website votes fetch failed: ${res.status}`);

      const votes = await res.json();
      for (const vote of votes) {
        const optionIndex = parseInt(vote.option_id) - 1;
        if (optionIndex >= 0 && optionIndex < 12) {
          websiteCounts[optionIndex] += 1.0;
        }
      }
      return websiteCounts;
    } catch (err) {
      console.error('[Supabase] Website votes fetch failed:', err);
      return new Array(12).fill(0.0);
    }
  },

  updateSupabaseResults: async function(counts) {
    if (!this.activePoll || !this.activePoll.characters) return;

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;
    const pollId = 'character_poll_new';

    for (let i = 0; i < 12; i++) {
      const data = {
        poll_id: pollId,
        option_id: i + 1,
        character_name: this.activePoll.characters[i],
        score: counts[i],
        selected_at: null
      };

      try {
        const res = await fetch(`${supabaseUrl}/rest/v1/poll_result`, {
          method: 'POST',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates'
          },
          body: JSON.stringify(data)
        });

        if (!res.ok) {
          console.error(`Upsert failed for option ${i+1}: ${res.status}`);
        }
      } catch (err) {
        console.error('[Supabase] Result update failed:', err);
      }
    }
  },

  calculateCounts: async function(message) {
    const discordCounts = new Array(12).fill(0.0);

    for (let i = 0; i < 12; i++) {
      const emojiStr = this.NUMBER_EMOJIS[i];
      const reaction = message.reactions.cache.find(r => r.emoji.toString() === emojiStr);
      if (!reaction) continue;

      const users = await reaction.users.fetch();
      users.delete(message.client.user.id);

      for (const userId of users.keys()) {
        const weight = await this.calculateWeight(message.guild, userId);
        discordCounts[i] += weight;
      }
    }

    const websiteCounts = await this.fetchWebsiteVotes();
    return discordCounts.map((dc, i) => dc + websiteCounts[i]);
  },

  saveDiscordVote: async function(user, optionIndex) {
    if (!this.activePoll) return;

    try {
      const guild = this.activePoll.message.guild;
      const pollId = 'character_poll_new';
      const userId = user.id;
      const weight = await this.calculateWeight(guild, userId);
      const now = new Date().toISOString();

      const data = {
        poll_id: pollId,
        guild_id: guild.id,
        user_id: userId,
        option_id: optionIndex + 1,
        weight,
        discord_username: user.username,
        updated_at: now
      };

      const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/discord_votes`, {
        method: 'POST',
        headers: {
          apikey: process.env.SUPABASE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates'
        },
        body: JSON.stringify(data)
      });

      if (res.ok) {
        console.log(`Saved Discord vote for ${user.username} → option ${optionIndex + 1}`);
      } else {
        console.error(`Failed to save vote: ${res.status} - ${await res.text()}`);
      }
    } catch (err) {
      console.error('Error saving Discord vote:', err);
    }
  },

  saveActivePoll: async function() {
    if (!this.activePoll || !this.activePoll.message) return;

    try {
      const message = this.activePoll.message;
      const pollId = 'character_poll_new';
      const now = new Date().toISOString();
      const endsAt = new Date(this.activePoll.endTime).toISOString();

      const data = {
        poll_id: pollId,
        message_id: message.id,
        status_message_id: message.id,
        channel_id: message.channel.id,
        ends_at: endsAt,
        active: true,
        updated_at: now,
        original_message_id: message.id
      };

      const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/active_polls`, {
        method: 'POST',
        headers: {
          apikey: process.env.SUPABASE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates'
        },
        body: JSON.stringify(data)
      });

      if (!res.ok) {
        console.error(`Failed to save active poll: ${res.status} - ${await res.text()}`);
      } else {
        console.log('Saved active poll entry');
      }
    } catch (err) {
      console.error('Error saving active poll:', err);
    }
  },

  markWinnerInDb: async function(optionId) {
    try {
      const pollId = 'character_poll_new';
      const now = new Date().toISOString();

      const updateRes = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/poll_result?poll_id=eq.${pollId}&option_id=eq.${optionId}`,
        {
          method: 'PATCH',
          headers: {
            apikey: process.env.SUPABASE_KEY,
            Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal'
          },
          body: JSON.stringify({ selected_at: now })
        }
      );

      if (!updateRes.ok) {
        console.error(`Failed to update poll_result.selected_at: ${updateRes.status} - ${await updateRes.text()}`);
      } else {
        console.log(`Updated poll_result.selected_at for option ${optionId}`);
      }

      const insertRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/poll_winners`, {
        method: 'POST',
        headers: {
          apikey: process.env.SUPABASE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          poll_id: pollId,
          option_id: optionId,
          selected_at: now
        })
      });

      if (!insertRes.ok) {
        console.error(`Failed to insert poll_winners: ${insertRes.status} - ${await insertRes.text()}`);
      } else {
        console.log(`Inserted into poll_winners for option ${optionId}`);
      }
    } catch (err) {
      console.error('Error marking winner in DB:', err);
    }
  },

  resumePoll: async function(client) {
    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_KEY;

      const res = await fetch(
        `${supabaseUrl}/rest/v1/active_polls?active=eq.true&select=*`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      );

      if (!res.ok) throw new Error(`Active poll fetch failed: ${res.status}`);
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
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
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

      this.activePoll = {
        characters,
        endTime: new Date(activeRow.ends_at).getTime(),
        message,
        collector: null
      };

      // Re-add missing reactions
      for (const emoji of this.NUMBER_EMOJIS) {
        if (!message.reactions.cache.has(emoji)) {
          await message.react(emoji).catch(err => console.error('Failed to re-react:', err));
        }
      }

      // Sync existing votes & refresh message
      await this.syncCurrentVotes(message);

      // Resume collector for NEW reactions
      const filter = (reaction, user) => !user.bot && this.NUMBER_EMOJIS.includes(reaction.emoji.toString());
      const collector = message.createReactionCollector({
        filter,
        dispose: true,
        time: this.activePoll.endTime - Date.now()
      });

      this.activePoll.collector = collector;

      collector.on('collect', async (reaction, user) => {
        try {
          const optionIndex = this.NUMBER_EMOJIS.indexOf(reaction.emoji.toString());
          if (optionIndex === -1) return;

          await this.saveDiscordVote(user, optionIndex);

          // Enforce single vote
          const otherReactions = message.reactions.cache.filter(r =>
            this.NUMBER_EMOJIS.includes(r.emoji.toString()) &&
            r.emoji.toString() !== reaction.emoji.toString() &&
            r.users.cache.has(user.id)
          );

          for (const r of otherReactions.values()) {
            await r.users.remove(user.id).catch(() => {});
          }

          const updatedContent = await this.buildPollMessage();
          await message.edit(updatedContent);
        } catch (err) {
          console.error('Failed to process vote:', err);
        }
      });

      collector.on('dispose', async () => {
        try {
          const updatedContent = await this.buildPollMessage();
          await message.edit(updatedContent);
        } catch (err) {
          console.error('Failed to update on dispose:', err);
        }
      });

      // Timer to update message periodically
      this.updateInterval = setInterval(async () => {
        if (!this.activePoll) return;

        const timeLeft = this.activePoll.endTime - Date.now();
        if (timeLeft <= 0) {
          clearInterval(this.updateInterval);
          this.updateInterval = null;
          if (this.activePoll.collector) this.activePoll.collector.stop();

          const finalContent = await this.buildPollMessage();
          const finalText = finalContent.replace(/⏳ Time remaining: .*\n/, '🛑 Poll has ended.\n');
          await this.activePoll.message.edit(finalText).catch(console.error);

          this.activePoll = null;
          this.winners = new Set();
          return;
        }

        const updatedContent = await this.buildPollMessage();
        await this.activePoll.message.edit(updatedContent).catch(console.error);
      }, 10000);

      console.log('Poll resumed successfully from database');
    } catch (err) {
      console.error('Failed to resume poll:', err);
    }
  },

  startPoll: async function(client, days, characters) {
    try {
      if (this.activePoll) {
        throw new Error('A poll is already running.');
      }

      const channel = await client.channels.fetch(process.env.POLL_CHANNEL_ID).catch(() => null);
      if (!channel) {
        throw new Error('Poll channel not found or bot lacks access.');
      }

      const endTime = Date.now() + days * 24 * 60 * 60 * 1000;

      const pollData = {
        characters,
        endTime,
        message: null,
        collector: null
      };

      this.activePoll = pollData;
      this.winners = new Set();

      const content = await this.buildPollMessage();
      const message = await channel.send(content);

      this.activePoll.message = message;

      for (const emoji of this.NUMBER_EMOJIS) {
        try {
          await message.react(emoji);
        } catch (err) {
          console.error('Failed to react with', emoji, err);
        }
      }

      await this.saveActivePoll();

      await this.createCharacterThread();

      const filter = (reaction, user) => !user.bot && this.NUMBER_EMOJIS.includes(reaction.emoji.toString());
      const collector = message.createReactionCollector({ filter, dispose: true, time: days * 24 * 60 * 60 * 1000 });

      this.activePoll.collector = collector;

      collector.on('collect', async (reaction, user) => {
        try {
          const optionIndex = this.NUMBER_EMOJIS.indexOf(reaction.emoji.toString());
          if (optionIndex === -1) return;

          await this.saveDiscordVote(user, optionIndex);

          const otherReactions = message.reactions.cache.filter(r =>
            this.NUMBER_EMOJIS.includes(r.emoji.toString()) &&
            r.emoji.toString() !== reaction.emoji.toString() &&
            r.users.cache.has(user.id)
          );

          for (const r of otherReactions.values()) {
            await r.users.remove(user.id);
          }

          const updatedContent = await this.buildPollMessage();
          await message.edit(updatedContent);
        } catch (err) {
          console.error('Failed to process vote:', err);
        }
      });

      collector.on('dispose', async (reaction, user) => {
        try {
          const updatedContent = await this.buildPollMessage();
          await message.edit(updatedContent);
        } catch (err) {
          console.error('Failed to update on dispose:', err);
        }
      });

      this.updateInterval = setInterval(async () => {
        try {
          if (!this.activePoll) return;

          const timeLeft = this.activePoll.endTime - Date.now();

          if (timeLeft <= 0) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
            if (this.activePoll?.collector) this.activePoll.collector.stop();

            if (this.activePoll?.message) {
              const finalContent = await this.buildPollMessage();
              const finalText = finalContent.replace(/⏳ Time remaining: .*\n/, '🛑 Poll has ended.\n');
              await this.activePoll.message.edit(finalText);
            }

            this.activePoll = null;
            this.winners = new Set();
            return;
          }

          const updatedContent = await this.buildPollMessage();
          if (this.activePoll?.message) {
            await this.activePoll.message.edit(updatedContent);
          }
        } catch (err) {
          console.error('Poll update error:', err);
        }
      }, 10000);

    } catch (err) {
      console.error('POLL START ERROR:', err);
      throw err;
    }
  },

  stopPoll: async function() {
    if (!this.activePoll) {
      return false;
    }

    try {
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = null;
      }

      if (this.activePoll.collector) {
        this.activePoll.collector.stop();
      }

      if (this.activePoll.message) {
        const finalContent = await this.buildPollMessage();
        const finalText = finalContent.replace(/⏳ Time remaining: .*\n/, '🛑 Poll has ended.\n');
        await this.activePoll.message.edit(finalText);
      }

      this.activePoll = null;
      this.winners = new Set();
      console.log('Poll stopped manually');
      return true;
    } catch (err) {
      console.error('Error stopping poll:', err);
      return false;
    }
  },

    buildPollMessage: async function() {
    if (!this.activePoll) return 'No active poll.';

    const { characters, endTime, message } = this.activePoll;
    const timeRemaining = this.formatTime(endTime - Date.now());
    const now = new Date().toLocaleString();

    let resultText = `⏳ Time remaining: ${timeRemaining}\n`;
    resultText += `📊 Current Results (${now})\n\n`;

    const counts = message ? await this.calculateCounts(message) : new Array(12).fill(0);

    await this.updateSupabaseResults(counts);

    for (let i = 0; i < characters.length; i++) {
      resultText += `${this.NUMBER_EMOJIS[i]} = ${counts[i].toFixed(2)} -- ${characters[i]}\n`;
    }

    resultText += `\nDiscord weighted vote + Website poll results\n\n`;
    resultText += `👇 Click the thread below for character images & discussion!`;

    return resultText;
  },


  createCharacterThread: async function() {
    if (!this.activePoll || !this.activePoll.message) {
      console.warn('Cannot create thread: no active poll or message');
      return;
    }

    try {
      const message = this.activePoll.message;
      const thread = await message.startThread({
        name: 'Character Images & Discussion',
        autoArchiveDuration: 1440,
        reason: 'Thread for poll character images'
      });

      const groups = [
        { start: 0, end: 4 },
        { start: 4, end: 8 },
        { start: 8, end: 12 }
      ];

      for (const group of groups) {
        let content = '';

        for (let i = group.start; i < group.end; i++) {
          const emoji = this.NUMBER_EMOJIS[i];
          const name = this.activePoll.characters[i];
          content += `${emoji} ${name}\n`;
        }

        const files = [];
        for (let i = group.start; i < group.end; i++) {
          const num = (i + 1).toString();
          const imageUrl = `https://velutinx.github.io/images/poll/${num}.jpg`;
          files.push(imageUrl);
        }

        await thread.send({
          content: content.trim(),
          files: files
        });
      }

      await thread.send('👆 Character images for the poll above!');

      console.log('Character thread created successfully');
    } catch (err) {
      console.error('Failed to create character thread:', err);
    }
  }
};

module.exports = pollManager;
