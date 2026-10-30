import { useState } from 'react';
import { api, message, useApi } from '../api.ts';
import { can, type Me } from '../roles.ts';
import { fmtDay, fmtRange, fmtTime, fromIst, istDate, istDay, istHours, rupees } from '@fmh/shared/time';
import { Icon } from '../icons.tsx';
import { ask, askForm, cat, Drawer, toast } from '../ui.tsx';
import type { AdminSlot, Catalog } from '../types.ts';

const DURATIONS = [30, 45, 60, 90, 120, 150, 180, 240];
const pctOf = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
type Clash = { startsAt: string; code: string; with: { activity: string; startsAt: string; endsAt: string } };

export function Schedule({ me }: { me: Me }) {
  const [week, setWeek] = useState(0);
  const from = istDay(week * 7), to = istDay(week * 7 + 7);
  const slots = useApi<AdminSlot[]>(`/admin/slots?from=${from.toISOString()}&to=${to.toISOString()}`);
  const catalog = useApi<Catalog>('/admin/catalog');
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState<{ date: string; time: string } | null>(() => location.hash.includes('new=1') ? { date: istDate(new Date()), time: '18:00' } : null);
  const editable = can(me, 'manager');

  const days = Array.from({ length: 7 }, (_, i) => istDay(week * 7 + i));
  const all = slots.data ?? [];
  const byDay = (d: Date) => all.filter((s) => istDate(s.slot.startsAt) === istDate(d) && !s.slot.cancelled);
  const live = all.filter((s) => !s.slot.cancelled);
  const booked = live.reduce((n, s) => n + s.slot.bookedSeats, 0), cap = live.reduce((n, s) => n + s.slot.capacity, 0);
  const open = all.find((s) => s.slot.id === openId);
  // The grid spans the week's sessions (at least 8 AM – 9 PM), so short sessions stay readable.
  const FIRST = Math.min(8, ...live.map((s) => Math.floor(istHours(s.slot.startsAt))));
  const LAST = Math.max(21, ...live.map((s) => Math.ceil(istHours(s.slot.endsAt))));
  const SPAN = LAST - FIRST, at = (h: number) => `${((Math.min(Math.max(h, FIRST), LAST) - FIRST) / SPAN) * 100}%`;
  const today = istDate(new Date());

  // Clicking an empty part of a day opens "New session" at that hour.
  const clickLane = (d: Date, e: React.MouseEvent<HTMLDivElement>) => {
    if (!editable || e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect(), hour = FIRST + Math.floor(((e.clientX - r.left) / r.width) * SPAN);
    setCreating({ date: istDate(d), time: `${String(hour).padStart(2, '0')}:00` });
  };

  return (
    <>
      <header className="page">
        <div><h1>Schedule</h1><span className="sub">{live.length} sessions · {booked} of {cap} seats booked · members can book 4 days ahead</span></div>
        {editable && <button className="btn primary" onClick={() => setCreating({ date: istDate(new Date()), time: '18:00' })}><Icon n="plus" s={16} />New session</button>}
      </header>

      <div className="spread" style={{ marginBottom: 14 }}>
        <div className="row">
          <button className="btn small" onClick={() => setWeek(week - 1)} disabled={week <= 0} aria-label="Previous week" style={{ width: 34, height: 34, padding: 0 }}><Icon n="left" s={16} /></button>
          <button className="btn" onClick={() => setWeek(0)} disabled={week === 0}>This week</button>
          <button className="btn small" onClick={() => setWeek(week + 1)} aria-label="Next week" style={{ width: 34, height: 34, padding: 0 }}><Icon n="chev" s={16} /></button>
          <b style={{ fontSize: 14, fontWeight: 600, marginLeft: 6 }}>{fmtDay(from)} – {fmtDay(new Date(+to - 1))}</b>
        </div>
        <div className="row" style={{ gap: 14 }}>{catalog.data?.categories.map((c) => <span key={c.id} className="tag cat" style={cat(c.color)}>{c.name}</span>)}</div>
      </div>

      {slots.error && <p className="note error">{slots.error}</p>}
      <section className="flush">
        <div className="scroll"><div className="week" style={{ '--hours': SPAN } as React.CSSProperties}>
          <div className="hours num" style={{ gridTemplateColumns: `132px repeat(${SPAN}, 1fr)`, padding: '10px 0 6px', background: 'var(--sub)' }}><span style={{ border: 0 }} />
            {Array.from({ length: SPAN }, (_, i) => { const h = FIRST + i; return <span key={h}>{h % 12 || 12}{h < 12 ? 'a' : 'p'}</span>; })}
          </div>
          {days.map((d) => {
            const list = byDay(d), isToday = istDate(d) === today;
            const dayBooked = list.reduce((n, s) => n + s.slot.bookedSeats, 0), dayCap = list.reduce((n, s) => n + s.slot.capacity, 0);
            return (
              <div key={+d} className={`cal-row ${isToday ? 'is-today' : ''}`}>
                <div className={`day-name ${isToday ? 'today' : ''}`}>
                  <b>{d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' })}{isToday && ' · Today'}</b>
                  <span>{list.length} sessions{dayCap ? ` · ${pctOf(dayBooked, dayCap)}% booked` : ''}</span>
                </div>
                <div className="lane" onClick={(e) => clickLane(d, e)} style={{ cursor: editable ? 'copy' : undefined }}>
                  {list.map((s) => {
                    const a = istHours(s.slot.startsAt), b = istHours(s.slot.endsAt), full = s.slot.bookedSeats >= s.slot.capacity;
                    return (
                      <button key={s.slot.id} className={`chip ${s.slot.closed ? 'closed' : ''} ${+new Date(s.slot.endsAt) < Date.now() ? 'past' : ''}`}
                        style={{ ...cat(s.color), left: at(a), width: `calc(${at(b)} - ${at(a)} - 3px)` }} onClick={() => setOpenId(s.slot.id)}
                        title={`${s.activity} · ${fmtRange(s.slot.startsAt, s.slot.endsAt)} · ${s.slot.bookedSeats}/${s.slot.capacity}`}>
                        <b>{s.activity}</b>
                        <span className="num">{fmtTime(s.slot.startsAt)} · {full ? 'FULL' : `${s.slot.bookedSeats}/${s.slot.capacity}`}</span>
                      </button>
                    );
                  })}
                  {isToday && <div className="now" style={{ top: 0, bottom: 0, left: at(istHours(new Date())) }} />}
                </div>
              </div>
            );
          })}
        </div></div>
      </section>
      {editable && <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>Click an empty part of a day to add a session there. The centre runs one session at a time with 30 minutes to change over.</p>}

      {open && <SlotDrawer s={open} editable={editable} onClose={() => setOpenId(null)} onChange={slots.reload} />}
      {creating && catalog.data && <NewSession catalog={catalog.data} initial={creating} existing={all}
        onClose={() => { setCreating(null); if (location.hash.includes('new=1')) history.replaceState(null, '', '#/schedule'); }} onCreated={slots.reload} />}
    </>
  );
}

function SlotDrawer({ s, editable, onClose, onChange }: { s: AdminSlot; editable: boolean; onClose: () => void; onChange: () => void }) {
  const future = +new Date(s.slot.startsAt) > Date.now();
  const patch = (body: object, text: string) => api(`/admin/slots/${s.slot.id}`, body, 'PATCH').then(() => { toast(text); onChange(); }, (e) => toast(message(e), true));

  const edit = async () => {
    const v = await askForm({ title: 'Edit session', body: 'New prices apply to new bookings only.', confirm: 'Save', fields: [
      { name: 'price', label: 'Price per seat (₹)', type: 'number', min: 0, value: String(s.slot.price / 100) },
      { name: 'capacity', label: `Seats (${s.slot.bookedSeats} booked, max 30)`, type: 'number', min: Math.max(1, s.slot.bookedSeats), max: 30, value: String(s.slot.capacity) },
    ] });
    if (v) patch({ price: Math.round(Number(v.price) * 100), capacity: Number(v.capacity) }, 'Session updated.');
  };
  const cancel = async () => {
    if (!(await ask({ title: 'Cancel session?', confirm: 'Cancel session', danger: true,
      body: `${s.activity} on ${fmtDay(s.slot.startsAt)} at ${fmtTime(s.slot.startsAt)}. ${s.slot.bookedSeats} booked seat(s) will be cancelled and paid bookings get refund entries.` }))) return;
    try {
      const r = await api<{ bookingsCancelled: number }>(`/admin/slots/${s.slot.id}/cancel`, {});
      toast(`Session cancelled · ${r.bookingsCancelled} booking(s) cancelled.`); onChange(); onClose();
    } catch (e) { toast(message(e), true); }
  };

  return (
    <Drawer kicker={<><span className="dot" style={cat(s.color)} />{fmtDay(s.slot.startsAt)}</>} title={s.activity} onClose={onClose}
      foot={editable && future && !s.slot.cancelled ? <>
        <button className="btn dark" onClick={edit}><Icon n="pencil" s={15} />Edit</button>
        <button className="btn" onClick={() => patch({ closed: !s.slot.closed }, s.slot.closed ? 'Open for booking again.' : 'Closed to new bookings.')}>
          <Icon n={s.slot.closed ? 'check' : 'ban'} s={15} />{s.slot.closed ? 'Open booking' : 'Close booking'}</button>
        <button className="btn danger" style={{ marginLeft: 'auto' }} onClick={cancel}>Cancel session</button>
      </> : undefined}>
      <div className="kv">
        <div><span>Time</span><b className="num">{fmtRange(s.slot.startsAt, s.slot.endsAt)}</b></div>
        <div><span>Booked</span><b className="num">{s.slot.bookedSeats} / {s.slot.capacity}</b></div>
        <div><span>Price per seat</span><b className="num">{rupees(s.slot.price)}</b></div>
        <div><span>Host</span><b>{s.hostName ?? '—'}</b></div>
      </div>
      <div className="meter red" style={{ height: 8 }}><span style={{ width: `${pctOf(s.slot.bookedSeats, s.slot.capacity)}%` }} /></div>
      {s.slot.closed && <p className="note warn"><Icon n="ban" s={16} />Closed: it still runs, but takes no new bookings.</p>}
      {s.slot.cancelled && <p className="note error">This session was cancelled.</p>}
      <a className="btn" href={`#/bookings?q=${encodeURIComponent(s.activity)}`}><Icon n="ticket" s={15} />See bookings</a>
    </Drawer>
  );
}

function NewSession({ catalog, initial, existing, onClose, onCreated }: {
  catalog: Catalog; initial: { date: string; time: string }; existing: AdminSlot[]; onClose: () => void; onCreated: () => void;
}) {
  const [f, setF] = useState({ activityId: '', date: initial.date, time: initial.time, durationMin: '60', price: '', capacity: '', hostId: '',
    repeat: 'none', repeatCount: '3', allowShortChangeover: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const dayList = existing.filter((s) => !s.slot.cancelled && istDate(s.slot.startsAt) === f.date);

  const pick = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const a = catalog.activities.find((x) => x.id === Number(e.target.value));
    setF({ ...f, activityId: e.target.value, price: a ? String(a.defaultPrice / 100) : '', capacity: a ? String(a.defaultCapacity) : '',
      durationMin: a ? String(a.durationMin) : f.durationMin, hostId: a?.defaultHostId ? String(a.defaultHostId) : '' });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const res = await api<{ created: number[]; clashes: Clash[] }>('/admin/slots', {
        activityId: Number(f.activityId), startsAt: fromIst(f.date, f.time), durationMin: Number(f.durationMin),
        price: Math.round(Number(f.price) * 100), capacity: Number(f.capacity), hostId: f.hostId ? Number(f.hostId) : null,
        repeatEvery: f.repeat === 'none' ? 'week' : f.repeat, repeatCount: f.repeat === 'none' ? 0 : Number(f.repeatCount), allowShortChangeover: f.allowShortChangeover,
      });
      onCreated();
      const skipped = res.clashes.map((c) => `${fmtDay(c.startsAt)}: ${c.code === 'SHORT_CHANGEOVER' ? 'under 30 min from' : 'clashes with'} ${c.with.activity} ${fmtRange(c.with.startsAt, c.with.endsAt)}`);
      if (res.created.length) { toast(`Created ${res.created.length} session${res.created.length === 1 ? '' : 's'}${skipped.length ? `, skipped ${skipped.length}` : ''}.`); }
      if (skipped.length) setError(`${res.created.length ? 'Some dates were skipped' : 'Not created'}: ${skipped.join(' · ')}`);
      else onClose();
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  };

  return (
    <Drawer title="New session" kicker="Schedule" onClose={onClose}
      foot={<><button form="new-session" className="btn primary lg" disabled={busy}>{busy ? 'Creating…' : 'Create session'}</button><button className="btn lg" onClick={onClose}>Cancel</button></>}>
      <form id="new-session" className="form" onSubmit={submit}>
        <label className="field wide">Activity<select required value={f.activityId} onChange={pick}>
          <option value="">Choose…</option>{catalog.activities.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label className="field">Date<input type="date" required min={istDate(new Date())} value={f.date} onChange={set('date')} /></label>
        <label className="field">Start<input type="time" required step={900} value={f.time} onChange={set('time')} /></label>
        <label className="field">Length<select value={f.durationMin} onChange={set('durationMin')}>
          {[...new Set([...DURATIONS, Number(f.durationMin)])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} hr`}</option>)}</select></label>
        <label className="field">Seats (1–30)<input type="number" required min={1} max={30} value={f.capacity} onChange={set('capacity')} /></label>
        <label className="field">Price per seat (₹)<input type="number" required min={0} value={f.price} onChange={set('price')} /></label>
        <label className="field">Host<select value={f.hostId} onChange={set('hostId')}>
          <option value="">None</option>{catalog.hosts.filter((h) => h.active).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
        <label className="field">Repeat<select value={f.repeat} onChange={set('repeat')}>
          <option value="none">Just once</option><option value="day">Every day</option><option value="week">Every week</option></select></label>
        {f.repeat !== 'none' && <label className="field">Extra {f.repeat === 'day' ? 'days' : 'weeks'}<input type="number" min={1} max={30} value={f.repeatCount} onChange={set('repeatCount')} /></label>}
        <label className="check wide"><input type="checkbox" checked={f.allowShortChangeover} onChange={(e) => setF({ ...f, allowShortChangeover: e.target.checked })} />
          Allow less than 30 minutes to change over</label>
      </form>
      {error && <p className="note error"><Icon n="alert" s={16} />{error}</p>}
      <div className="panel" style={{ background: 'var(--sub)', padding: 14, boxShadow: 'none' }}>
        <div className="kicker" style={{ marginBottom: 8 }}>Already on {fmtDay(fromIst(f.date, '00:00'))}</div>
        {dayList.length ? dayList.map((s) => (
          <div key={s.slot.id} className="spread" style={{ padding: '4px 0', fontSize: 12 }}>
            <span><span className="dot" style={cat(s.color)} />{s.activity}</span><span className="num muted">{fmtRange(s.slot.startsAt, s.slot.endsAt)}</span>
          </div>
        )) : <p className="muted" style={{ fontSize: 12 }}>Nothing yet. The whole day is free.</p>}
      </div>
    </Drawer>
  );
}
