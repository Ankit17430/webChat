const WebSocket = require('ws');
const { MongoClient } = require('mongodb');

const PORT = process.env.PORT ? Number(process.env.PORT) : 4001;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://mongo:27017';
const MONGO_DB = process.env.MONGO_DB || 'webchat';
const MONGO_MESSAGES_COLLECTION = process.env.MONGO_MESSAGES_COLLECTION || 'messages';
const MONGO_CHATS_COLLECTION = process.env.MONGO_CHATS_COLLECTION || 'chats';


/** @type {Set<WebSocket>} */
const clients = new Set(); // Set to track connected clients and ensure each client is stored only once

let messagesCollection;
let chatsCollection;
let mongoClient;

async function connectToMongo() {
  mongoClient = new MongoClient(MONGO_URL, { ignoreUndefined: true });
  await client.connect();

  const db = client.db(MONGO_DB);
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

  socket.on('message', raw => {
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

    broadcast(JSON.stringify({
      type: 'chat-message',
      payload: parsed.payload
    }));
  });

  socket.on('close', () => {
    clients.delete(socket);
  });

  socket.on('error', () => {
    clients.delete(socket);
  });
};

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
