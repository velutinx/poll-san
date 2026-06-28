// web/routes/queue.js – with toggle & strikethrough
const h = require('../../utils/helpers');
const db = require('../../services/database');

const QUEUE_CHANNEL_ID = h.ids.channels.QUEUE;
const LOGO_URL = h.urls.LOGO_URL;
const DISCORD_API = 'https://discord.com/api/v10';

// Helper: get or create webhook
async function getQueueWebhook(channel) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN not set');

  const channelUrl = `${DISCORD_API}/channels/${channel.id}`;
  const whListResp = await fetch(`${channelUrl}/webhooks`, {
    headers: { Authorization: `Bot ${token}` },
  });
  let webhookUrl = null;
  if (whListResp.ok) {
    const webhooks = await whListResp.json();
    const existing = webhooks.find(w => w.name === 'Queue');
    if (existing) {
      webhookUrl = `${DISCORD_API}/webhooks/${existing.id}/${existing.token}`;
      await fetch(webhookUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bot ${token}` },
        body: JSON.stringify({ avatar: LOGO_URL }),
      });
    }
  }
  if (!webhookUrl) {
    const createResp = await fetch(`${channelUrl}/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bot ${token}` },
      body: JSON.stringify({ name: 'Queue', avatar: LOGO_URL }),
    });
    if (!createResp.ok) throw new Error('Failed to create webhook');
    const created = await createResp.json();
    webhookUrl = `${DISCORD_API}/webhooks/${created.id}/${created.token}`;
  }
  return webhookUrl;
}

// Normalize all items to objects
function normalizeQueue(queue) {
  return queue.map(item => {
    if (typeof item === 'string') {
      return { text: item, checked: false };
    }
    return {
      text: item.text || item,
      checked: item.checked || false,
      completedAt: item.completedAt || null
    };
  });
}

// Remove items checked for >7 days
function cleanExpiredQueue(queue) {
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  return queue.filter(item => {
    if (item.checked && item.completedAt) {
      const age = now - new Date(item.completedAt).getTime();
      if (age >= sevenDays) return false;
    }
    return true;
  });
}

// Update Discord message with strikethrough
async function updateDiscordQueue(client) {
  try {
    const row = await db.query(
      `SELECT queue, message_id, channel_id FROM ${h.tables.MAIN_QUEUE} WHERE id = 1`,
      [],
      true
    );
    if (!row) return;

    let queue = JSON.parse(row.queue || '[]');
    queue = normalizeQueue(queue);
    const cleaned = cleanExpiredQueue(queue);
    if (cleaned.length !== queue.length) {
      queue = cleaned;
      await db.query(
        `UPDATE ${h.tables.MAIN_QUEUE} SET queue = ?, updated_at = datetime('now') WHERE id = 1`,
        [JSON.stringify(queue)]
      );
    }

    const channel = await client.channels.fetch(QUEUE_CHANNEL_ID);
    if (!channel) return;

    const webhookUrl = await getQueueWebhook(channel);
    const progressEmoji = h.releaseEmojis.PROGRESS || '<a:progress:1491670111923212308>';
    const diamondEmoji = h.releaseEmojis.DIAMOND || ':gem:';
    const blankEmoji = h.releaseEmojis.BLANK || '';

    let content = `${progressEmoji} **Current queue** (general idea, subject to change):\n\n`;
    if (queue.length === 0) {
      content += '*Queue is empty.*';
    } else {
      const lines = queue.map(item => {
        const text = item.text;
        const checked = item.checked || false;
        const displayText = checked ? `~~${text}~~` : text;
        const bullet = checked ? `•` : `•`;
        const emoji = checked ? diamondEmoji : blankEmoji;
        return `${bullet} ${emoji} ${displayText}`;
      });
      content += lines.join('\n');
    }

    if (row.message_id) {
      try {
        await fetch(`${webhookUrl}/messages/${row.message_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            username: 'Queue',
            avatar_url: LOGO_URL,
          }),
        });
      } catch (err) {
        console.warn('Could not edit queue message, sending new:', err.message);
        const msgRes = await fetch(`${webhookUrl}?wait=true`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            username: 'Queue',
            avatar_url: LOGO_URL,
          }),
        });
        const msg = await msgRes.json();
        if (msg.id) {
          await db.query(
            `UPDATE ${h.tables.MAIN_QUEUE} SET message_id = ? WHERE id = 1`,
            [msg.id]
          );
        }
      }
    } else {
      const msgRes = await fetch(`${webhookUrl}?wait=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          username: 'Queue',
          avatar_url: LOGO_URL,
        }),
      });
      const msg = await msgRes.json();
      if (msg.id) {
        await db.query(
          `UPDATE ${h.tables.MAIN_QUEUE} SET message_id = ? WHERE id = 1`,
          [msg.id]
        );
      }
    }
  } catch (err) {
    console.error('updateDiscordQueue error:', err);
    throw err;
  }
}

module.exports = function setupQueueRoutes(app, client) {
  // GET /api/queue
  app.get('/api/queue', async (req, res) => {
    try {
      const row = await db.query(
        `SELECT queue FROM ${h.tables.MAIN_QUEUE} WHERE id = 1`,
        [],
        true
      );
      let queue = row ? JSON.parse(row.queue || '[]') : [];
      queue = normalizeQueue(queue);
      const cleaned = cleanExpiredQueue(queue);
      if (cleaned.length !== queue.length) {
        queue = cleaned;
        await db.query(
          `UPDATE ${h.tables.MAIN_QUEUE} SET queue = ?, updated_at = datetime('now') WHERE id = 1`,
          [JSON.stringify(queue)]
        );
        await updateDiscordQueue(client);
      }
      res.json({ queue });
    } catch (err) {
      console.error('GET /api/queue error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/queue/add
  app.post('/api/queue/add', async (req, res) => {
    const { entry } = req.body;
    if (!entry || typeof entry !== 'string' || !entry.trim()) {
      return res.status(400).json({ error: 'Missing or invalid entry' });
    }
    try {
      const row = await db.query(
        `SELECT queue FROM ${h.tables.MAIN_QUEUE} WHERE id = 1`,
        [],
        true
      );
      let queue = row ? JSON.parse(row.queue || '[]') : [];
      queue = normalizeQueue(queue);
      queue.push({ text: entry.trim(), checked: false });
      await db.query(
        `UPDATE ${h.tables.MAIN_QUEUE} SET queue = ?, updated_at = datetime('now') WHERE id = 1`,
        [JSON.stringify(queue)]
      );
      await updateDiscordQueue(client);
      res.json({ success: true, queue });
    } catch (err) {
      console.error('POST /api/queue/add error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/queue/toggle – mark/unmark as done
  app.post('/api/queue/toggle', async (req, res) => {
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
      let queue = JSON.parse(row.queue || '[]');
      queue = normalizeQueue(queue);
      if (index >= queue.length) {
        return res.status(400).json({ error: 'Index out of bounds' });
      }

      const item = queue[index];
      if (item.checked) {
        // Uncheck
        item.checked = false;
        delete item.completedAt;
      } else {
        // Check
        item.checked = true;
        item.completedAt = new Date().toISOString();
      }

      await db.query(
        `UPDATE ${h.tables.MAIN_QUEUE} SET queue = ?, updated_at = datetime('now') WHERE id = 1`,
        [JSON.stringify(queue)]
      );
      await updateDiscordQueue(client);
      res.json({ success: true, queue });
    } catch (err) {
      console.error('POST /api/queue/toggle error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/queue/reorder
  app.post('/api/queue/reorder', async (req, res) => {
    const { queue } = req.body;
    if (!Array.isArray(queue)) {
      return res.status(400).json({ error: 'Queue must be an array' });
    }
    try {
      const normalized = normalizeQueue(queue);
      await db.query(
        `UPDATE ${h.tables.MAIN_QUEUE} SET queue = ?, updated_at = datetime('now') WHERE id = 1`,
        [JSON.stringify(normalized)]
      );
      await updateDiscordQueue(client);
      res.json({ success: true });
    } catch (err) {
      console.error('POST /api/queue/reorder error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/queue/remove – permanent delete (use sparingly)
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
      let queue = JSON.parse(row.queue || '[]');
      queue = normalizeQueue(queue);
      if (index >= queue.length) {
        return res.status(400).json({ error: 'Index out of bounds' });
      }
      queue.splice(index, 1);
      await db.query(
        `UPDATE ${h.tables.MAIN_QUEUE} SET queue = ?, updated_at = datetime('now') WHERE id = 1`,
        [JSON.stringify(queue)]
      );
      await updateDiscordQueue(client);
      res.json({ success: true, queue });
    } catch (err) {
      console.error('POST /api/queue/remove error:', err);
      res.status(500).json({ error: err.message });
    }
  });
};

module.exports.updateDiscordQueue = updateDiscordQueue;
