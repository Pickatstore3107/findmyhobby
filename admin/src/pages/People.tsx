import { useState } from 'react';
import { api, message, useApi } from '../api.ts';
import { can, type Me } from '../roles.ts';
import { fmtDay, fmtTime, rupees } from '@fmh/shared/time';
import { Icon } from '../icons.tsx';
import { ask, askForm, Drawer, toast } from '../ui.tsx';
import type { AdminUser, Booking, MemberRecord } from '../types.ts';

const ROLES: [AdminUser['role'], string][] = [['member', 'Member'], ['desk', 'Front desk'], ['manager', 'Manager'], ['owner', 'Owner']];
const STATUS: Record<Booking['status'], [string, string]> = {
  pending: ['Payment pending', 'warn'], confirmed: ['Booked', ''], checked_in: ['Attended', 'ok'], cancelled: ['Cancelled', ''], no_show: ['No-show', 'red'], expired: ['Expired', ''],
};
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/** One member's record: bookings with attendance, points, and a way to award or deduct points. */
function MemberDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const rec = useApi<MemberRecord>(`/admin/users/${id}`);
  const award = async () => {
    const v = await askForm({ title: 'Award points', body: 'Use a minus sign to deduct. The reason is for staff only.', confirm: 'Save', fields: [
      { name: 'points', label: 'Points', type: 'number', min: -1000, max: 1000, value: '10' },
      { name: 'note', label: 'Reason', value: '', placeholder: 'e.g. Quiz night winner' },
    ] });
    if (!v || !Number(v.points)) return;
    try { await api(`/admin/users/${id}/points`, { points: Math.round(Number(v.points)), note: v.note.trim() }); toast('Points saved.'); rec.reload(); }
    catch (e) { toast(message(e), true); }
  };
  const r = rec.data;
  const count = (st: Booking['status']) => r?.bookings.filter((b) => b.status === st).length ?? 0;
  return (
    <Drawer kicker={r ? `Member since ${fmtDay(r.user.joined)}` : 'Member'} title={r?.user.name ?? 'Loading…'} onClose={onClose}
      foot={<button className="btn dark" onClick={award}><Icon n="star" s={15} />Award points</button>}>
      {rec.error && <p className="note error">{rec.error}</p>}
      {r && <>
        <p className="muted">{r.user.email} · {r.user.phone ?? 'no phone'}</p>
        <div className="kv">
          <div><span>Points</span><b className="num">{r.points.total}</b></div>
          <div><span>Attended</span><b className="num">{count('checked_in')}</b></div>
          <div><span>No-shows</span><b className="num">{count('no_show')}</b></div>
          <div><span>Cancelled</span><b className="num">{count('cancelled')}</b></div>
        </div>
        <div className="kicker" style={{ marginTop: 6 }}>Booking history</div>
        <table><tbody>{r.bookings.map((b) => (
          <tr key={b.ref}><td><b>{b.activity}</b><div className="muted num" style={{ fontSize: 12 }}>{fmtDay(b.startsAt)} {fmtTime(b.startsAt)} · {b.seats} seat{b.seats > 1 ? 's' : ''} · {rupees(b.amount)}</div></td>
            <td style={{ textAlign: 'right' }}><span className={`tag ${STATUS[b.status][1]}`}>{STATUS[b.status][0]}</span></td></tr>
        ))}</tbody></table>
        {!r.bookings.length && <p className="empty">No bookings yet.</p>}
        {!!r.points.ledger.length && <>
          <div className="kicker" style={{ marginTop: 6 }}>Points history</div>
          <table><tbody>{r.points.ledger.slice(0, 20).map((p) => (
            <tr key={p.id}><td>{p.note ?? (p.reason === 'attended' ? 'Attended a session' : p.reason)}<div className="muted" style={{ fontSize: 12 }}>{fmtDay(p.createdAt)}</div></td>
              <td className="num" style={{ textAlign: 'right', fontWeight: 600, color: p.points < 0 ? 'var(--brand-text)' : 'var(--ok)' }}>{p.points > 0 ? '+' : ''}{p.points}</td></tr>
          ))}</tbody></table>
        </>}
      </>}
    </Drawer>
  );
}

export function People({ me }: { me: Me }) {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const users = useApi<AdminUser[]>(`/admin/users?q=${encodeURIComponent(search)}`);
  const [open, setOpen] = useState<number | null>(null);
  const owner = can(me, 'owner');

  const change = async (u: AdminUser, body: Partial<AdminUser>, title: string, consequence: string) => {
    if (!(await ask({ title, body: consequence, confirm: title, danger: body.blocked === true }))) return users.reload(); // reload resets the dropdown
    try { await api(`/admin/users/${u.id}`, body, 'PATCH'); toast(`${u.name} updated.`); users.reload(); }
    catch (e) { toast(message(e), true); }
  };

  return (
    <>
      <header className="page"><div><h1>Members & staff</h1><span className="sub">Members and staff · click a name for bookings, attendance and points</span></div></header>
      <p className="note"><Icon n="info" s={16} /><span><b>Front desk</b> checks people in and sees bookings. <b>Manager</b> also schedules, verifies payments, runs tournaments and sees reports.
        <b> Owner</b> can do everything, including money and roles. A person must sign in once before they can be given a role.</span></p>
      <section>
        <form className="row" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
          <input placeholder="Search name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <button className="btn dark"><Icon n="search" s={15} />Search</button>
        </form>
        <div className="scroll"><table>
          <thead><tr><th>Name</th><th>Contact</th><th>Role</th><th /></tr></thead>
          <tbody>{(users.data ?? []).map((u) => (
            <tr key={u.id} className={u.blocked ? 'off' : ''}>
              <td><button className="link row" style={{ flexWrap: 'nowrap' }} onClick={() => setOpen(u.id)}>
                <span className="avatar" style={{ width: 30, height: 30, fontSize: 11 }}>{initials(u.name)}</span>
                <b>{u.name}</b>{u.id === me.id && <span className="muted">(you)</span>}</button></td>
              <td>{u.email}<div className="muted" style={{ fontSize: 12 }}>{u.phone ?? 'no phone'}</div></td>
              <td>{owner && u.id !== me.id
                ? <select value={u.role} style={{ minHeight: 32, fontSize: 13 }} onChange={(e) => {
                    const role = e.target.value as AdminUser['role'], label = ROLES.find(([r]) => r === role)![1];
                    change(u, { role }, `Make ${label}`, `${u.name} will get ${label} access the next time they load the console.`);
                  }}>{ROLES.map(([r, l]) => <option key={r} value={r}>{l}</option>)}</select>
                : <span className={`tag ${u.role === 'member' ? '' : 'dark'}`}>{ROLES.find(([r]) => r === u.role)![1]}</span>}
                {u.blocked && <span className="tag red" style={{ marginLeft: 6 }}>Blocked</span>}</td>
              <td style={{ textAlign: 'right' }}>{owner && u.id !== me.id && <button className={`btn small ${u.blocked ? '' : 'danger'}`}
                onClick={() => change(u, { blocked: !u.blocked }, u.blocked ? 'Unblock' : 'Block', u.blocked ? `${u.name} can sign in and book again.` : `${u.name} is signed out and can no longer book.`)}>
                {u.blocked ? 'Unblock' : 'Block'}</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        {!users.loading && !users.data?.length && <p className="empty">Nobody found.</p>}
        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>Showing up to 100 people. Search to find someone specific.</p>
      </section>
      {open && <MemberDrawer key={open} id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
