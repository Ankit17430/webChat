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

  return (
    <form className="compose-form" onSubmit={handleSubmit}>  {/* form to handle message submission */}
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
