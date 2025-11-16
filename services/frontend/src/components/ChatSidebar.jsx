import { useState } from 'react';

export default function ChatSidebar({
  chats,
  selectedChatId,
  onSelectChat,
  onCreateChat,
  isCreatingChat,
  isLoadingChats,
  maxParticipants,
  error
}) {
  const [title, setTitle] = useState('');
  const [participantsInput, setParticipantsInput] = useState('');
  const [localError, setLocalError] = useState('');

  const handleCreate = async event => {
    event.preventDefault();
    const participants = participantsInput
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean);

    if (!participants.length) {
      setLocalError('Add at least one other username.');
      return;
    }

    if (maxParticipants && participants.length > maxParticipants) {
      setLocalError(`Limit of ${maxParticipants} participants per chat.`);
      return;
    }

    try {
      setLocalError('');
      await onCreateChat({ title, participants });
      setTitle('');
      setParticipantsInput('');
    } catch (err) {
      setLocalError(err?.message || 'Unable to create chat.');
    }
  };

  return (
    <div className="chat-sidebar-shell">
      <div className="chat-sidebar__heading">
        <h2>Chats</h2>
        {isLoadingChats ? <span className="chat-sidebar__status">Loading…</span> : null}
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="chat-list">
        {chats.length ? (
          chats.map(chat => (
            <button
              key={chat.id}
              type="button"
              className={chat.id === selectedChatId ? 'chat-list__item chat-list__item--active' : 'chat-list__item'}
              onClick={() => onSelectChat(chat.id)}
            >
              <span className="chat-list__title">{chat.title}</span>
              <span className="chat-list__meta">{formatParticipants(chat.participants)}</span>
            </button>
          ))
        ) : (
          <div className="empty">No chats yet. Create one below.</div>
        )}
      </div>

      <form className="chat-create-form" onSubmit={handleCreate}>
        <h3>Create chat</h3>
        <label className="chat-create-form__label">
          Title
          <input
            className="chat-create-form__input"
            type="text"
            value={title}
            onChange={event => setTitle(event.target.value)}
            maxLength={60}
            placeholder="e.g. Product Standup"
          />
        </label>
        <label className="chat-create-form__label">
          Other participants (comma separated)
          <input
            className="chat-create-form__input"
            type="text"
            value={participantsInput}
            onChange={event => setParticipantsInput(event.target.value)}
            placeholder="Jatin, Ayush, Dev"
          />
        </label>
        {localError ? <div className="form-error">{localError}</div> : null}
        <button className="chat-create-form__button" type="submit" disabled={isCreatingChat}>
          {isCreatingChat ? 'Creating…' : 'Create chat'}
        </button>
        {maxParticipants ? (
          <p className="chat-create-form__hint">
            Up to {maxParticipants} participants per chat. You are added automatically.
          </p>
        ) : null}
      </form>
    </div>
  );
}

function formatParticipants(participants = []) {
  if (!participants.length) {
    return 'Open';
  }
  if (participants.length <= 2) {
    return participants.join(' ↔ ');
  }
  return `${participants[0]} +${participants.length - 1}`;
}
