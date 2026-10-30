import { useState } from 'react';
import { useApi } from '../api.ts';
import { fmtDay, fmtTime, rupees } from '@fmh/shared/time';

type Entry = { id: number; action: string; entity: string; entityId: number; data: Record<string, unknown> | null; at: string; actor: string; actorRole: string };

// Plain-language names for what happened. Unknown actions fall back to their code.
const ACTIONS: Record<string, string> = {
  'auth.login': 'Signed in', 'account.delete': 'Deleted their account',
  'slot.create': 'Created a session', 'slot.update': 'Changed a session', 'slot.cancel': 'Cancelled a session',
  'booking.checkin': 'Checked someone in', 'payment.verify': 'Marked a payment received', 'payment.reject': 'Marked a payment not received',
  'activity.create': 'Added an activity', 'activity.update': 'Changed an activity', 'activity.delete': 'Deleted an activity',
  'category.create': 'Added a category', 'category.update': 'Changed a category', 'host.create': 'Added a host', 'host.update': 'Changed a host',
  'user.update': 'Changed a person’s access', 'points.adjust': 'Adjusted points',
  'tournament.create': 'Created a tournament', 'tournament.update': 'Changed a tournament', 'tournament.draw': 'Generated a draw', 'match.winner': 'Recorded a result',
};
const FILTERS: [string, string][] = [['', 'Everything'], ['user', 'People & sign-ins'], ['payment', 'Payments'], ['slot', 'Sessions'], ['booking', 'Check-ins'], ['activity', 'Activities']];

/** A short, readable summary of the change details. */
function details(e: Entry) {
  const d = e.data ?? {};
  if (e.action === 'payment.verify' || e.action === 'payment.reject') return `${rupees(Math.abs(Number(d.amount ?? 0)))} · ${String(d.method ?? '').toUpperCase()}${d.utr ? ` · UTR ${d.utr}` : ''}`;
  if (e.action === 'user.update') return [d.role && `role → ${d.role}`, d.blocked !== undefined && (d.blocked ? 'blocked' : 'unblocked')].filter(Boolean).join(' · ');
  if (e.action === 'points.adjust') return `${Number(d.points) > 0 ? '+' : ''}${d.points} · ${d.note ?? ''}`;
  if (e.action === 'slot.cancel') return `${d.bookingsCancelled ?? 0} booking(s) cancelled`;
  if (e.action === 'auth.login') return d.ip ? `from ${d.ip}` : '';
  if (typeof d.startsAt === 'string') return `Session on ${fmtDay(d.startsAt)} at ${fmtTime(d.startsAt)}`;
  if (e.entity === 'slot') return 'Session details changed';
  if (typeof d.name === 'string') return d.name;
  return `${e.entity[0].toUpperCase()}${e.entity.slice(1)} #${e.entityId}`;
}

export function Audit() {
  const [entity, setEntity] = useState('');
  const log = useApi<Entry[]>(`/admin/audit${entity ? `?entity=${entity}` : ''}`);
  return (
    <>
      <header className="page"><div><h1>Activity log</h1><span className="sub">Every staff action, sign-in and payment decision. Entries can’t be edited or deleted.</span></div>
        <div className="seg">{FILTERS.map(([k, l]) => <button key={k} className={entity === k ? 'on' : ''} onClick={() => setEntity(k)}>{l}</button>)}</div>
      </header>
      {log.error && <p className="note error">{log.error}</p>}
      <section className="flush">
        <div className="scroll"><table>
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
          <tbody>{(log.data ?? []).map((e) => (
            <tr key={e.id}>
              <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtDay(e.at)}<span className="sub2">{fmtTime(e.at)}</span></td>
              <td><b>{e.actor}</b><span className="sub2" style={{ textTransform: 'capitalize' }}>{e.actorRole}</span></td>
              <td>{ACTIONS[e.action] ?? e.action}</td>
              <td className="muted">{details(e)}</td>
            </tr>
          ))}</tbody>
        </table></div>
        {!log.loading && !log.data?.length && <p className="empty">Nothing recorded yet.</p>}
      </section>
      <p className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>Showing the latest 100 entries.</p>
    </>
  );
}
