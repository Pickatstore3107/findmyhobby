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
import { Reports } from './pages/Reports.tsx';
import { Audit } from './pages/Audit.tsx';
import { can, type Me, type Role } from './roles.ts';
import { Icon, type IconName } from './icons.tsx';
import { Overlays } from './ui.tsx';
import type { Payment } from './types.ts';
import './ui.css';

type PageDef = [path: string, label: string, icon: IconName, minRole: Role, Page: (p: { me: Me }) => React.ReactNode];
// Grouped by the job staff are doing, so the menu reads like the working day.
const GROUPS: [group: string, pages: PageDef[]][] = [
  ['Front desk', [
    ['today', 'Today', 'home', 'desk', Today],
    ['checkin', 'Check-in', 'scan', 'desk', Checkin],
    ['bookings', 'Bookings', 'ticket', 'desk', Bookings],
  ]],
  ['Planning', [
    ['schedule', 'Schedule', 'calendar', 'desk', Schedule],
    ['catalog', 'Activities', 'layers', 'manager', Catalog],
    ['tournaments', 'Tournaments', 'trophy', 'desk', Tournaments],
  ]],
  ['Money', [
    ['payments', 'Payments', 'rupee', 'manager', Payments],
    ['money', 'Revenue', 'chart', 'owner', Money],
  ]],
  ['Insights', [
    ['reports', 'Reports', 'chart', 'manager', Reports],
    ['people', 'Members & staff', 'users', 'manager', People],
    ['audit', 'Activity log', 'history', 'owner', Audit],
  ]],
];
const IDLE_MS = 30 * 60e3; // front-desk computers are shared: sign out after 30 minutes without activity

/** Route is the part of the hash before "?"; anything after is page state (e.g. #/bookings?q=FMH-4K9P2X). */
function useHash() {
  const read = () => location.hash.replace(/^#\/?/, '').split('?')[0] || 'today';
  const [hash, setHash] = useState(read);
  useEffect(() => {
    const on = () => setHash(read());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
}

type Theme = 'light' | 'dark';
function useTheme() {
  const [theme, setTheme] = useState<Theme>(document.documentElement.dataset.theme as Theme);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('fmh.theme', next); } catch { /* private mode: theme just isn't remembered */ }
    setTheme(next);
  };
  return [theme, toggle] as const;
}

/** Signs the session out after a period with no mouse, keyboard or touch activity. */
function useIdleSignOut(signOut: () => void) {
  useEffect(() => {
    let timer = 0;
    const reset = () => { clearTimeout(timer); timer = window.setTimeout(signOut, IDLE_MS); };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const;
    events.forEach((e) => addEventListener(e, reset, { passive: true }));
    reset();
    return () => { clearTimeout(timer); events.forEach((e) => removeEventListener(e, reset)); };
  }, [signOut]);
}

function Clock() {
  const fmt = () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + ' IST';
  const [now, setNow] = useState(fmt);
  useEffect(() => { const t = setInterval(() => setNow(fmt()), 20_000); return () => clearInterval(t); }, []);
  return <span className="clock num">{now}</span>;
}

async function signOut(reason?: string) {
  if (!getToken()) return;
  await api('/auth/logout', {}).catch(() => {});
  setToken(null);
  if (reason) sessionStorage.setItem('fmh.signedOut', reason);
  location.hash = '#/login';
}
const idleSignOut = () => signOut('You were signed out after 30 minutes without activity.');

function App() {
  const route = useHash();
  const [theme, toggleTheme] = useTheme();
  const [q, setQ] = useState('');
  const me = useApi<Me>(getToken() && route !== 'login' ? '/me' : null);
  useIdleSignOut(idleSignOut);
  const pending = useApi<Payment[]>(me.data && can(me.data, 'manager') ? '/admin/payments' : null);
  if (!getToken() || route === 'login') return <><Login /><Overlays /></>;
  if (!me.data) return <div className="boot">{me.error ? <p className="note error">{me.error}</p> : <div className="brand-mark">F</div>}</div>;
  if (!can(me.data, 'desk')) return (
    <div className="boot"><div className="panel" style={{ maxWidth: 420, padding: 24 }}>
      <h1>No access</h1><p className="muted" style={{ marginTop: 6 }}>This account is not staff. Ask the owner to give you a role.</p>
      <button className="btn" style={{ marginTop: 16 }} onClick={() => signOut()}>Sign in with another account</button>
    </div></div>
  );

  const groups = GROUPS.map(([g, list]) => [g, list.filter(([, , , role]) => can(me.data!, role))] as const).filter(([, list]) => list.length);
  const pages = groups.flatMap(([, list]) => list);
  const [current, , , , Page] = pages.find(([p]) => p === route) ?? pages[0];
  const initials = me.data.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const search = (e: React.FormEvent) => { e.preventDefault(); if (q.trim()) location.hash = `#/bookings?q=${encodeURIComponent(q.trim())}`; };

  return (
    <div className="app">
      <aside className="side">
        <div className="brand"><div className="brand-mark">F</div><div><b>FindMyHobby</b><span>Centre #1 · Staff</span></div></div>
        <nav className="nav" aria-label="Main">{groups.map(([group, list]) => (
          <div key={group}>
            <div className="nav-group">{group}</div>
            {list.map(([p, label, icon]) => (
              <a key={p} href={`#/${p}`} className={p === current ? 'on' : ''} aria-current={p === current ? 'page' : undefined}>
                <Icon n={icon} s={16} />{label}
                {p === 'payments' && !!pending.data?.length && <span className="badge num">{pending.data.length}</span>}
              </a>
            ))}
          </div>
        ))}</nav>
        <div className="side-user">
          <span className="avatar">{initials}</span>
          <div><b>{me.data.name}</b><span>{me.data.role}</span></div>
          <button className="btn icon small" onClick={() => signOut()} title="Sign out" aria-label="Sign out"><Icon n="logout" s={16} /></button>
        </div>
      </aside>
      <header className="top">
        <form className="search" onSubmit={search} role="search">
          <Icon n="search" s={15} />
          <input placeholder="Find a booking, member or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search bookings" />
          <kbd>↵</kbd>
        </form>
        <div className="top-right">
          <Clock />
          <button className="btn icon" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`${theme === 'dark' ? 'Light' : 'Dark'} mode`}>
            <Icon n={theme === 'dark' ? 'sun' : 'moon'} s={16} /></button>
        </div>
      </header>
      <main key={current}><Page me={me.data} /></main>
      <Overlays />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
