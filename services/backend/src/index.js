const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const { createMessage, generateId } = require('./messageModel');

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const DEFAULT_MAX_MESSAGES = process.env.MAX_MESSAGES ? Number(process.env.MAX_MESSAGES) : 100;
const MAX_PARTICIPANTS = process.env.MAX_PARTICIPANTS ? Number(process.env.MAX_PARTICIPANTS) : 25;
const SESSION_TTL_MS = process.env.SESSION_TTL_MS ? Number(process.env.SESSION_TTL_MS) : 1000 * 60 * 60 * 24;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const MONGO_URL = process.env.MONGO_URL || 'mongodb://mongo:27017';
const MONGO_DB = process.env.MONGO_DB || 'webchat';
const MONGO_MESSAGES_COLLECTION = process.env.MONGO_MESSAGES_COLLECTION || 'messages';
const MONGO_CHATS_COLLECTION = process.env.MONGO_CHATS_COLLECTION || 'chats';
const MONGO_SETTINGS_COLLECTION = process.env.MONGO_SETTINGS_COLLECTION || 'settings';
const MONGO_USERS_COLLECTION = process.env.MONGO_USERS_COLLECTION || 'users';
const sessionStore = new Map();

const DEFAULT_SETTINGS = {
  _id: 'global',
  maxMessagesPerChat: DEFAULT_MAX_MESSAGES,
  maxParticipantsPerChat: MAX_PARTICIPANTS,
  deterministicDirectChatIds: true
};

