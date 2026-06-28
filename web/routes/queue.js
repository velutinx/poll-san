// web/routes/queue.js – separate premium & finished actions
const h = require('../../utils/helpers');
const db = require('../../services/database');

const QUEUE_CHANNEL_ID = h.ids.channels.QUEUE;
const LOGO_URL = h.urls.LOGO_URL;
const DISCORD_API = 'https://discord.com/api/v10';

// ─── HELPERS ────────────────────────────────────────────────

function normalizeQueue(queue) {
  if (!Array.isArray(queue)) return [];
  return queue.map(item => {
    if (typeof item === 'string') {
      return { text: item, checked: false, slashed: false, slashedAt: null };
    }
    return {
      text: item.text || item,
      checked: !!item.checked,
      slashed: !!item.slashed,
      slashedAt: item.slashedAt || null
    };
  });
}

// Remove items that have been slashed for >7 days
function cleanExpiredQueue(queue) {
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  return queue.filter(item => {
    if (item.slashed && item.slashedAt) {
      const age = now - new Date(item.slashedAt).getTime();
      if (age >= sevenDays) return false;
    }
    return true;
  });
}

async function getQueue() {
  const row = await db.query(
    `SELECT queue FROM ${h.tables.MAIN_QUEUE} WHERE id = 1`,
    [],
    true
  );
  let raw = row ? JSON.parse(row.queue || '[]') : [];
  let queue = normalizeQueue(raw);
  const cleaned = cleanExpiredQueue(queue);
  if (cleaned.length !== queue.length) {
    queue = cleaned;
    await db.query(
      `UPDATE ${h.tables.MAIN_QUEUE} SET queue = ?, updated_at = datetime('now') WHERE id = 1`,
      [JSON.stringify(queue)]
    );
  }
  return queue;
}

async function updateDiscordQueue(client) {
  try {
    const queue = await getQueue();
    const channel = await client.channels.fetch(QUEUE_CHANNEL_ID);
    if (!channel) throw new Error('Channel not found');

    const token = process.env.DISCORD_TOKEN;
    if (!token) throw new Error('DISCORD_TOKEN missing');

    // Webhook handling (same as before)
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

    // Build message
    const progressEmoji = h.releaseEmojis.PROGRESS || '<a:progress:1491670111923212308>';
    const diamondEmoji = h.releaseEmojis.DIAMOND || ':gem:';
    const blankEmoji = h.releaseEmojis.BLANK || '';

    let content = `${progressEmoji} **Current queue** (general idea, subject to change):\n\n`;
    if (queue.length === 0) {
      content += '*Queue is empty.*';
    } else {
      const lines = queue.map(item => {
        let text = item.text;
        let prefix = '•';
        let emoji = blankEmoji;

        if (item.checked) {
          emoji = diamondEmoji;
          text = `**${text}**`;  // bold for premium
        }
        if (item.slashed) {
          text = `~~${text}~~`;  // strikethrough for finished
        }
        return `${prefix} ${emoji} ${text}`;
      });
      content += lines.join('\n');
    }

    // Update existing message or send new
    const row = await db.query(
      `SELECT message_id FROM ${h.tables.MAIN_QUEUE} WHERE id = 1`,
      [],
      true
    );
    const messageId = row?.message_id;

    if (messageId) {
      const resp = await fetch(`${webhookUrl}/messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, username: 'Queue', avatar_url: LOGO_URL }),
      });
      if (!resp.ok) throw new Error(`Edit failed: ${resp.status}`);
    } else {
      const msgRes = await fetch(`${webhookUrl}?wait=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, username: 'Queue', avatar_url: LOGO_URL }),
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
    console.error('updateDiscordQueue error (non‑fatal):', err.message);
  }
}

// ─── ROUTES ──────────────────────────────────────────────────

module.exports = function setupQueueRoutes(app, client) {
  // GET /api/queue
  app.get('/api/queue', async (req, res) => {
    try {
      const queue = await getQueue();
      res.json({ queue });
    } catch (err) {
      console.error(err);
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
      let queue = await getQueue();
      queue.push({ text: entry.trim(), checked: false, slashed: false, slashedAt: null });
      await db.query(
        `UPDATE ${h.tables.MAIN_QUEUE} SET queue = ?, updated_at = datetime('now') WHERE id = 1`,
        [JSON.stringify(queue)]
      );
      updateDiscordQueue(client);
      res.json({ success: true, queue });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/queue/toggle – premium (checkbox)
  app.post('/api/queue/toggle', async (req, res) => {
    const { index } = req.body;
    if (typeof index !== 'number' || index < 0) {
      return res.status(400).json({ error: 'Invalid index' });
    }
    try {
      let queue = await getQueue();
      if (index >= queue.length) {
        return res.status(400).json({ error: 'Index out of bounds' });
      }
      const item = queue[index];
      item.checked = !item.checked;
      await db.query(
        `UPDATE ${h.tables.MAIN_QUEUE} SET queue = ?, updated_at = datetime('now') WHERE id = 1`,
        [JSON.stringify(queue)]
      );
      updateDiscordQueue(client);
      res.json({ success: true, queue });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/queue/slash – finish/delete (strikethrough + 7d expiry)
  app.post('/api/queue/slash', async (req, res) => {
    const { index } = req.body;
    if (typeof index !== 'number' || index < 0) {
      return res.status(400).json({ error: 'Invalid index' });
    }
    try {
      let queue = await getQueue();
      if (index >= queue.length) {
        return res.status(400).json({ error: 'Index out of bounds' });
      }
      const item = queue[index];
      if (item.slashed) {
        // Un‑slash (if you want to allow undo)
        item.slashed = false;
        item.slashedAt = null;
      } else {
        item.slashed = true;
        item.slashedAt = new Date().toISOString();
      }
      await db.query(
        `UPDATE ${h.tables.MAIN_QUEUE} SET queue = ?, updated_at = datetime('now') WHERE id = 1`,
        [JSON.stringify(queue)]
      );
      updateDiscordQueue(client);
      res.json({ success: true, queue });
    } catch (err) {
      console.error(err);
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
      updateDiscordQueue(client);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
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
      let queue = await getQueue();
      if (index >= queue.length) {
        return res.status(400).json({ error: 'Index out of bounds' });
      }
      queue.splice(index, 1);
      await db.query(
        `UPDATE ${h.tables.MAIN_QUEUE} SET queue = ?, updated_at = datetime('now') WHERE id = 1`,
        [JSON.stringify(queue)]
      );
      updateDiscordQueue(client);
      res.json({ success: true, queue });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
};

module.exports.updateDiscordQueue = updateDiscordQueue;
