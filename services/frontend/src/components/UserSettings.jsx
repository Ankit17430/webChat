export default function UserSettings({
  username,
  emailDraft,
  onEmailChange,
  onSaveEmail,
  isSaving,
  profileMessage,
  profileError,
  onLogout,
  onClose
}) {
  return (
    <section className="profile-panel">
      <div className="profile-header">
        <div>
          <h2>User settings</h2>
          <p className="profile-username">Signed in as {username}</p>
        </div>
        <div className="profile-header__actions">
          <button className="logout-button" type="button" onClick={onLogout}>
            Sign out
          </button>
          <button type="button" className="settings-close" aria-label="Close settings" onClick={onClose}>
            ×
          </button>
        </div>
      </div>
      <form className="profile-form" onSubmit={onSaveEmail}>
        <label className="profile-label">
          Email (optional)
          <input
            className="profile-input"
            type="email"
            value={emailDraft}
            onChange={event => onEmailChange(event.target.value)}
            placeholder="name@example.com"
          />
        </label>
        <div className="profile-actions">
          <button className="compose-button" type="submit" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save email'}
          </button>
          {profileMessage ? <span className="profile-hint">{profileMessage}</span> : null}
          {profileError ? <span className="profile-hint profile-hint--error">{profileError}</span> : null}
        </div>
      </form>
    </section>
  );
}
