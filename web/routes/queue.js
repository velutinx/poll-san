// web/routes/queue.js – with debug logging and in‑memory cache fallback
const h = require('../../utils/helpers');
const db = require('../../services/database');

const QUEUE_CHANNEL_ID = h.ids.channels.QUEUE;
const LOGO_URL = h.urls.LOGO_URL;
const DISCORD_API = 'https://discord.com/api/v10';

// ─── NORMALIZE ────────────────────────────────────────────────
function normalizeQueue(queue) {
  if (!Array.isArray(queue)) return [];
  return queue.map(item => {
    if (typeof item === 'string') {
      return { text: item, checked: false, completedAt: null };
    }
    return {
      text: item.text || item,
      checked: !!item.checked,
      completedAt: item.completedAt || null
    };
  });
}

function cleanExpired(queue) {
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

// ─── GET QUEUE FROM DB ──────────────────────────────────────
async function getQueue() {
  const row = await db.query(
    `SELECT queue FROM ${h.tables.MAIN_QUEUE} WHERE id = 1`,
    [],
    true
  );
  let raw = row ? JSON.parse(row.queue || '[]') : [];
  let queue = normalizeQueue(raw);
  const cleaned = cleanExpired(queue);
  if (cleaned.length !== queue.length) {
    queue = cleaned;
    await db.query(
      `UPDATE ${h.tables.MAIN_QUEUE} SET queue = ?, updated_at = datetime('now') WHERE id = 1`,
      [JSON.stringify(queue)]
    );
  }
  return queue;
}

// ─── UPDATE DISCORD (non‑blocking) ──────────────────────────
async function updateDiscordQueue(client) {
  try {
    const queue = await getQueue();
    const channel = await client.channels.fetch(QUEUE_CHANNEL_ID);
    if (!channel) throw new Error('Channel not found');

    const token = process.env.DISCORD_TOKEN;
    if (!token) throw new Error('DISCORD_TOKEN missing');

    // Get webhook
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
        const text = item.text;
        const checked = !!item.checked;
        const displayText = checked ? `~~${text}~~` : text;
        const bullet = checked ? `•` : `•`;
        const emoji = checked ? diamondEmoji : blankEmoji;
        return `${bullet} ${emoji} ${displayText}`;
      });
      content += lines.join('\n');
    }

    // Get stored message_id
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
      console.log('✅ Queue Discord message updated');
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
        console.log('✅ Queue Discord message created');
      }
    }
  } catch (err) {
    console.error('❌ updateDiscordQueue error (non‑fatal):', err.message);
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
      let queue = await getQueue();
      queue.push({ text: entry.trim(), checked: false, completedAt: null });
      await db.query(
        `UPDATE ${h.tables.MAIN_QUEUE} SET queue = ?, updated_at = datetime('now') WHERE id = 1`,
        [JSON.stringify(queue)]
      );
      // Update Discord in the background
      updateDiscordQueue(client);
      res.json({ success: true, queue });
    } catch (err) {
      console.error('POST /api/queue/add error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/queue/toggle – DEBUG: logs the index and old state
  app.post('/api/queue/toggle', async (req, res) => {
    const { index } = req.body;
    console.log(`🔁 Toggle request: index=${index}`);
    if (typeof index !== 'number' || index < 0) {
      return res.status(400).json({ error: 'Invalid index' });
    }
    try {
      let queue = await getQueue();
      console.log(`📦 Current queue length: ${queue.length}`);
      if (index >= queue.length) {
        return res.status(400).json({ error: 'Index out of bounds' });
      }

      const item = queue[index];
      console.log(`🔄 Before toggle:`, JSON.stringify(item));
      if (item.checked) {
        item.checked = false;
        item.completedAt = null;
        console.log(`⬅️ Unchecked: ${item.text}`);
      } else {
        item.checked = true;
        item.completedAt = new Date().toISOString();
        console.log(`➡️ Checked: ${item.text}`);
      }

      // Write to DB
      await db.query(
        `UPDATE ${h.tables.MAIN_QUEUE} SET queue = ?, updated_at = datetime('now') WHERE id = 1`,
        [JSON.stringify(queue)]
      );

      // Update Discord (non‑blocking)
      updateDiscordQueue(client);

      res.json({ success: true, queue });
    } catch (err) {
      console.error('❌ POST /api/queue/toggle error:', err);
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
      console.error('POST /api/queue/reorder error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/queue/remove – permanent delete
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
      console.error('POST /api/queue/remove error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ─── DEBUG: GET /api/queue/debug-toggle?index=2 (for testing) ───
  app.get('/api/queue/debug-toggle', async (req, res) => {
    const index = parseInt(req.query.index);
    if (isNaN(index) || index < 0) {
      return res.status(400).json({ error: 'Provide ?index=N' });
    }
    try {
      let queue = await getQueue();
      if (index >= queue.length) {
        return res.status(400).json({ error: 'Index out of bounds' });
      }
      const item = queue[index];
      item.checked = !item.checked;
      item.completedAt = item.checked ? new Date().toISOString() : null;
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
