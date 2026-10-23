import { useState } from 'react';
import { api, message, setToken } from '../api.ts';

// Google sign-in will be added once the Google client ID exists. Until then, local development uses email sign-in,
// which the API only allows when DEV_LOGIN=1 on a non-production server.
export function Login() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { token } = await api<{ token: string }>('/auth/dev', { email });
      setToken(token);
      location.hash = '#/today';
      location.reload();
    } catch (err) { setError(message(err)); }
  };

  return (
    <form className="login" onSubmit={submit}>
      <div className="kicker">FindMyHobby · Club admin</div>
      <h1>Sign in</h1>
      <label className="field">Email (development sign-in)
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      </label>
      {error && <p className="note error">{error}</p>}
      <button className="btn primary" style={{ marginTop: 12, width: '100%' }}>Sign in</button>
    </form>
  );
}
