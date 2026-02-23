require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const pollManager = require('./pollManager'); // Reuse NUMBER_EMOJIS

const QUEUE_CHANNEL_ID = '1473730427318435860';
const QUEUE_TABLE = 'queue_state';
const QUEUE_ID = 'main_queue'; // Fixed ID for single row

const queueManager = {
  activeQueue: [],
  message: null,

  NUMBER_EMOJIS: pollManager.NUMBER_EMOJIS, // Reuse from poll

  loadQueueFromSupabase: async function() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/${QUEUE_TABLE}?id=eq.${QUEUE_ID}`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`
          }
        }
      );

      if (!res.ok) {
        console.error(`Failed to fetch queue: ${res.status}`);
        return { queue: [], message_id: null };
      }

      const rows = await res.json();
      if (rows.length === 0) {
        return { queue: [], message_id: null };
      }

      return rows[0];
    } catch (err) {
      console.error('[Queue] Load failed:', err);
      return { queue: [], message_id: null };
    }
  },

  saveQueueToSupabase: async function() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    const data = {
      id: QUEUE_ID,
      queue: this.activeQueue,
      message_id: this.message?.id || null,
      channel_id: QUEUE_CHANNEL_ID,
      updated_at: new Date().toISOString()
    };

    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/${QUEUE_TABLE}`, {
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
        console.error(`Failed to save queue: ${res.status} - ${await res.text()}`);
      } else {
        console.log('Saved queue to Supabase');
      }
    } catch (err) {
      console.error('[Queue] Save failed:', err);
    }
  },

  buildQueueMessage: function() {
    if (this.activeQueue.length === 0) {
      return 'Queue is empty.';
    }

    let text = '';
    this.activeQueue.forEach((item, index) => {
      text += `${this.NUMBER_EMOJIS[index]} ${item}\n`;
    });

    return text.trim();
  },

  resumeQueue: async function(client) {
    try {
      const state = await this.loadQueueFromSupabase();
      this.activeQueue = state.queue || [];

      const channel = await client.channels.fetch(QUEUE_CHANNEL_ID).catch(() => null);
      if (!channel) {
        console.error('[Queue] Channel not found');
        return;
      }

      if (state.message_id) {
        const message = await channel.messages.fetch(state.message_id).catch(() => null);
        if (message) {
          this.message = message;
          // Update message on resume (in case manual edits)
          const content = this.buildQueueMessage();
          await message.edit(content);
          console.log('[Queue] Resumed and updated message');
        } else {
          console.warn('[Queue] Message not found, sending new one');
          await this.sendOrUpdateMessage(channel);
        }
      } else if (this.activeQueue.length > 0) {
        console.log('[Queue] No message ID, sending new one');
        await this.sendOrUpdateMessage(channel);
      }

      console.log('[Queue] Resumed successfully');
    } catch (err) {
      console.error('[Queue] Resume failed:', err);
    }
  },

  sendOrUpdateMessage: async function(channel) {
    const content = this.buildQueueMessage();

    if (this.message) {
      await this.message.edit(content);
    } else {
      this.message = await channel.send(content);
    }

    await this.saveQueueToSupabase();
  },

  addToQueue: async function(client, item) {
    this.activeQueue.push(item);
    const channel = await client.channels.fetch(QUEUE_CHANNEL_ID);
    await this.sendOrUpdateMessage(channel);
  },

  removeFromQueue: async function(client, position) {
    if (position < 1 || position > this.activeQueue.length) {
      throw new Error('Invalid position');
    }

    this.activeQueue.splice(position - 1, 1);
    const channel = await client.channels.fetch(QUEUE_CHANNEL_ID);
    await this.sendOrUpdateMessage(channel);
  }
};

module.exports = queueManager;
