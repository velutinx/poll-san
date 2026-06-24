// web/routes/queue.js
const h = require('../../utils/helpers');
const db = require('../../services/database');

const QUEUE_CHANNEL_ID = h.ids.channels.QUEUE;
const LOGO_URL = h.urls.LOGO_URL;
const DISCORD_API = 'https://discord.com/api/v10';

// Helper: get or create the "Queue" webhook
async function getQueueWebhook(channel, env) {
  const webhooks = await channel.fetchWebhooks();
  let webhook = webhooks.find(w => w.name === 'Queue');
  if (!webhook) {
    webhook = await channel.createWebhook({
      name: 'Queue',
      avatar: LOGO_URL
    });
  } else {
    // Update avatar if needed
    if (webhook.avatar !== LOGO_URL) {
      await webhook.edit({ avatar: LOGO_URL });
    }
  }
  return webhook;
}

// Helper: update Discord message with current queue
async function updateDiscordQueue(client, env) {
  const row = await db.query(
    `SELECT queue, message_id, channel_id FROM ${h.tables.MAIN_QUEUE} WHERE id = 1`,
    [],
    true
  );
  if (!row) return;

  const queue = JSON.parse(row.queue || '[]');
  const channel = await client.channels.fetch(QUEUE_CHANNEL_ID);
  if (!channel) return;

  const webhook = await getQueueWebhook(channel, env);
  const progressEmoji = h.releaseEmojis.PROGRESS || '<a:progress:1491670111923212308>';

  let content = `${progressEmoji} **Current queue** (general idea, subject to change):\n\n`;
  if (queue.length === 0) {
    content += '*Queue is empty.*';
  } else {
    content += queue.map(item => `• ${item}`).join('\n');
  }

  // If we have a stored message ID, edit it; otherwise send new
  if (row.message_id) {
    try {
      await webhook.editMessage(row.message_id, {
        content,
        username: 'Queue',
        avatarURL: LOGO_URL
      });
    } catch (err) {
      // Message might have been deleted – fallback to send new
      console.warn('Could not edit queue message, sending new:', err.message);
      const msg = await webhook.send({
        content,
        username: 'Queue',
        avatarURL: LOGO_URL
      });
      await db.query(
        `UPDATE ${h.tables.MAIN_QUEUE} SET message_id = ? WHERE id = 1`,
        [msg.id]
      );
    }
  } else {
    const msg = await webhook.send({
      content,
      username: 'Queue',
      avatarURL: LOGO_URL
    });
    await db.query(
      `UPDATE ${h.tables.MAIN_QUEUE} SET message_id = ? WHERE id = 1`,
      [msg.id]
    );
  }
}

module.exports = function setupQueueRoutes(app, client, env) {
  // GET /api/queue – fetch current queue
  app.get('/api/queue', async (req, res) => {
    try {
      const row = await db.query(
        `SELECT queue FROM ${h.tables.MAIN_QUEUE} WHERE id = 1`,
        [],
        true
      );
      const queue = row ? JSON.parse(row.queue || '[]') : [];
      res.json({ queue });
    } catch (err) {
      console.error('GET /api/queue error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/queue/add – add a new entry
  app.post('/api/queue/add', async (req, res) => {
    const { entry } = req.body;
    if (!entry || typeof entry !== 'string' || !entry.trim()) {
      return res.status(400).json({ error: 'Missing or invalid entry' });
    }
    try {
      // Fetch current queue
      const row = await db.query(
        `SELECT queue FROM ${h.tables.MAIN_QUEUE} WHERE id = 1`,
        [],
        true
      );
      const queue = row ? JSON.parse(row.queue || '[]') : [];
      queue.push(entry.trim());

      // Update DB
      await db.query(
        `UPDATE ${h.tables.MAIN_QUEUE} SET queue = ?, updated_at = datetime('now') WHERE id = 1`,
        [JSON.stringify(queue)]
      );

      // Update Discord message
      await updateDiscordQueue(client, env);

      res.json({ success: true, queue });
    } catch (err) {
      console.error('POST /api/queue/add error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/queue/reorder – update entire queue order
  app.post('/api/queue/reorder', async (req, res) => {
    const { queue } = req.body;
    if (!Array.isArray(queue)) {
      return res.status(400).json({ error: 'Queue must be an array' });
    }
    try {
      await db.query(
        `UPDATE ${h.tables.MAIN_QUEUE} SET queue = ?, updated_at = datetime('now') WHERE id = 1`,
        [JSON.stringify(queue)]
      );
      await updateDiscordQueue(client, env);
      res.json({ success: true });
    } catch (err) {
      console.error('POST /api/queue/reorder error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/queue/remove – remove entry at given index
  app.post('/api/queue/remove', async (req, res) => {
    const { index } = req.body;
    if (typeof index !== 'number' || index < 0) {
      return res.status(400).json({ error: 'Invalid index' });
    }
    try {
      const row = await db.query(
        `SELECT queue FROM ${h.tables.MAIN_QUEUE} WHERE id = 1`,
        [],
        true
      );
      if (!row) return res.status(404).json({ error: 'Queue not found' });
      const queue = JSON.parse(row.queue || '[]');
      if (index >= queue.length) {
        return res.status(400).json({ error: 'Index out of bounds' });
      }
      queue.splice(index, 1);
      await db.query(
        `UPDATE ${h.tables.MAIN_QUEUE} SET queue = ?, updated_at = datetime('now') WHERE id = 1`,
        [JSON.stringify(queue)]
      );
      await updateDiscordQueue(client, env);
      res.json({ success: true, queue });
    } catch (err) {
      console.error('POST /api/queue/remove error:', err);
      res.status(500).json({ error: err.message });
    }
  });
};
