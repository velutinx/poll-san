// web/routes/queue.js
module.exports = function setupQueueRoutes(app, client, queueService) {
  app.get('/api/get-queue', async (req, res) => {
    try {
      const data = await queueService.getQueueData();
      if (data && typeof data.queue === 'string') data.queue = JSON.parse(data.queue);
      res.json(data || { queue: [] });
    } catch (err) {
      console.error('Get queue error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/queue-add', async (req, res) => {
    try {
      const { character } = req.body;
      const data = await queueService.getQueueData();
      let currentQueue = typeof data.queue === 'string' ? JSON.parse(data.queue) : data.queue;
      currentQueue.push(character);
      await queueService.updateQueueMessage(client, currentQueue, data.message_id);
      res.json({ success: true });
    } catch (err) {
      console.error('Queue add error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/queue-reorder', async (req, res) => {
    try {
      const { newQueue } = req.body;
      const { message_id } = await queueService.getQueueData();
      await queueService.updateQueueMessage(client, newQueue, message_id);
      res.json({ success: true });
    } catch (err) {
      console.error('Queue reorder error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/queue-remove-name', async (req, res) => {
    try {
      const { character } = req.body;
      const data = await queueService.getQueueData();
      let currentQueue = typeof data.queue === 'string' ? JSON.parse(data.queue) : data.queue;
      const filteredQueue = currentQueue.filter(name => name !== character);
      await queueService.updateQueueMessage(client, filteredQueue, data.message_id);
      res.json({ success: true });
    } catch (err) {
      console.error('Queue remove error:', err);
      res.status(500).json({ error: err.message });
    }
  });
};
