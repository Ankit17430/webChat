import { useEffect, useRef } from 'react';

export default function ChatMessageList({ messages, currentUser }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  if (!messages.length) {
    return <div className="empty">No messages yet. Kick things off!</div>;
  }

  return (
    <div className="message-list" ref={containerRef}>
      {messages.map(message => {
        const isOwn = message.userId === currentUser;
        return (
          <article key={message.id} className={isOwn ? 'message message--own' : 'message'}>
            <header className="message-meta">
              <span className="message-author">{message.userId}</span>
              <time className="message-time" dateTime={message.timestamp}>
                {formatTime(message.timestamp)}
              </time>
            </header>
            <p className="message-text">{message.message}</p>
          </article>
        );
      })}
    </div>
  );
}

function formatTime(isoString) {
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