// Bootstraps the REST API, wires Mongo collections, and registers every route.
async function main() {
  const app = express();
  app.use(cors({ origin: CORS_ORIGIN, credentials: false }));
  app.use(express.json());

  const client = new MongoClient(MONGO_URL, { ignoreUndefined: true });
  await client.connect();

  const db = client.db(MONGO_DB);
  const messagesCollection = db.collection(MONGO_MESSAGES_COLLECTION);
  const chatsCollection = db.collection(MONGO_CHATS_COLLECTION);
  const settingsCollection = db.collection(MONGO_SETTINGS_COLLECTION);
  const usersCollection = db.collection(MONGO_USERS_COLLECTION);

  await messagesCollection.createIndex({ chatId: 1, timestamp: 1 });
  await chatsCollection.createIndex({ participants: 1 });
  await usersCollection.createIndex({ usernameLower: 1 }, { unique: true });

  let cachedSettings = await ensureSettings(settingsCollection);

  // Disable caching so sensitive responses are not stored by proxies/browsers.
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Lightweight health endpoint that pings MongoDB.
  app.get('/api/health', async (_req, res) => {
    try {
      await db.command({ ping: 1 });
      res.json({ status: 'ok' });
    } catch (error) {
      res.status(503).json({ status: 'degraded', error: error.message });
    }
  });

  // Exposes the cached global settings document.
  app.get('/api/settings', (_req, res) => {
    res.json({ settings: cachedSettings });
  });

  // Registers a new user and returns an auth token.
  app.post('/api/auth/register', async (req, res) => {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || '');

    if (!username) {
      return res.status(400).json({ error: 'Username is required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const now = new Date().toISOString();
    const candidate = {
      _id: generateId(),
      username,
      usernameLower: username.toLowerCase(),
      passwordHash: hashPassword(password),
      email: '',
      createdAt: now,
      updatedAt: now
    };

    try {
      await usersCollection.insertOne(candidate);
      const token = createSession(candidate._id);
      res.status(201).json({ token, user: formatUser(candidate) });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return res.status(409).json({ error: 'Username already exists.' });
      }
      handleError(res, error, 'Failed to register user.');
    }
  });

  // Authenticates existing users and issues a new session token.
  app.post('/api/auth/login', async (req, res) => {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || '');

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    try {
      const user = await usersCollection.findOne({ usernameLower: username.toLowerCase() });
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }
      const token = createSession(user._id);
      res.json({ token, user: formatUser(user) });
    } catch (error) {
      handleError(res, error, 'Failed to login.');
    }
  });

  // Returns the authenticated user's profile.
  app.get('/api/users/me', async (req, res) => {
    const user = await requireAuth(req, res, usersCollection);
    if (!user) {
      return;
    }
    res.json({ user: formatUser(user) });
  });

  // Allows an authenticated user to update optional profile fields (currently email).
  app.put('/api/users/me', async (req, res) => {
    const user = await requireAuth(req, res, usersCollection);
    if (!user) {
      return;
    }

    const updates = {
      updatedAt: new Date().toISOString()
    };

    if (req.body?.email !== undefined) {
      updates.email = sanitizeEmail(req.body.email);
    }

    try {
      await usersCollection.updateOne({ _id: user._id }, { $set: updates });
      const next = { ...user, ...updates };
      res.json({ user: formatUser(next) });
    } catch (error) {
      handleError(res, error, 'Failed to update profile.');
    }
  });

  // Updates centralized settings; expects admin usage.
  app.put('/api/settings', async (req, res) => {
    const updates = {};
    const { maxMessagesPerChat, maxParticipantsPerChat, deterministicDirectChatIds } = req.body || {};

    if (maxMessagesPerChat !== undefined) {
      if (!Number.isInteger(maxMessagesPerChat) || maxMessagesPerChat <= 0) {
        return res.status(400).json({ error: '"maxMessagesPerChat" must be a positive integer.' });
      }
      updates.maxMessagesPerChat = maxMessagesPerChat;
    }

    if (maxParticipantsPerChat !== undefined) {
      if (!Number.isInteger(maxParticipantsPerChat) || maxParticipantsPerChat < 2) {
        return res.status(400).json({ error: '"maxParticipantsPerChat" must be an integer >= 2.' });
      }
      updates.maxParticipantsPerChat = maxParticipantsPerChat;
    }

    if (deterministicDirectChatIds !== undefined) {
      updates.deterministicDirectChatIds = Boolean(deterministicDirectChatIds);
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'Provide at least one setting to update.' });
    }

    updates.updatedAt = new Date().toISOString();

    try {
      await settingsCollection.updateOne({ _id: 'global' }, { $set: updates }, { upsert: true });
      cachedSettings = await ensureSettings(settingsCollection);
      res.json({ settings: cachedSettings });
    } catch (error) {
      handleError(res, error, 'Failed to update settings.');
    }
  });

  // Lists chats for the authenticated user.
  app.get('/api/chats', async (req, res) => {
    const user = await requireAuth(req, res, usersCollection);
    if (!user) {
      return;
    }
    const filter = { participants: user.username };

    try {
      const chats = await chatsCollection
        .find(filter)
        .sort({ lastMessageAt: -1, createdAt: -1 })
        .toArray();

      res.json({ chats: chats.map(mapChat) });
    } catch (error) {
      handleError(res, error, 'Failed to fetch chats.');
    }
  });

  // Creates a new chat, always including the requesting user.
  app.post('/api/chats', async (req, res) => {
    const user = await requireAuth(req, res, usersCollection);
    if (!user) {
      return;
    }

    const limit = cachedSettings.maxParticipantsPerChat || MAX_PARTICIPANTS;
    const participants = sanitizeParticipants(req.body?.participants, limit, user.username);
    if (participants.length < 2) {
      return res.status(400).json({ error: 'Add at least one other participant.' });
    }

    const type = participants.length === 2 ? 'direct' : 'group';
    const shouldDeriveId = type === 'direct' && cachedSettings.deterministicDirectChatIds;
    const chatId = shouldDeriveId ? deriveChatId(participants) : generateId();
    const titleFromParticipants = participants.join(type === 'direct' ? ' ↔ ' : ', ');
    const title = String(req.body?.title || '').trim() || titleFromParticipants;

    try {
      if (shouldDeriveId) {
        const existing = await chatsCollection.findOne({ _id: chatId });
        if (existing) {
          return res.status(200).json({ chat: mapChat(existing) });
        }
      }

      const now = new Date().toISOString();
      const chatDoc = {
        _id: chatId,
        title,
        participants,
        type,
        createdAt: now,
        lastMessageAt: null
      };

      await chatsCollection.insertOne(chatDoc);
      res.status(201).json({ chat: mapChat(chatDoc) });
    } catch (error) {
      handleError(res, error, 'Failed to create chat.');
    }
  });

  // Fetches messages for a chat the user is a participant in.
  app.get('/api/chats/:chatId/messages', async (req, res) => {
    const { chatId } = req.params;
    try {
      const chat = await chatsCollection.findOne({ _id: chatId });
      if (!chat) {
        return res.status(404).json({ error: 'Chat not found.' });
      }

      const messages = await fetchMessagesForChat(messagesCollection, chatId, cachedSettings.maxMessagesPerChat);
      res.json({ chat: mapChat(chat), messages });
    } catch (error) {
      handleError(res, error, 'Failed to fetch chat messages.');
    }
  });

  // Stores a new message authored by the current user.
  app.post('/api/chats/:chatId/messages', async (req, res) => {
    const { chatId } = req.params;
    const user = await requireAuth(req, res, usersCollection);
    if (!user) {
      return;
    }

    try {
      const chat = await chatsCollection.findOne({ _id: chatId, participants: user.username });
      if (!chat) {
        return res.status(404).json({ error: 'Chat not found.' });
      }

      let message;
      try {
        message = createMessage({
          chatId,
          userId: user.username,
          message: req.body?.message
        });
      } catch (validationError) {
        return res.status(400).json({ error: validationError.message });
      }

      await messagesCollection.insertOne({
        _id: message.id,
        ...message
      });

      await chatsCollection.updateOne(
        { _id: chatId },
        { $set: { lastMessageAt: message.timestamp } }
      );

      await trimMessages(messagesCollection, chatId, cachedSettings.maxMessagesPerChat);

      res.status(201).json(message);
    } catch (error) {
      handleError(res, error, 'Failed to store message.');
    }
  });

  // Final fallback handler for unknown routes.
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  const server = app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[REST] Server listening on port ${PORT}`);
  });

  const shutdown = async () => {
    await client.close();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

// Normalizes a Mongo document into the API-friendly message shape.
function mapMessage(doc) {
  const chatId = doc.chatId || '';
  const messageText = doc.message || doc.text || '';
  const userId = doc.userId || doc.user || '';

  return {
    id: doc._id,
    chatId,
    userId,
    message: messageText,
    timestamp: doc.timestamp
  };
}

// Normalizes a chat document so clients always receive consistent metadata.
function mapChat(doc) {
  return {
    id: doc._id,
    title: doc.title,
    participants: doc.participants || [],
    type: doc.type || (doc.participants?.length === 2 ? 'direct' : 'group'),
    createdAt: doc.createdAt,
    lastMessageAt: doc.lastMessageAt
  };
}

// Fetches a bounded, chronologically sorted set of messages for a chat.
async function fetchMessagesForChat(collection, chatId, limit) {
  const docs = await collection
    .find({ chatId })
    .sort({ timestamp: -1 })
    .limit(limit || DEFAULT_MAX_MESSAGES)
    .toArray();

  return docs.reverse().map(mapMessage);
}

// Guarantees that the singleton settings document exists and returns it.
async function ensureSettings(collection) {
  const existing = await collection.findOne({ _id: 'global' });
  if (existing) {
    return normalizeSettings(existing);
  }
  const baseline = {
    ...DEFAULT_SETTINGS,
    updatedAt: new Date().toISOString()
  };
  await collection.insertOne(baseline);
  return baseline;
}

// Applies defaults and timestamps to raw settings documents.
function normalizeSettings(doc) {
  return {
    ...DEFAULT_SETTINGS,
    ...doc,
    updatedAt: doc?.updatedAt || new Date().toISOString()
  };
}

// Deduplicates and truncates participant identifiers while respecting limits.
function sanitizeParticipants(list, limit, requiredParticipant) {
  const unique = [];
  const push = value => {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return;
    }
    if (!unique.includes(normalized)) {
      unique.push(normalized);
    }
  };

  if (requiredParticipant) {
    push(requiredParticipant);
  }

  if (Array.isArray(list)) {
    for (const entry of list) {
      push(entry);
      if (unique.length >= limit) {
        break;
      }
    }
  }

  return unique.slice(0, limit);
}

// Keeps per-chat history within the configured retention window.
async function trimMessages(collection, chatId, limit) {
  const total = await collection.countDocuments({ chatId });
  const max = limit || DEFAULT_MAX_MESSAGES;

  if (total <= max) {
    return;
  }

  const excess = total - max;
  const oldest = await collection
    .find({ chatId })
    .sort({ timestamp: 1 })
    .limit(excess)
    .project({ _id: 1 })
    .toArray();

  const ids = oldest.map(doc => doc._id);
  if (ids.length) {
    await collection.deleteMany({ _id: { $in: ids } });
  }
}

// Deterministically hashes two-person chat participant lists to an id.
function deriveChatId(participants) {
  return crypto.createHash('sha256').update(participants.sort().join('|')).digest('hex').slice(0, 24);
}

// Centralized error helper to log internal details and return a friendly message.
function handleError(res, error, message) {
  // eslint-disable-next-line no-console
  console.error(message, error);
  res.status(500).json({ error: message });
}

// Normalizes username input by trimming whitespace.
function normalizeUsername(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

// Sanitizes email input and allows empty strings for "unset".
function sanitizeEmail(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

// Hashes passwords with a per-user salt via PBKDF2.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

// Verifies passwords by recomputing the PBKDF2 hash.
function verifyPassword(password, stored) {
  if (!stored) {
    return false;
  }
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) {
    return false;
  }
  const candidate = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
  } catch {
    return false;
  }
}

// Issues a short-lived session token stored in-memory.
function createSession(userId) {
  const token = generateId();
  sessionStore.set(token, {
    userId,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  return token;
}

// Extracts a bearer token from the request headers.
function extractToken(req) {
  const header = req.headers?.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() === 'bearer' && token) {
    return token;
  }
  return null;
}

// Loads the authenticated user or responds with 401.
async function requireAuth(req, res, usersCollection) {
  const auth = await authenticateRequest(req, usersCollection);
  if (!auth) {
    res.status(401).json({ error: 'Authentication required.' });
    return null;
  }
  return auth;
}

// Resolves the user tied to a bearer token, refreshing session TTL.
async function authenticateRequest(req, usersCollection) {
  const token = extractToken(req);
  if (!token) {
    return null;
  }

  const session = sessionStore.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessionStore.delete(token);
    return null;
  }

  const user = await usersCollection.findOne(
    { _id: session.userId },
    { projection: { passwordHash: 0, usernameLower: 0 } }
  );

  if (!user) {
    sessionStore.delete(token);
    return null;
  }

  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return user;
}

// Removes sensitive fields and standardizes the payload returned to clients.
function formatUser(doc) {
  return {
    id: doc._id,
    username: doc.username,
    email: doc.email || '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

// Detects duplicate key errors thrown by Mongo driver.
function isDuplicateKeyError(error) {
  return error && (error.code === 11000 || error.code === 11001);
}

main().catch(error => {
  // eslint-disable-next-line no-console
  console.error('Failed to start backend service', error);
  process.exit(1);
});
