// web/routes/sendMessage.js
const { sendMembershipMessage } = require('../../utils/messaging');

module.exports = function setupSendMessageRoute(app, client, supabase, supabaseRetry) {
  app.post('/api/send-message', async (req, res) => {
    const { discordId } = req.body;
    try {
      const now = new Date().toISOString();
      const { data: membership, error } = await supabaseRetry(() =>
        supabase
          .from('memberships')
          .select('*')
          .eq('discord_id', discordId)
          .gt('expires_at', now)
          .order('expires_at', { ascending: false })
          .limit(1)
          .single()
      );
      if (error || !membership) {
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
