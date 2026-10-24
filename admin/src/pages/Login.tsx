import { useEffect, useRef, useState } from 'react';
import { api, message, setToken } from '../api.ts';

declare global {
  interface Window {
    google?: { accounts: { id: {
      initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
      renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
    } } };
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

const signedIn = (token: string) => { setToken(token); location.hash = '#/today'; location.reload(); };

export function Login() {
  const button = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');

  // Google's own sign-in button: Google checks the account, we get a signed ID token and our API verifies it.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    const script = Object.assign(document.createElement('script'), { src: 'https://accounts.google.com/gsi/client', async: true });
    script.onload = () => {
      window.google!.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async ({ credential }) => {
          try { signedIn((await api<{ token: string }>('/auth/google', { idToken: credential })).token); }
          catch (e) { setError(message(e)); }
        },
      });
      window.google!.accounts.id.renderButton(button.current!, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', width: 340 });
    };
    document.head.appendChild(script);
    return () => script.remove();
  }, []);

  return (
    <div className="login">
      <div className="kicker">FindMyHobby · Club admin</div>
      <h1>Sign in</h1>
      <p className="muted" style={{ marginBottom: 16 }}>Staff only. Sign in with the Google account the owner gave a role to.</p>
      <div ref={button} style={{ minHeight: 44 }} />
      {error && <p className="note error">{error}</p>}
      {import.meta.env.DEV && <DevSignIn onError={setError} />}
    </div>
  );
}

// Local development only: the API accepts this just when DEV_LOGIN=1 on a non-production server.
function DevSignIn({ onError }: { onError: (e: string) => void }) {
  const [email, setEmail] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { signedIn((await api<{ token: string }>('/auth/dev', { email })).token); } catch (err) { onError(message(err)); }
  };
  return (
    <form onSubmit={submit} style={{ marginTop: 28, borderTop: '1px solid var(--rule)', paddingTop: 16 }}>
      <label className="field">Email (development sign-in)
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <button className="btn" style={{ marginTop: 10, width: '100%' }}>Sign in (dev)</button>
    </form>
  );
}
