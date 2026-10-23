import { useState } from 'react';
import { api, message, useApi } from '../api.ts';
import type { Me } from '../roles.ts';
import type { AdminUser } from '../types.ts';

const ROLES: [AdminUser['role'], string][] = [['member', 'Member'], ['desk', 'Front desk'], ['manager', 'Manager'], ['owner', 'Owner']];

export function People({ me }: { me: Me }) {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const users = useApi<AdminUser[]>(`/admin/users?q=${encodeURIComponent(search)}`);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const change = async (u: AdminUser, body: Partial<AdminUser>, what: string) => {
    if (!confirm(`${what} for ${u.name}?`)) return users.reload(); // reload resets the dropdown
    try { await api(`/admin/users/${u.id}`, body, 'PATCH'); setNote({ ok: true, text: `${u.name}: ${what.toLowerCase()} done.` }); users.reload(); }
    catch (e) { setNote({ ok: false, text: message(e) }); }
  };

  return (
    <>
      <header className="page"><div><div className="kicker">Members and staff</div><h1>People</h1></div></header>
      <p className="note"><b>Front desk</b> can check people in and see bookings. <b>Manager</b> can also schedule, verify payments and run tournaments.
        <b> Owner</b> can do everything, including money and roles. A person must sign in once before you can give them a role.</p>
      <form className="row" style={{ marginBottom: 16 }} onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
        <input placeholder="Search name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <button className="btn">Search</button>
      </form>
      {note && <p className={`note ${note.ok ? 'ok' : 'error'}`}>{note.text}</p>}
      <div className="scroll"><table>
        <thead><tr><th>Name</th><th>Contact</th><th>Role</th><th>Status</th></tr></thead>
        <tbody>{(users.data ?? []).map((u) => (
          <tr key={u.id} className={u.blocked ? 'off' : ''}>
            <td><b>{u.name}</b>{u.id === me.id && <span className="muted"> (you)</span>}</td>
            <td>{u.email}<div className="muted">{u.phone ?? 'no phone'}</div></td>
            <td><select value={u.role} disabled={u.id === me.id} onChange={(e) => change(u, { role: e.target.value as AdminUser['role'] }, `Make ${ROLES.find(([r]) => r === e.target.value)![1]}`)}>
              {ROLES.map(([r, l]) => <option key={r} value={r}>{l}</option>)}</select></td>
            <td>{u.id !== me.id && <button className={`btn small ${u.blocked ? '' : 'danger'}`} onClick={() => change(u, { blocked: !u.blocked }, u.blocked ? 'Unblock' : 'Block')}>
              {u.blocked ? 'Unblock' : 'Block'}</button>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="muted" style={{ marginTop: 8 }}>Showing up to 100 people. Search to find someone specific.</p>
    </>
  );
}
