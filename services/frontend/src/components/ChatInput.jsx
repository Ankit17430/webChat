import { useState } from 'react';

export default function ChatInput({ disabled, onSend }) { //Prop "disabled" to disable the input and "onSend" callback function when a message is sent
  const [value, setValue] = useState('');

  const handleSubmit = async event => {
    event.preventDefault(); //it is to prevent page reload on form submission
    if (!value.trim()) {
      return;
    }
    await onSend(value); //calls handleSend function from parent component with the current message value
    setValue('');
  };

  const handleKeyDown = event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit(event);
    }
  };

  return (
    <form className="compose-form" onSubmit={handleSubmit}>  {/* form to handle message submission */}
      <textarea
        className="compose-textarea"
        placeholder="Type a message…"
        value={value}
        rows={1}
        onChange={event => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <button className="compose-button" type="submit" disabled={disabled}>
        Send
      </button>
    </form>
  );
}
