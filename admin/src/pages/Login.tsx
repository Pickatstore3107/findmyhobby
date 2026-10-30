import { useEffect, useRef, useState } from 'react';
import { api, message, setToken } from '../api.ts';
import { Icon } from '../icons.tsx';

declare global {
  interface Window {
    google?: { accounts: { id: {
      initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
      renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
    } } };
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

const signedIn = (token: string) => { setToken(token); sessionStorage.removeItem('fmh.signedOut'); location.hash = '#/today'; location.reload(); };

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
      window.google!.accounts.id.renderButton(button.current!, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', width: 330 });
    };
    document.head.appendChild(script);
    return () => script.remove();
  }, []);

  const notice = sessionStorage.getItem('fmh.signedOut');
  return (
    <div className="boot">
      <div className="signin">
        <div className="row" style={{ gap: 10, justifyContent: 'center' }}><div className="brand-mark">F</div><b style={{ fontSize: 15 }}>FindMyHobby</b></div>
        <div className="card">
          <div><h1 style={{ fontSize: 20 }}>Sign in to the staff console</h1>
            <p className="muted" style={{ marginTop: 4 }}>Use the Google account the owner added as staff.</p></div>
          {notice && <p className="note warn" style={{ margin: 0 }}><Icon n="clock" s={15} />{notice}</p>}
          <div ref={button} style={{ minHeight: 44 }} />
          {error && <p className="note error" style={{ margin: 0 }}><Icon n="alert" s={15} />{error}</p>}
          {import.meta.env.DEV && <DevSignIn onError={setError} />}
        </div>
        <p className="signin-foot">Staff only. Every action is recorded in the audit log.</p>
      </div>
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
    <form onSubmit={submit} style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'grid', gap: 10 }}>
      <label className="field">Email (development sign-in only)
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <button className="btn dark">Sign in (dev)</button>
    </form>
  );
}
