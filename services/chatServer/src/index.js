const WebSocket = require('ws');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const PORT = process.env.PORT ? Number(process.env.PORT) : 4001;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://mongo:27017';
const MONGO_DB = process.env.MONGO_DB || 'webchat';
const MONGO_MESSAGES_COLLECTION = process.env.MONGO_MESSAGES_COLLECTION || 'messages';
const MONGO_CHATS_COLLECTION = process.env.MONGO_CHATS_COLLECTION || 'chats';
const MAX_MESSAGES = process.env.MAX_MESSAGES ? Number(process.env.MAX_MESSAGES) : 1000;

/** @type {Set<WebSocket>} */
const clients = new Set(); // Set to track connected clients and ensure each client is stored only once

let messagesCollection;
let chatsCollection;
let mongoClient;

async function connectToMongo() {
  mongoClient = new MongoClient(MONGO_URL, { ignoreUndefined: true });
  await mongoClient.connect();

  const db = mongoClient.db(MONGO_DB);
  messagesCollection = db.collection(MONGO_MESSAGES_COLLECTION);
  chatsCollection = db.collection(MONGO_CHATS_COLLECTION);

  await messagesCollection.createIndex({ chatId: 1, timestamp: 1 });

  const server = new WebSocket.Server({port: PORT, host: '0.0.0.0'});
  server.on('connection', handleConnection);
  server.on('listening', () => console.log(`listening on ${PORT}`));

  const shutdown = async () => { await mongoClient.close(); server.close(); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

connectToMongo().catch(error => {
  // eslint-disable-next-line no-console
  console.error('Failed to connect to MongoDB:', error);
  process.exit(1);
});

function handleConnection(socket) {
  clients.add(socket);
  safeSend(socket, {
    type: 'system-message',
    payload: { message: 'Connected to the chat gateway.' }
  });

  socket.on('message', async raw => {
    let parsed;
    try {
      parsed = JSON.parse(raw.toString());
    } catch (error) {
      return safeSend(socket, {
        type: 'error',
        payload: { message: 'Messages must be valid JSON.' } // Notify client of JSON parsing error and probably need to change this
      });
    }

    if (parsed?.type !== 'chat-message' || typeof parsed.payload !== 'object') {
      return safeSend(socket, {
        type: 'error',
        payload: { message: 'Unsupported message format.' }
      });
    }

    try {
      const stored = await persistMessage(parsed.payload);
      broadcast(JSON.stringify({ type: 'chat-message', payload: stored }));
    } catch (error) {
      safeSend(socket, { type: 'error', payload: { message: error.message || 'Failed to store message.' } });
    }
  });

  socket.on('close', () => {
    clients.delete(socket);
  });

  socket.on('error', () => {
    clients.delete(socket);
  });
};

async function persistMessage(payload) {
  // --
  const { chatId, userId, message } = payload || {};
  if (!chatId || !userId || !message) {
    throw new Error('chatId, userId, and message are required.');
  }

  await ensureMembership(String(chatId), String(userId));

  const doc = {
    id: crypto.randomUUID(),
    chatId: String(chatId),
    userId: String(userId),
    message: String(message).slice(0, 500),
    timestamp: new Date().toISOString()
  };

  await messagesCollection.insertOne({ _id: doc.id, ...doc });
  await trimMessages(doc.chatId);
  return doc;
  // --
}

async function trimMessages(chatId) {
  // --
  const total = await messagesCollection.countDocuments({ chatId });
  if (total <= MAX_MESSAGES) return;

  const excess = total - MAX_MESSAGES;
  const oldest = await messagesCollection
    .find({ chatId })
    .sort({ timestamp: 1 })
    .limit(excess)
    .project({ _id: 1 })
    .toArray();

  const ids = oldest.map(d => d._id);
  if (ids.length) {
    await messagesCollection.deleteMany({ _id: { $in: ids } });
  }
}

async function ensureMembership(chatId, userId) {
  // --
  const chat = await chatsCollection.findOne({ _id: chatId, participants: userId });
  if (!chat) {
    throw new Error('Chat not found or access denied.');
  }
  // --
}

function broadcast(message) {
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function safeSend(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}
