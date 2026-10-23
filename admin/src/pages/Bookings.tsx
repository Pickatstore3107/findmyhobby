import { useState } from 'react';
import { downloadCsv, useApi } from '../api.ts';
import { fmtDay, fmtTime, fromIst, istDate, rupees } from '../time.ts';
import type { Booking } from '../types.ts';

const STATUS: Record<Booking['status'], string> = {
  pending: 'Payment pending', confirmed: 'Confirmed', checked_in: 'Checked in', cancelled: 'Cancelled', no_show: 'No-show', expired: 'Expired',
};

export function Bookings() {
  const [from, setFrom] = useState(istDate(new Date()));
  const [to, setTo] = useState(istDate(new Date(Date.now() + 3 * 864e5)));
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const end = new Date(+fromIst(to, '00:00') + 864e5);
  const list = useApi<Booking[]>(`/admin/bookings?from=${fromIst(from, '00:00').toISOString()}&to=${end.toISOString()}`);

  const needle = q.trim().toLowerCase();
  const rows = (list.data ?? []).filter((b) => (!status || b.status === status) &&
    (!needle || [b.name, b.phone, b.ref, b.activity].some((v) => v?.toLowerCase().includes(needle))));
  const active = rows.filter((b) => ['pending', 'confirmed', 'checked_in'].includes(b.status));

  const exportCsv = () => downloadCsv(`bookings-${from}-to-${to}`, [
    ['Booking', 'Status', 'Name', 'Phone', 'Activity', 'Zone', 'Slot date', 'Slot time', 'Seats', 'Amount (₹)', 'Booked at'],
    ...rows.map((b) => [b.ref, STATUS[b.status], b.name, b.phone, b.activity, b.zone, fmtDay(b.startsAt), fmtTime(b.startsAt), b.seats, b.amount / 100,
      `${fmtDay(b.bookedAt)} ${fmtTime(b.bookedAt)}`]),
  ]);

  return (
    <>
      <header className="page"><div><div className="kicker">{rows.length} bookings · {active.reduce((n, b) => n + b.seats, 0)} active seats</div><h1>Bookings</h1></div>
        <button className="btn" onClick={exportCsv} disabled={!rows.length}>Download CSV</button></header>
      <div className="row" style={{ marginBottom: 16 }}>
        <label className="field">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field">To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="field">Status<select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>Search<input placeholder="Name, phone, booking code or activity" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      {list.error && <p className="note error">{list.error}</p>}
      <div className="scroll"><table>
        <thead><tr><th>Slot</th><th>Member</th><th>Activity</th><th>Seats</th><th>Amount</th><th>Status</th><th>Booked at</th></tr></thead>
        <tbody>{rows.map((b) => (
          <tr key={b.ref} className={['cancelled', 'expired'].includes(b.status) ? 'off' : ''}>
            <td className="num"><b>{fmtDay(b.startsAt)}</b><div className="muted">{fmtTime(b.startsAt)}</div></td>
            <td><b>{b.name}</b><div className="muted">{b.phone ?? 'no phone'} · {b.ref}</div></td>
            <td>{b.activity}<div className="muted">{b.zone}</div></td>
            <td className="num">{b.seats}</td>
            <td className="num">{rupees(b.amount)}</td>
            <td><span className={`tag ${b.status === 'checked_in' ? 'dark' : b.status === 'pending' ? 'red' : ''}`}>{STATUS[b.status]}</span></td>
            <td className="muted num">{fmtDay(b.bookedAt)} {fmtTime(b.bookedAt)}</td>
          </tr>
        ))}</tbody>
      </table></div>
      {!list.loading && !rows.length && <p className="muted" style={{ marginTop: 12 }}>No bookings match.</p>}
    </>
  );
}
