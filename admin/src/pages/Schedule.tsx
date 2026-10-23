import { useState } from 'react';
import { api, message, useApi } from '../api.ts';
import { can, type Me } from '../roles.ts';
import { fmtDay, fmtRange, fmtTime, fromIst, istDate, istDay, rupees } from '../time.ts';
import type { AdminSlot, Catalog } from '../types.ts';

const DURATIONS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6];
const blank = { activityId: '', zoneId: '', date: istDate(new Date()), time: '18:00', hours: '1', price: '', capacity: '', hostName: '', repeatWeeks: '0' };

export function Schedule({ me }: { me: Me }) {
  const [week, setWeek] = useState(0);
  const from = istDay(week * 7), to = istDay(week * 7 + 7);
  const slots = useApi<AdminSlot[]>(`/admin/slots?from=${from.toISOString()}&to=${to.toISOString()}`);
  const catalog = useApi<Catalog>('/admin/catalog');
  const [f, setF] = useState(blank);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  // Picking an activity fills in its usual price and seats; both can still be changed for this slot.
  const pickActivity = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const a = catalog.data?.activities.find((x) => x.id === Number(e.target.value));
    setF({ ...f, activityId: e.target.value, price: a ? String(a.defaultPrice / 100) : '', capacity: a ? String(a.defaultCapacity) : '' });
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const startsAt = fromIst(f.date, f.time);
    try {
      const res = await api<{ created: number[]; clashes: string[] }>('/admin/slots', {
        activityId: Number(f.activityId), zoneId: Number(f.zoneId), startsAt, endsAt: new Date(+startsAt + Number(f.hours) * 3600e3),
        price: Math.round(Number(f.price) * 100), capacity: Number(f.capacity), hostName: f.hostName.trim() || undefined, repeatWeeks: Number(f.repeatWeeks),
      });
      const skipped = res.clashes.length ? ` Skipped ${res.clashes.length} (zone busy): ${res.clashes.map(fmtDay).join(' · ')}.` : '';
      setNote({ ok: res.created.length > 0, text: `Created ${res.created.length} slot${res.created.length === 1 ? '' : 's'}.${skipped}` });
      slots.reload();
    } catch (err) { setNote({ ok: false, text: message(err) }); }
  };

  const cancel = async ({ slot, activity }: AdminSlot) => {
    const msg = `Cancel ${activity} on ${fmtDay(slot.startsAt)} at ${fmtTime(slot.startsAt)}?\n\n${slot.bookedSeats} booked seat(s) will be cancelled and paid bookings will get refund entries.`;
    if (!confirm(msg)) return;
    try { const r = await api<{ bookingsCancelled: number }>(`/admin/slots/${slot.id}/cancel`, {}); setNote({ ok: true, text: `Slot cancelled. ${r.bookingsCancelled} booking(s) cancelled.` }); slots.reload(); }
    catch (err) { setNote({ ok: false, text: message(err) }); }
  };

  const days = Array.from({ length: 7 }, (_, i) => istDay(week * 7 + i));
  const byDay = (d: Date) => (slots.data ?? []).filter((s) => istDate(s.slot.startsAt) === istDate(d));
  const editable = can(me, 'manager');

  return (
    <>
      <header className="page"><div><div className="kicker">{fmtDay(from)} – {fmtDay(new Date(+to - 1))}</div><h1>Schedule</h1></div>
        <div className="row">
          <button className="btn" onClick={() => setWeek(week - 1)} disabled={week <= 0}>← Previous week</button>
          <button className="btn" onClick={() => setWeek(0)} disabled={week === 0}>This week</button>
          <button className="btn" onClick={() => setWeek(week + 1)}>Next week →</button>
        </div>
      </header>

      {editable && catalog.data && (
        <section>
          <h2>New slot</h2>
          <form className="form" onSubmit={create}>
            <label className="field">Activity<select required value={f.activityId} onChange={pickActivity}>
              <option value="">Choose…</option>{catalog.data.activities.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            <label className="field">Zone<select required value={f.zoneId} onChange={set('zoneId')}>
              <option value="">Choose…</option>{catalog.data.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select></label>
            <label className="field">Date<input type="date" required min={istDate(new Date())} value={f.date} onChange={set('date')} /></label>
            <label className="field">Start time<input type="time" required step={900} value={f.time} onChange={set('time')} /></label>
            <label className="field">Duration<select value={f.hours} onChange={set('hours')}>
              {DURATIONS.map((h) => <option key={h} value={h}>{h < 1 ? '30 min' : `${h} hour${h > 1 ? 's' : ''}`}</option>)}</select></label>
            <label className="field">Price per seat (₹)<input type="number" required min={0} step="1" value={f.price} onChange={set('price')} /></label>
            <label className="field">Seats (max 30)<input type="number" required min={1} max={30} value={f.capacity} onChange={set('capacity')} /></label>
            <label className="field">Instructor (optional)<input maxLength={60} value={f.hostName} onChange={set('hostName')} /></label>
            <label className="field">Repeat weekly<select value={f.repeatWeeks} onChange={set('repeatWeeks')}>
              <option value="0">Just once</option>{[1, 2, 3, 4, 8, 12].map((w) => <option key={w} value={w}>+ next {w} week{w > 1 ? 's' : ''}</option>)}</select></label>
            <button className="btn primary">Create slot</button>
          </form>
          {note && <p className={`note ${note.ok ? 'ok' : 'error'}`}>{note.text}</p>}
        </section>
      )}

      {slots.error && <p className="note error">{slots.error}</p>}
      {days.map((d) => {
        const list = byDay(d);
        return (
          <section key={+d}>
            <h2>{fmtDay(d)} <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· {list.filter((s) => !s.slot.cancelled).length} slots</span></h2>
            {list.length ? (
              <div className="scroll"><table>
                <thead><tr><th>Time</th><th>Activity</th><th>Zone</th><th>Booked</th><th>Price</th><th>Instructor</th><th /></tr></thead>
                <tbody>{list.map((s) => (
                  <tr key={s.slot.id} className={s.slot.cancelled ? 'off' : ''}>
                    <td className="num"><b>{fmtRange(s.slot.startsAt, s.slot.endsAt)}</b></td>
                    <td>{s.activity}</td><td>{s.zone}</td>
                    <td className="num">{s.slot.bookedSeats}/{s.slot.capacity}{s.slot.bookedSeats >= s.slot.capacity && !s.slot.cancelled && <> <span className="tag dark">Full</span></>}</td>
                    <td className="num">{rupees(s.slot.price)}</td>
                    <td>{s.slot.hostName ?? <span className="muted">—</span>}</td>
                    <td style={{ textAlign: 'right' }}>{s.slot.cancelled ? <span className="tag">Cancelled</span>
                      : editable && +new Date(s.slot.startsAt) > Date.now() && <button className="btn small danger" onClick={() => cancel(s)}>Cancel</button>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <p className="muted">Nothing scheduled.</p>}
          </section>
        );
      })}
    </>
  );
}
