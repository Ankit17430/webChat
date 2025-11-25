import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChatMessageList from './components/ChatMessageList.jsx';
import ChatInput from './components/ChatInput.jsx';
import ChatSidebar from './components/ChatSidebar.jsx';
import UserSettings from './components/UserSettings.jsx';

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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [authToken, setAuthToken] = useState(() => { // For page reloads, retain auth token if present on clint local storage
    if (typeof window === 'undefined') {
      return '';
    }
    return window.localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  });
  const [currentUser, setCurrentUser] = useState(() => { //localy store current user details
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
  const [connectionState, setConnectionState] = useState('disconnected');
  const [messageError, setMessageError] = useState('');
  const [chatError, setChatError] = useState('');
  const [profileError, setProfileError] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [emailDraft, setEmailDraft] = useState(() => currentUser?.email || '');
  const socketRef = useRef(null); // WebSocket instance
  const mountedRef = useRef(true); // To track if component is mounted
  const activeChatRef = useRef(''); // To keep track of currently active chat for incoming messages

  const resetAuthState = useCallback(() => {
    setAuthToken('');
    setCurrentUser(null);
    setMessages([]);
    setChats([]);
    setSelectedChatId('');
    setConnectionState('disconnected');
    setIsSettingsOpen(false);
    socketRef.current?.close();
    socketRef.current = null;
  }, []);

  useEffect(() => { // Clean up code on unmount ???
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => { // Keep track of active chat for incoming messages
    activeChatRef.current = selectedChatId;
  }, [selectedChatId]);

  useEffect(() => { // Stores auth token in local storage
    if (typeof window === 'undefined') {
      return;
    }
    if (authToken) {
      window.localStorage.setItem(STORAGE_TOKEN_KEY, authToken); // Key value pair
    } else {
      window.localStorage.removeItem(STORAGE_TOKEN_KEY);
    }
  }, [authToken]);

  useEffect(() => { // Stores current user in local storage
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
    let ignore = false; // to prevent setting state on unmounted component

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

  const loadChats = useCallback(async () => { // Load list of chats and useCallback to memoize the function so no need to calculate the chat list again
    if (!mountedRef.current || !authToken) {
      return;
    }
    setChatsLoading(true);
    setChatError('');
    try {
      const response = await fetch(`${API_URL}/api/chats`, {
        headers: { Authorization: `Bearer ${authToken}` } // This is to verify the user is authenticated
      });
      if (response.status === 401) { // Check for unauthorized status
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
      setSelectedChatId(prev => { // Retain selected chat if still present after reload
        if (prev && list.some(chat => chat.id === prev)) {
          return prev;
        }
        return list[0]?.id || '';
      });
    } catch (err) {
      if (mountedRef.current) {// only set state if still mounted
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

  useEffect(() => { // To reset chats on logout and load chats on login
    if (!authToken) {
      setChats([]);
      setSelectedChatId('');
      return;
    }
    loadChats();
  }, [authToken, loadChats]);

  useEffect(() => { // Load messages when selected chat changes
    if (!authToken || !selectedChatId) { // If no auth token or no chat selected, clear messages
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
          throw new Error(`Request failed with status ${response.status}`); // Handle non-ok responses
        }
        const payload = await response.json();
        if (!ignore) {
          setMessages(Array.isArray(payload?.messages) ? payload.messages : []); // Set messages if component still mounted
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

  useEffect(() => { // WebSocket connection management
    if (!authToken) {
      setConnectionState('disconnected');
      socketRef.current?.close();
      socketRef.current = null;
      return undefined;
    }

    let reconnectTimer;
    let isUnmounted = false;

    const connect = () => { // Function to establish WebSocket connection
      setConnectionState('connecting');
      const socket = new WebSocket(WS_URL); // Create new WebSocket instance
      socketRef.current = socket;

      socket.addEventListener('open', () => { // On successful connection
        if (!isUnmounted) {
          setConnectionState('connected');
        }
      });

      socket.addEventListener('message', event => { // On receiving a message
        try {
          const data = JSON.parse(event.data);
          if (data?.type === 'chat-message' && data.payload?.chatId) { // Ensure payload has chatId
            const payload = data.payload;
            if (activeChatRef.current === payload.chatId) {
              setMessages(prev => appendMessage(prev, payload)); // Append message if it belongs to active chat
              setChats(prev => touchChat(prev, payload));// Update chat's when the last message was received 
            }
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('Failed to parse WebSocket message', err);
        }
      });

      socket.addEventListener('close', () => { // On connection close
        if (!isUnmounted) {
          setConnectionState('disconnected');
          reconnectTimer = setTimeout(connect, 3000);
        }
      });

      socket.addEventListener('error', () => { // On connection error
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

  useEffect(() => { // Load user profile on authToken change
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
          setCurrentUser(payload?.user || null); // Set current user if component still mounted
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

  const sortedMessages = useMemo( // Sort messages by timestamp
    () => [...messages].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    [messages]
  );

  const activeChat = useMemo(// Get currently active chat details
    () => chats.find(chat => chat.id === selectedChatId) || null,
    [chats, selectedChatId]
  );

  const handleAuthSubmit = async event => { // Handle login/register form submission
    event.preventDefault(); // Prevent default form submission so reload of page doesn't happen
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
      const payload = await response.json().catch(() => ({})); // Safely parse JSON response as.json() is async
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

  const handleAuthInputChange = event => { // Handle changes in auth form inputs
    const { name, value } = event.target; // This updates when the user is no longer focused on the field
    setAuthForm(prev => ({ ...prev, [name]: value }));
  };

  const handleLogout = useCallback(() => { // Handle user logout
    resetAuthState();
    setAuthForm({ username: '', password: '' });
  }, [resetAuthState]);

  const handleCreateChat = useCallback( // Handle creation of new chat
    async ({ title, participants }) => {
      if (!authToken) {
        throw new Error('Login required.');
      }
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
        socketRef.current.send( // Send message via WebSocket send
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

  if (!authToken) {
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
          <p className="subtitle">Chat to Chat Server</p>
        </div>
        <div className="status">
          <span className={CONNECTION_CLASS[connectionState]}>{CONNECTION_LABEL[connectionState]}</span>
          <button
            type="button"
            className={isSettingsOpen ? 'settings-button settings-button--active' : 'settings-button'}
            onClick={() => setIsSettingsOpen(prev => !prev)}
            aria-pressed={isSettingsOpen}
            aria-label="Toggle user settings"
          >
            ⚙️
          </button>
        </div>
      </header>

      <main className={isSettingsOpen ? 'chat-layout chat-layout--settings' : 'chat-layout'}>
        <ChatSidebar
          chats={chats}
          selectedChatId={selectedChatId}
          onSelectChat={setSelectedChatId}
          onCreateChat={handleCreateChat}
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

        {isSettingsOpen ? (
          <aside className="settings-pane settings-pane--open">
            <UserSettings
              username={currentUser.username}
              emailDraft={emailDraft}
              onEmailChange={setEmailDraft}
              onSaveEmail={handleSaveEmail}
              isSaving={isSavingProfile}
              profileMessage={profileMessage}
              profileError={profileError}
              onLogout={handleLogout}
              onClose={() => setIsSettingsOpen(false)}
            />
          </aside>
        ) : null}
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
  if (!message?.chatId) { // check if chatId is present
    return list;
  }
  const index = list.findIndex(chat => chat.id === message.chatId); // find chat by chatId
  if (index === -1) {
    return list;
  }
  const next = [...list];
  next[index] = {
    ...next[index],
    lastMessageAt: message.timestamp //update to when the last message was sent in the chat
  };
  return next;
}
