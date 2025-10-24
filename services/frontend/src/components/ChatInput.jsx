import { useState } from 'react';

export default function ChatInput({ disabled, onSend }) {
  const [value, setValue] = useState('');

  const handleSubmit = async event => {
    event.preventDefault();
    if (!value.trim()) {
      return;
    }
    await onSend(value);
    setValue('');
  };

  return (
    <form className="compose-form" onSubmit={handleSubmit}>
      <textarea
        className="compose-textarea"
        placeholder="Type a message…"
        value={value}
        rows={2}
        onChange={event => setValue(event.target.value)}
        disabled={disabled}
      />
      <button className="compose-button" type="submit" disabled={disabled}>
        Send
      </button>
    </form>
  );
}
