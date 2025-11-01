const WebSocket = require('ws');

const PORT = process.env.PORT ? Number(process.env.PORT) : 4001;

const server = new WebSocket.Server({
  port: PORT,
  host: '0.0.0.0'
});

/** @type {Set<WebSocket>} */
const clients = new Set(); // Set to track connected clients and ensure each client is stored only once

server.on('connection', socket => {
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
});

server.on('listening', () => {
  // eslint-disable-next-line no-console
  console.log(`[WebSocket] Server listening on port ${PORT}`);
});

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
