const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const MAX_MESSAGES = process.env.MAX_MESSAGES ? Number(process.env.MAX_MESSAGES) : 100;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const MONGO_URL = process.env.MONGO_URL || 'mongodb://mongo:27017';
const MONGO_DB = process.env.MONGO_DB || 'webchat';
const MONGO_COLLECTION = process.env.MONGO_COLLECTION || 'messages';

async function main() {
  const app = express();
  app.use(cors({ origin: CORS_ORIGIN, credentials: false }));
  app.use(express.json());

  const client = new MongoClient(MONGO_URL, { ignoreUndefined: true });
  await client.connect();

  const db = client.db(MONGO_DB);
  const messagesCollection = db.collection(MONGO_COLLECTION);
  await messagesCollection.createIndex({ timestamp: 1 });

  app.get('/api/health', async (_req, res) => {
    try {
      await db.command({ ping: 1 });
      res.json({ status: 'ok' });
    } catch (error) {
      res.status(503).json({ status: 'degraded', error: error.message });
    }
  });

  app.get('/api/messages', async (_req, res) => {
    try {
      const docs = await messagesCollection
        .find({})
        .sort({ timestamp: -1 })
        .limit(MAX_MESSAGES)
        .toArray();

      const messages = docs.reverse().map(mapMessage);
      res.json({ messages });
    } catch (error) {
      handleError(res, error, 'Failed to fetch messages.');
    }
  });

  app.post('/api/messages', async (req, res) => {
    const { user, text } = req.body || {};

    if (!user || !text) {
      return res.status(400).json({
        error: 'Both "user" and "text" fields are required.'
      });
    }

    const message = {
      id: generateId(),
      user: String(user).slice(0, 50),
      text: String(text).slice(0, 500), // Limit msg length, remove slice to get unlimited size or do catch error for too large messages
      timestamp: new Date().toISOString()
    };

    try {
      await messagesCollection.insertOne({ // Insert with _id for faster lookups and to avoid duplicates in db
        _id: message.id,
        ...message
      });

      await trimMessages(messagesCollection); // Trim old messages if exceeding limit

      res.status(201).json(message); 
    } catch (error) {
      handleError(res, error, 'Failed to store message.');
    }
  });

  app.delete('/api/messages', async (_req, res) => { // Clear all messages
    try {
      await messagesCollection.deleteMany({});
      res.status(204).send();
    } catch (error) {
      handleError(res, error, 'Failed to clear messages.');
    }
  });

  app.use((_req, res) => { // 404 handler and catches requests to unknown endpoints. all calls run in order
    res.status(404).json({ error: 'Not Found' });
  });

  const server = app.listen(PORT, () => { //Start server on specified port
    // eslint-disable-next-line no-console
    console.log(`[REST] Server listening on port ${PORT}`);
  });

  const shutdown = async () => {
    await client.close(); // Close MongoDB connection
    server.close(() => process.exit(0)); // Close server and exit process
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

function mapMessage(doc) { // Map MongoDB document to message object
  return {
    id: doc._id,
    user: doc.user,
    text: doc.text,
    timestamp: doc.timestamp
  };
}

async function trimMessages(collection) {
  const total = await collection.countDocuments();

  if (total <= MAX_MESSAGES) {
    return;
  }

  const excess = total - MAX_MESSAGES;
  const oldest = await collection // contains doc with only _id field
    .find({})
    .sort({ timestamp: 1 })
    .limit(excess)
    .project({ _id: 1 })
    .toArray();

  const ids = oldest.map(doc => doc._id); // converts doc to array of ids
  if (ids.length) { // double check if there are ids to delete
    await collection.deleteMany({ _id: { $in: ids } }); // $in operator checks if _id is in the list of ids to delete
  }
}

function handleError(res, error, message) {
  // eslint-disable-next-line no-console
  console.error(message, error);
  res.status(500).json({ error: message });
}

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; // Generate unique id using timestamp and random string
}

main().catch(error => {
  // eslint-disable-next-line no-console
  console.error('Failed to start backend service', error);
  process.exit(1);
});
