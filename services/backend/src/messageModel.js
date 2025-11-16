const crypto = require('crypto');

const USER_ID_MAX_LENGTH = process.env.USER_ID_MAX_LENGTH ? Number(process.env.USER_ID_MAX_LENGTH) : 50;
const MESSAGE_MAX_LENGTH = process.env.MESSAGE_MAX_LENGTH ? Number(process.env.MESSAGE_MAX_LENGTH) : 500;

// Factory that normalizes and validates the canonical message shape before it is persisted.
function createMessage({ chatId, userId, message }) {
  const normalizedChatId = sanitize(chatId, 100);
  const normalizedUserId = sanitize(userId, USER_ID_MAX_LENGTH);
  const normalizedMessage = sanitize(message, MESSAGE_MAX_LENGTH);

  if (!normalizedChatId) {
    throw new Error('chatId is required.');
  }

  if (!normalizedUserId) {
    throw new Error('userId is required.');
  }

  if (!normalizedMessage) {
    throw new Error('message text is required.');
  }

  return {
    id: generateId(),
    chatId: normalizedChatId,
    userId: normalizedUserId,
    message: normalizedMessage,
    timestamp: new Date().toISOString()
  };
}

// Ensures every user-provided field is a trimmed string and respects length caps.
function sanitize(value, maxLength) {
  if (value === undefined || value === null) {
    return '';
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return '';
  }
  return maxLength ? normalized.slice(0, maxLength) : normalized;
}

// Generates collision-resistant ids using native crypto when available.
function generateId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = {
  createMessage,
  generateId
};
