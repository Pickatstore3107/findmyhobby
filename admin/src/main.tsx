import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, getToken, setToken, useApi } from './api.ts';
import { Login } from './pages/Login.tsx';
import { Today } from './pages/Today.tsx';
import { Schedule } from './pages/Schedule.tsx';
import { Bookings } from './pages/Bookings.tsx';
import { Payments } from './pages/Payments.tsx';
import { Checkin } from './pages/Checkin.tsx';
import { Tournaments } from './pages/Tournaments.tsx';
import { Catalog } from './pages/Catalog.tsx';
import { Money } from './pages/Money.tsx';
import { People } from './pages/People.tsx';
import { can, type Me, type Role } from './roles.ts';
import './ui.css';


const PAGES: [path: string, label: string, minRole: Role, Page: (p: { me: Me }) => React.ReactNode][] = [
  ['today', 'Today', 'desk', Today],
  ['schedule', 'Schedule', 'desk', Schedule],
  ['bookings', 'Bookings', 'desk', Bookings],
  ['payments', 'Payments', 'manager', Payments],
  ['checkin', 'Check-in', 'desk', Checkin],
  ['tournaments', 'Tournaments', 'desk', Tournaments],
  ['catalog', 'Activities & zones', 'manager', Catalog],
  ['money', 'Money', 'owner', Money],
  ['people', 'People', 'owner', People],
];

function useHash() {
  const read = () => location.hash.replace(/^#\/?/, '') || 'today';
  const [hash, setHash] = useState(read);
  useEffect(() => {
    const on = () => setHash(read());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
}

function App() {
  const route = useHash();
  const me = useApi<Me>(getToken() && route !== 'login' ? '/me' : null);
  if (!getToken() || route === 'login') return <Login />;
  if (!me.data) return <p className="login">{me.error ?? 'Loading…'}</p>;
  if (!can(me.data, 'desk')) return <div className="login"><h1>No access</h1><p>This account is not staff. Ask the owner to give you a role.</p></div>;

  const pages = PAGES.filter(([, , role]) => can(me.data!, role));
  const [, label, , Page] = pages.find(([p]) => p === route) ?? pages[0];
  const signOut = async () => { await api('/auth/logout', {}).catch(() => {}); setToken(null); location.hash = '#/login'; };

  return (
    <div className="app">
      <aside>
        <div className="brand"><b>FindMyHobby</b><span className="muted">Club admin</span></div>
        <nav>{pages.map(([p, l]) => <a key={p} href={`#/${p}`} className={l === label ? 'on' : ''}>{l}</a>)}</nav>
        <div className="who"><b>{me.data.name}</b><div className="muted">{me.data.role}</div>
          <button className="btn small" onClick={signOut}>Sign out</button></div>
      </aside>
      <main><Page me={me.data} /></main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
