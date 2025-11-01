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
    const stored = window.localStorage.getItem('webchat-display-name'); // Window is browser defined object and localStorage is its property, it stores as key-value pair in browser
    return stored || generateName();
  });
  const [loading, setLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [connectionState, setConnectionState] = useState('connecting');
  const [error, setError] = useState('');
  const socketRef = useRef(null);

  useEffect(() => {
    let ignore = false;

    async function loadMessages() { //to fetch existing messages from the backend API when the component mounts and only runs once
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

  useEffect(() => { //to store the user's display name in local storage whenever it changes
    if (typeof window === 'undefined') {
      return undefined;
    }

    window.localStorage.setItem('webchat-display-name', displayName);
    return undefined;
  }, [displayName]);

  useEffect(() => { //to establish and manage the WebSocket connection for real-time updates
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
            setMessages(prev => appendMessage(prev, data.payload)); //appendMessage function to add the new message to the existing list of messages
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

  const sortedMessages = useMemo( //to sort messages by timestamp whenever the messages state changes, consistent display order
    () => [...messages].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    [messages]
  );

  const handleSend = async value => {
    const trimmed = value.trim(); // trim whitespace from both ends of the message
    if (!trimmed) {
      return;
    }

    setIsSending(true);
    setError('');

    const payload = { // prepare the payload to be sent to the backend API
      user: (displayName || 'Anonymous').trim().slice(0, 50),
      text: trimmed.slice(0, 500)
    };

    try {
      const response = await fetch(`${API_URL}/api/messages`, { //send the message to the backend API
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const saved = await response.json();

      if (socketRef.current?.readyState === WebSocket.OPEN) { //send the new message to other connected clients via WebSocket
        socketRef.current.send(
          JSON.stringify({
            type: 'chat-message',
            payload: saved
          })
        );
      } else {
        setMessages(prev => appendMessage(prev, saved));// this updates the message state directly by the returned value from appendMessage function
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
          <h1>Web Chat</h1>
          <p className="subtitle">Test of All Chats</p>
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
