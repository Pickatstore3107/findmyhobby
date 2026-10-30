import { useState } from 'react';
import { downloadCsv, useApi } from '../api.ts';
import { fmtDay, fmtTime, fromIst, istDate, rupees } from '@fmh/shared/time';
import type { Report } from '../types.ts';
import { Icon } from '../icons.tsx';

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;

export function Reports() {
  const [from, setFrom] = useState(istDate(new Date(Date.now() - 29 * 864e5)));
  const [to, setTo] = useState(istDate(new Date()));
  const end = new Date(+fromIst(to, '00:00') + 864e5);
  const rep = useApi<Report>(`/admin/reports?from=${fromIst(from, '00:00').toISOString()}&to=${end.toISOString()}`);
  const preset = (days: number) => { setFrom(istDate(new Date(Date.now() - (days - 1) * 864e5))); setTo(istDate(new Date())); };

  const r = rep.data, t = r?.totals;
  const money = t?.revenue !== undefined; // owners see money; managers see occupancy and attendance
  const busiest = Math.max(1, ...(r?.byHour ?? []).map((h) => h.capacity));

  const exportCsv = () => r && downloadCsv(`sessions-${from}-to-${to}`, [
    ['Date', 'Time', 'Activity', 'Seats', 'Booked', 'Occupancy %', 'Attended', 'No-shows', 'Cancellations', ...(money ? ['Revenue (₹)'] : [])],
    ...r.bySession.map((s) => [fmtDay(s.starts_at), fmtTime(s.starts_at), s.activity, s.capacity, s.booked, pct(s.booked, s.capacity),
      s.attended, s.no_shows, s.cancellations, ...(money ? [(s.revenue ?? 0) / 100] : [])]),
  ]);

  return (
    <>
      <header className="page"><div><h1>Reports</h1><span className="sub">{fmtDay(fromIst(from, '00:00'))} – {fmtDay(fromIst(to, '00:00'))} · bookings, occupancy, revenue and attendance</span></div>
        <button className="btn" onClick={exportCsv} disabled={!r?.bySession.length}><Icon n="download" s={16} />Sessions CSV</button></header>
      <div className="row" style={{ marginBottom: 16, alignItems: 'flex-end' }}>
        <label className="field">From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field">To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="seg" style={{ marginBottom: 2 }}>
          <button onClick={() => preset(7)}>Last 7 days</button><button onClick={() => preset(30)}>Last 30 days</button><button onClick={() => preset(90)}>90 days</button>
        </div>
      </div>
      {rep.error && <p className="note error">{rep.error}</p>}

      {t && <>
        <div className="stats">
          {money && <div className="stat"><span className="kicker">Revenue</span><span className="v num">{rupees(t.revenue!)}</span><span className="muted">verified, after refunds</span></div>}
          <div className="stat"><span className="kicker">Occupancy</span><span className="v num">{pct(t.booked, t.capacity)}%</span><span className="muted">{t.booked} of {t.capacity} seats · {t.sessions} sessions</span>
            <div className="meter"><span style={{ width: `${pct(t.booked, t.capacity)}%` }} /></div></div>
          <div className="stat"><span className="kicker">Attendance</span><span className="v num">{pct(t.attended, t.booked)}%</span><span className="muted">{t.noShows} no-show seats</span></div>
          <div className="stat"><span className="kicker">Repeat members</span><span className="v num">{t.repeat_members}<small> / {t.members}</small></span><span className="muted">booked 2+ times · {t.bookings} bookings</span></div>
          <div className="stat"><span className="kicker">Cancellations</span><span className="v num">{t.cancellations}</span><span className="muted">bookings in range</span></div>
        </div>

        <section>
          <h2>By activity</h2>
          <div className="scroll"><table>
            <thead><tr><th>Activity</th><th>Sessions</th><th>Booked</th><th>Occupancy</th><th>Attended</th><th>No-shows</th>{money && <><th>Revenue</th><th>Per session</th></>}</tr></thead>
            <tbody>{r.byActivity.map((a) => (
              <tr key={a.id}>
                <td><b>{a.activity}</b><div className="muted">{a.category}</div></td>
                <td className="num">{a.sessions}</td>
                <td className="num">{a.booked}/{a.capacity}</td>
                <td className="num"><div className="bar"><span style={{ width: `${pct(a.booked, a.capacity)}%` }} /></div> {pct(a.booked, a.capacity)}%</td>
                <td className="num">{a.attended}</td>
                <td className="num">{a.no_shows}</td>
                {money && <><td className="num"><b>{rupees(a.revenue!)}</b></td>
                <td className="num">{rupees(Math.round(a.revenue! / a.sessions))}</td></>}
              </tr>
            ))}</tbody>
          </table></div>
          {!r.byActivity.length && <p className="empty">No sessions in this range.</p>}
        </section>

        <section>
          <h2>Peak and quiet hours</h2>
          <p className="muted" style={{ marginBottom: 10, fontSize: 12 }}>Bar length is seats offered at that start time; the dark part is seats booked.</p>
          <table><tbody>{r.byHour.map((h) => (
            <tr key={h.hour}>
              <td className="num" style={{ width: 70, borderBottom: 0 }}><b>{hourLabel(h.hour)}</b></td>
              <td><div className="bar wide" style={{ width: `${(h.capacity / busiest) * 100}%` }}><span style={{ width: `${pct(h.booked, h.capacity)}%` }} /></div></td>
              <td className="num muted" style={{ width: 170, textAlign: 'right' }}>{pct(h.booked, h.capacity)}% full · {h.sessions} session{h.sessions === 1 ? '' : 's'}</td>
            </tr>
          ))}</tbody></table>
        </section>
      </>}
    </>
  );
}
