// web/routes/sendMessage.js

const { sendMembershipMessage } = require('../../services/membershipSync');
const h = require('../../utils/helpers');
const db = require('../../services/database');

module.exports = function setupSendMessageRoute(app, client) {
  app.post('/api/send-message', async (req, res) => {
    const { discordId } = req.body;
    try {
      const now = new Date().toISOString();
      const membership = await db.query(
        `SELECT * FROM ${h.tables.MEMBERSHIPS}
         WHERE discord_id = ? AND expires_at > ?
         ORDER BY expires_at DESC
         LIMIT 1`,
        [discordId, now],
        true   // single row
      );

      if (!membership) {
        return res.status(404).json({ error: 'No active membership found' });
      }

      const success = await sendMembershipMessage(client, discordId, membership);
      if (success) {
        res.json({ success: true });
      } else {
        res.status(400).json({ error: 'Already messaged for this period' });
      }
    } catch (err) {
      console.error('Send message error:', err);
      res.status(500).json({ error: err.message });
    }
  });
};
