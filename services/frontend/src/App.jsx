import { useEffect, useMemo, useRef, useState } from 'react';
import ChatMessageList from './components/ChatMessageList.jsx';
import ChatInput from './components/ChatInput.jsx';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:4001';

const CONNECTION_LABEL = {
  connecting: 'Connecting…',
  connected: 'Live',
  disconnected: 'Offline'
};

const CONNECTION_CLASS = {
  connecting: 'badge badge--connecting',
  connected: 'badge badge--connected',
  disconnected: 'badge badge--offline'
};

export default function App() {
  const [messages, setMessages] = useState([]);
  const [displayName, setDisplayName] = useState(() => {
    if (typeof window === 'undefined') {
      return generateName();
    }
    const stored = window.localStorage.getItem('webchat-display-name');
    return stored || generateName();
  });
  const [loading, setLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [connectionState, setConnectionState] = useState('connecting');
  const [error, setError] = useState('');
  const socketRef = useRef(null);

  useEffect(() => {
    let ignore = false;

    async function loadMessages() {
      setLoading(true);
      setError('');

      try {
        const response = await fetch(`${API_URL}/api/messages`);
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const payload = await response.json();
        if (!ignore) {
          setMessages(Array.isArray(payload?.messages) ? payload.messages : []);
        }
      } catch (err) {
        if (!ignore) {
          setError('Unable to load existing messages. Try again in a moment.');
        }
        // eslint-disable-next-line no-console
        console.error(err);
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadMessages();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    window.localStorage.setItem('webchat-display-name', displayName);
    return undefined;
  }, [displayName]);

  useEffect(() => {
    let reconnectTimer;
    let isUnmounted = false;

    const connect = () => {
      setConnectionState('connecting');
      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        if (!isUnmounted) {
          setConnectionState('connected');
        }
      });

      socket.addEventListener('message', event => {
        try {
          const data = JSON.parse(event.data);
          if (data?.type === 'chat-message' && data.payload) {
            setMessages(prev => appendMessage(prev, data.payload));
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('Failed to parse WebSocket message', err);
        }
      });

      socket.addEventListener('close', () => {
        if (!isUnmounted) {
          setConnectionState('disconnected');
          reconnectTimer = setTimeout(connect, 3000);
        }
      });

      socket.addEventListener('error', () => {
        socket.close();
      });
    };

    connect();

    return () => {
      isUnmounted = true;
      clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, []);

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    [messages]
  );

  const handleSend = async value => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    setIsSending(true);
    setError('');

    const payload = {
      user: (displayName || 'Anonymous').trim().slice(0, 50),
      text: trimmed.slice(0, 500)
    };

    try {
      const response = await fetch(`${API_URL}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const saved = await response.json();

      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: 'chat-message',
            payload: saved
          })
        );
      } else {
        setMessages(prev => appendMessage(prev, saved));
      }
    } catch (err) {
      setError('Failed to send message. Check your connection and try again.');
      // eslint-disable-next-line no-console
      console.error(err);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>webChat</h1>
          <p className="subtitle">React + REST + WebSocket demo</p>
        </div>
        <div className="status">
          <span className={CONNECTION_CLASS[connectionState]}>{CONNECTION_LABEL[connectionState]}</span>
        </div>
      </header>

      <section className="profile-panel">
        <label className="profile-label" htmlFor="display-name">
          Display name
        </label>
        <input
          id="display-name"
          className="profile-input"
          value={displayName}
          onChange={event => setDisplayName(event.target.value)}
          maxLength={50}
        />
      </section>

      <main className="chat-panel">
        {loading ? (
          <div className="empty">Loading messages…</div>
        ) : (
          <ChatMessageList messages={sortedMessages} currentUser={displayName} />
        )}
        {error ? <div className="error-banner">{error}</div> : null}
      </main>

      <footer className="chat-footer">
        <ChatInput disabled={isSending} onSend={handleSend} />
      </footer>
    </div>
  );
}

function appendMessage(existing, message) {
  if (!message?.id) {
    return existing;
  }
  const alreadyPresent = existing.some(entry => entry.id === message.id);
  return alreadyPresent ? existing : [...existing, message];
}

function generateName() {
  return `Guest-${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0')}`;
}
