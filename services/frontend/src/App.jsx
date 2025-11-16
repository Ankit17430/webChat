import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChatMessageList from './components/ChatMessageList.jsx';
import ChatInput from './components/ChatInput.jsx';
import ChatSidebar from './components/ChatSidebar.jsx';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:4001';
const STORAGE_TOKEN_KEY = 'webchat-auth-token';
const STORAGE_USER_KEY = 'webchat-user';

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
  const [authToken, setAuthToken] = useState(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    return window.localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  });
  const [currentUser, setCurrentUser] = useState(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    const raw = window.localStorage.getItem(STORAGE_USER_KEY);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ username: '', password: '' });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [accountLoading, setAccountLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  const [chats, setChats] = useState([]);
  const [selectedChatId, setSelectedChatId] = useState('');
  const [settings, setSettings] = useState(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [chatsLoading, setChatsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const [connectionState, setConnectionState] = useState('disconnected');
  const [messageError, setMessageError] = useState('');
  const [chatError, setChatError] = useState('');
  const [profileError, setProfileError] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [emailDraft, setEmailDraft] = useState(() => currentUser?.email || '');
  const socketRef = useRef(null);
  const mountedRef = useRef(true);
  const activeChatRef = useRef('');

  const resetAuthState = useCallback(() => {
    setAuthToken('');
    setCurrentUser(null);
    setMessages([]);
    setChats([]);
    setSelectedChatId('');
    setConnectionState('disconnected');
    socketRef.current?.close();
    socketRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    activeChatRef.current = selectedChatId;
  }, [selectedChatId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (authToken) {
      window.localStorage.setItem(STORAGE_TOKEN_KEY, authToken);
    } else {
      window.localStorage.removeItem(STORAGE_TOKEN_KEY);
    }
  }, [authToken]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (currentUser) {
      window.localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(currentUser));
    } else {
      window.localStorage.removeItem(STORAGE_USER_KEY);
    }
  }, [currentUser]);

  useEffect(() => {
    setEmailDraft(currentUser?.email || '');
  }, [currentUser]);

  useEffect(() => {
    let ignore = false;

    async function fetchSettings() {
      try {
        const response = await fetch(`${API_URL}/api/settings`);
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        const payload = await response.json();
        if (!ignore) {
          setSettings(payload?.settings || null);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to load settings', err);
      }
    }

    fetchSettings();
    return () => {
      ignore = true;
    };
  }, []);

  const loadChats = useCallback(async () => {
    if (!mountedRef.current || !authToken) {
      return;
    }
    setChatsLoading(true);
    setChatError('');
    try {
      const response = await fetch(`${API_URL}/api/chats`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (response.status === 401) {
        resetAuthState();
        return;
      }
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      const payload = await response.json();
      if (!mountedRef.current) {
        return;
      }
      const list = Array.isArray(payload?.chats) ? payload.chats : [];
      setChats(list);
      setSelectedChatId(prev => {
        if (prev && list.some(chat => chat.id === prev)) {
          return prev;
        }
        return list[0]?.id || '';
      });
    } catch (err) {
      if (mountedRef.current) {
        setChatError('Unable to load chats. Refresh in a moment.');
      }
      // eslint-disable-next-line no-console
      console.error('Failed to load chats', err);
    } finally {
      if (mountedRef.current) {
        setChatsLoading(false);
      }
    }
  }, [authToken, resetAuthState]);

  useEffect(() => {
    if (!authToken) {
      setChats([]);
      setSelectedChatId('');
      return;
    }
    loadChats();
  }, [authToken, loadChats]);

  useEffect(() => {
    if (!authToken || !selectedChatId) {
      setMessages([]);
      setMessagesLoading(false);
      return;
    }

    let ignore = false;
    setMessagesLoading(true);
    setMessageError('');

    async function loadMessages() {
      try {
        const response = await fetch(`${API_URL}/api/chats/${selectedChatId}/messages`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (response.status === 401) {
          resetAuthState();
          return;
        }
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        const payload = await response.json();
        if (!ignore) {
          setMessages(Array.isArray(payload?.messages) ? payload.messages : []);
        }
      } catch (err) {
        if (!ignore) {
          setMessageError('Unable to load messages for this chat.');
        }
        // eslint-disable-next-line no-console
        console.error(err);
      } finally {
        if (!ignore) {
          setMessagesLoading(false);
        }
      }
    }

    loadMessages();

    return () => {
      ignore = true;
    };
  }, [authToken, selectedChatId, resetAuthState]);

  useEffect(() => {
    if (!authToken) {
      setConnectionState('disconnected');
      socketRef.current?.close();
      socketRef.current = null;
      return undefined;
    }

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
          if (data?.type === 'chat-message' && data.payload?.chatId) {
            const payload = data.payload;
            if (activeChatRef.current === payload.chatId) {
              setMessages(prev => appendMessage(prev, payload));
            }
            setChats(prev => touchChat(prev, payload));
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
  }, [authToken]);

  useEffect(() => {
    if (!authToken) {
      setAccountLoading(false);
      return;
    }

    let ignore = false;
    setAccountLoading(true);

    async function loadProfile() {
      try {
        const response = await fetch(`${API_URL}/api/users/me`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (response.status === 401) {
          resetAuthState();
          return;
        }
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        const payload = await response.json();
        if (!ignore) {
          setCurrentUser(payload?.user || null);
        }
      } catch (err) {
        if (!ignore) {
          setAuthError('Failed to load profile. Please try again.');
        }
        // eslint-disable-next-line no-console
        console.error('Profile load failed', err);
      } finally {
        if (!ignore) {
          setAccountLoading(false);
        }
      }
    }

    loadProfile();

    return () => {
      ignore = true;
    };
  }, [authToken, resetAuthState]);

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    [messages]
  );

  const activeChat = useMemo(
    () => chats.find(chat => chat.id === selectedChatId) || null,
    [chats, selectedChatId]
  );

  const isAuthenticated = Boolean(authToken && currentUser);

  const handleAuthSubmit = async event => {
    event.preventDefault();
    setAuthError('');
    const username = authForm.username.trim();
    const password = authForm.password;

    if (!username || !password) {
      setAuthError('Enter both username and password.');
      return;
    }

    setAuthLoading(true);
    try {
      const endpoint = authMode === 'login' ? 'login' : 'register';
      const response = await fetch(`${API_URL}/api/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Authentication failed.');
      }
      setAuthToken(payload.token || '');
      setCurrentUser(payload.user || null);
      setAuthForm({ username: '', password: '' });
      setAuthError('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleAuthInputChange = event => {
    const { name, value } = event.target;
    setAuthForm(prev => ({ ...prev, [name]: value }));
  };

  const handleLogout = useCallback(() => {
    resetAuthState();
    setAuthForm({ username: '', password: '' });
  }, [resetAuthState]);

  const handleCreateChat = useCallback(
    async ({ title, participants }) => {
      if (!authToken) {
        throw new Error('Login required.');
      }
      setIsCreatingChat(true);
      try {
        const response = await fetch(`${API_URL}/api/chats`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({ title, participants })
        });
        const payload = await response.json().catch(() => ({}));
        if (response.status === 401) {
          resetAuthState();
          throw new Error('Authentication required.');
        }
        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to create chat.');
        }
        const createdChat = payload?.chat;
        await loadChats();
        if (createdChat?.id) {
          setSelectedChatId(createdChat.id);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to create chat', err);
        throw err instanceof Error ? err : new Error('Failed to create chat.');
      } finally {
        setIsCreatingChat(false);
      }
    },
    [authToken, loadChats, resetAuthState]
  );

  const handleSend = async value => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if (!selectedChatId) {
      setMessageError('Select or create a chat before sending messages.');
      return;
    }
    if (!authToken || !currentUser) {
      setMessageError('Authentication required.');
      return;
    }

    setIsSending(true);
    setMessageError('');

    const payload = {
      message: trimmed.slice(0, 500)
    };

    try {
      const response = await fetch(`${API_URL}/api/chats/${selectedChatId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify(payload)
      });

      const saved = await response.json().catch(() => null);
      if (response.status === 401) {
        resetAuthState();
        setMessageError('Authentication required.');
        return;
      }
      if (!response.ok || !saved) {
        throw new Error(saved?.error || `Request failed with status ${response.status}`);
      }

      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: 'chat-message',
            payload: saved
          })
        );
      } else {
        setMessages(prev => appendMessage(prev, saved));
        setChats(prev => touchChat(prev, saved));
      }
    } catch (err) {
      setMessageError(err instanceof Error ? err.message : 'Failed to send message.');
      // eslint-disable-next-line no-console
      console.error(err);
    } finally {
      setIsSending(false);
    }
  };

  const handleSaveEmail = async event => {
    event.preventDefault();
    if (!authToken) {
      setProfileError('Authentication required.');
      return;
    }
    setProfileError('');
    setProfileMessage('');
    setIsSavingProfile(true);
    try {
      const response = await fetch(`${API_URL}/api/users/me`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ email: emailDraft })
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        resetAuthState();
        setProfileError('Session expired.');
        return;
      }
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to update email.');
      }
      setCurrentUser(payload?.user || null);
      setProfileMessage('Email updated.');
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Failed to update email.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Web Chat</h1>
          <p className="subtitle">Sign in or create an account to start chatting.</p>
          <form className="auth-form" onSubmit={handleAuthSubmit}>
            <label className="profile-label">
              Username
              <input
                className="profile-input"
                name="username"
                value={authForm.username}
                onChange={handleAuthInputChange}
                autoComplete="username"
              />
            </label>
            <label className="profile-label">
              Password
              <input
                className="profile-input"
                type="password"
                name="password"
                value={authForm.password}
                onChange={handleAuthInputChange}
                autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
              />
            </label>
            {authError ? <div className="error-banner">{authError}</div> : null}
            <button className="compose-button" type="submit" disabled={authLoading}>
              {authLoading ? 'Please wait…' : authMode === 'login' ? 'Login' : 'Register'}
            </button>
          </form>
          <div className="auth-toggle">
            <span>{authMode === 'login' ? "Don't have an account?" : 'Already registered?'}</span>
            <button type="button" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
              {authMode === 'login' ? 'Create one' : 'Back to login'}
            </button>
          </div>
          {accountLoading ? <p className="auth-loading">Loading account…</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>Web Chat</h1>
          <p className="subtitle">Secure multi-user rooms</p>
        </div>
        <div className="status">
          <span className={CONNECTION_CLASS[connectionState]}>{CONNECTION_LABEL[connectionState]}</span>
        </div>
      </header>

      <section className="profile-panel">
        <div className="profile-header">
          <div>
            <h2>User settings</h2>
            <p className="profile-username">Signed in as {currentUser.username}</p>
          </div>
          <button className="logout-button" type="button" onClick={handleLogout}>
            Sign out
          </button>
        </div>
        <form className="profile-form" onSubmit={handleSaveEmail}>
          <label className="profile-label">
            Email (optional)
            <input
              className="profile-input"
              type="email"
              value={emailDraft}
              onChange={event => setEmailDraft(event.target.value)}
              placeholder="name@example.com"
            />
          </label>
          <div className="profile-actions">
            <button className="compose-button" type="submit" disabled={isSavingProfile}>
              {isSavingProfile ? 'Saving…' : 'Save email'}
            </button>
            {profileMessage ? <span className="profile-hint">{profileMessage}</span> : null}
            {profileError ? <span className="profile-hint profile-hint--error">{profileError}</span> : null}
          </div>
        </form>
      </section>

      <main className="chat-layout">
        <ChatSidebar
          chats={chats}
          selectedChatId={selectedChatId}
          onSelectChat={setSelectedChatId}
          onCreateChat={handleCreateChat}
          isCreatingChat={isCreatingChat}
          isLoadingChats={chatsLoading}
          maxParticipants={settings?.maxParticipantsPerChat}
          error={chatError}
        />

        <section className="chat-panel">
          <header className="chat-panel__header">
            {activeChat ? (
              <>
                <h2>{activeChat.title}</h2>
                <p>{activeChat.participants?.join(', ')}</p>
              </>
            ) : (
              <>
                <h2>No chats selected</h2>
                <p>Create a chat on the left to get started.</p>
              </>
            )}
          </header>

          <div className="chat-panel__body">
            {selectedChatId ? (
              messagesLoading ? (
                <div className="empty">Loading messages…</div>
              ) : (
                <ChatMessageList messages={sortedMessages} currentUser={currentUser.username} />
              )
            ) : (
              <div className="empty">Choose or create a chat to begin messaging.</div>
            )}
            {messageError ? <div className="error-banner">{messageError}</div> : null}
          </div>

          <div className="chat-footer">
            <ChatInput disabled={isSending || !selectedChatId} onSend={handleSend} />
          </div>
        </section>
      </main>
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

function touchChat(list, message) {
  if (!message?.chatId) {
    return list;
  }
  const index = list.findIndex(chat => chat.id === message.chatId);
  if (index === -1) {
    return list;
  }
  const next = [...list];
  next[index] = {
    ...next[index],
    lastMessageAt: message.timestamp
  };
  return next;
}
