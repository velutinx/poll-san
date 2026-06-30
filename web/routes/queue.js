// web/routes/queue.js
const h = require('../../utils/helpers');
const db = require('../../services/database');
const QUEUE_CHANNEL_ID = h.ids.channels.QUEUE;
const LOGO_URL = h.urls.LOGO_URL;
const DISCORD_API = 'https://discord.com/api/v10';


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

    const progressEmoji = h.releaseEmojis.PROGRESS || '<a:progress:1491670111923212308>';
    const diamondEmoji = h.releaseEmojis.DIAMOND || ':gem:';
    const blankEmoji = h.releaseEmojis.BLANK || '';

    let content = `${progressEmoji} **Current queue** (general idea, subject to change):\n\n`;
    if (queue.length === 0) {
      content += '*Queue is empty.*';
    } else {
      const lines = queue.map(item => {
        let text = item.text;
        let gender = '';
        let name = text;
        const genderMatch = text.match(/^[♂♀]️?\s*/);
        if (genderMatch) {
          gender = genderMatch[0].trim();
          name = text.substring(genderMatch[0].length).trim();
        }

        let displayName = name;
        let prefix = '•';
        let emoji = blankEmoji;

        if (item.checked) {
          emoji = diamondEmoji;
          displayName = `**${name}**`;
        }
        if (item.slashed) {
          displayName = `~~${displayName}~~`;
        }

        const namePart = gender ? `${gender} ${displayName}` : displayName;
        return `${prefix} ${emoji} ${namePart}`;
      });
      content += lines.join('\n');
    }

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
  app.get('/api/queue', async (req, res) => {
    try {
      const queue = await getQueue();
      res.json({ queue });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

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
      queue[index].checked = !queue[index].checked;
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

  // ─── REORDER: accepts visibleOrder, merges with slashed items ───
  app.post('/api/queue/reorder', async (req, res) => {
    const { visibleOrder } = req.body;
    if (!Array.isArray(visibleOrder)) {
      return res.status(400).json({ error: 'visibleOrder must be an array' });
    }
    try {
      let queue = await getQueue();
      // Build new queue: iterate over original queue, replace non‑slashed items with next visibleOrder item
      let visibleIndex = 0;
      const newQueue = queue.map(item => {
        if (item.slashed) {
          return item; // keep slashed as is
        } else {
          const newItem = visibleOrder[visibleIndex];
          visibleIndex++;
          // If we run out of visibleOrder items, fallback to original item (shouldn't happen)
          return newItem || item;
        }
      });
      if (visibleIndex < visibleOrder.length) {
        for (let i = visibleIndex; i < visibleOrder.length; i++) {
          newQueue.push(visibleOrder[i]);
        }
      }
      await db.query(
        `UPDATE ${h.tables.MAIN_QUEUE} SET queue = ?, updated_at = datetime('now') WHERE id = 1`,
        [JSON.stringify(newQueue)]
      );
      updateDiscordQueue(client);
      res.json({ success: true, queue: newQueue });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/queue/edit', async (req, res) => {
    const { index, newText } = req.body;
    if (typeof index !== 'number' || index < 0) {
      return res.status(400).json({ error: 'Invalid index' });
    }
    if (!newText || typeof newText !== 'string' || !newText.trim()) {
      return res.status(400).json({ error: 'Missing or invalid newText' });
    }
    try {
      let queue = await getQueue();
      if (index >= queue.length) {
        return res.status(400).json({ error: 'Index out of bounds' });
      }
      queue[index].text = newText.trim();
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
module.exports.getQueue = getQueue;
