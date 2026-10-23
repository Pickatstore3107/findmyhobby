import { useState } from 'react';
import { api, message, useApi } from '../api.ts';
import { can, type Me } from '../roles.ts';
import { fmtDay, fmtRange, fmtTime, istDay, istHours, rupees } from '@fmh/shared/time';
import type { AdminSlot, Booking, Catalog, Payment, Revenue } from '../types.ts';

const FIRST_HOUR = 7, HOURS = 15; // timeline shows 7 AM – 10 PM
const pct = (h: number) => `${(Math.min(Math.max(h - FIRST_HOUR, 0), HOURS) / HOURS) * 100}%`;

export function Today({ me }: { me: Me }) {
  const range = `from=${istDay(0).toISOString()}&to=${istDay(1).toISOString()}`;
  const slots = useApi<AdminSlot[]>(`/admin/slots?${range}`);
  const bookings = useApi<Booking[]>(`/admin/bookings?${range}`);
  const catalog = useApi<Catalog>('/admin/catalog');
  const payments = useApi<Payment[]>(can(me, 'manager') ? '/admin/payments' : null);
  const revenue = useApi<Revenue>(can(me, 'owner') ? `/admin/revenue?${range}` : null);
  const [error, setError] = useState('');

  const now = Date.now();
  const live = (slots.data ?? []).filter((s) => !s.slot.cancelled);
  const booked = live.reduce((n, s) => n + s.slot.bookedSeats, 0), capacity = live.reduce((n, s) => n + s.slot.capacity, 0);
  const active = (bookings.data ?? []).filter((b) => ['confirmed', 'checked_in', 'pending'].includes(b.status));
  const checkedIn = active.filter((b) => b.status === 'checked_in').reduce((n, b) => n + b.seats, 0);
  const arriving = active.filter((b) => +new Date(b.startsAt) > now - 15 * 60e3 && +new Date(b.startsAt) < now + 2 * 3600e3);

  const verify = async (id: number, approve: boolean) => {
    setError('');
    try { await api(`/admin/payments/${id}/verify`, { approve }); payments.reload(); slots.reload(); }
    catch (e) { setError(message(e)); }
  };

  return (
    <>
      <header className="page"><div><div className="kicker">{fmtDay(new Date())}</div><h1>Today</h1></div>
        <div className="row"><a className="btn" href="#/checkin" style={{ lineHeight: '36px', textDecoration: 'none' }}>Check-in</a>
          {can(me, 'manager') && <a className="btn primary" href="#/schedule" style={{ lineHeight: '36px', textDecoration: 'none' }}>New slot +</a>}</div>
      </header>
      {error && <p className="note error">{error}</p>}

      <div className="stats">
        <div className="stat"><div className="kicker">Seats booked</div><div className="v num">{booked}<small> / {capacity}</small></div><div className="muted">{live.length} slots</div></div>
        <div className="stat"><div className="kicker">Checked in</div><div className="v num">{checkedIn}</div><div className="muted">seats</div></div>
        {revenue.data && <div className="stat"><div className="kicker">Collected today</div><div className="v num">{rupees(revenue.data[0]?.net ?? 0)}</div><div className="muted">verified only</div></div>}
        {payments.data && <div className={`stat ${payments.data.length ? 'hot' : ''}`}><div className="kicker">Waiting for you</div><div className="v num">{payments.data.length}</div><div className="muted">payments & refunds</div></div>}
      </div>

      <section style={{ marginTop: 32 }}>
        <h2>Zones today</h2>
        <div className="scroll"><div className="timeline">
          <div className="tl-row"><div className="tl-name" /><div className="tl-hours">
            {Array.from({ length: HOURS }, (_, i) => { const h = FIRST_HOUR + i; return <span key={h}>{h % 12 || 12}{h < 12 ? 'A' : 'P'}</span>; })}
          </div></div>
          {catalog.data?.zones.map((z) => (
            <div className="tl-row" key={z.id}><div className="tl-name">{z.name}</div><div className="tl-lane">
              {live.filter((s) => s.slot.zoneId === z.id).map(({ slot, activity }) => {
                const start = istHours(slot.startsAt), end = start + (+new Date(slot.endsAt) - +new Date(slot.startsAt)) / 3600e3;
                const state = +new Date(slot.endsAt) < now ? 'past' : +new Date(slot.startsAt) <= now ? 'live' : slot.bookedSeats >= slot.capacity ? 'full' : '';
                return (
                  <div key={slot.id} className={`blk ${state}`} style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)} - 3px)` }}
                    title={`${activity} · ${fmtRange(slot.startsAt, slot.endsAt)} · ${slot.bookedSeats}/${slot.capacity}${slot.hostName ? ' · ' + slot.hostName : ''}`}>
                    <b>{activity}</b><span className="num">{slot.bookedSeats}/{slot.capacity}</span>
                  </div>
                );
              })}
            </div></div>
          ))}
          <div className="now" style={{ left: `calc(110px + (100% - 110px) * ${(Math.min(Math.max(istHours(new Date()) - FIRST_HOUR, 0), HOURS) / HOURS)})` }} />
        </div></div>
      </section>

      <section className="grid2" style={{ marginTop: 32 }}>
        {payments.data && <div>
          <h2>Verify payments</h2>
          <div className="scroll"><table><tbody>
            {payments.data.slice(0, 6).map(({ payment: p, name, ref }) => (
              <tr key={p.id}>
                <td><b>{name ?? '—'}</b><div className="muted">{ref} · {p.method.toUpperCase()}{p.utr && <> · UTR <code>{p.utr}</code></>}</div></td>
                <td className="num" style={{ color: p.amount < 0 ? 'var(--accent-700)' : undefined }}><b>{p.amount < 0 ? '−' : ''}{rupees(Math.abs(p.amount))}</b></td>
                <td><div className="row">
                  <button className="btn small dark" onClick={() => verify(p.id, true)}>{p.amount < 0 ? 'Refund sent' : 'Received'}</button>
                  {p.amount > 0 && <button className="btn small" onClick={() => verify(p.id, false)}>Not received</button>}
                </div></td>
              </tr>
            ))}
            {!payments.data.length && <tr><td className="muted">All caught up.</td></tr>}
          </tbody></table></div>
          {payments.data.length > 6 && <p style={{ marginTop: 8 }}><a href="#/payments">All {payments.data.length} →</a></p>}
        </div>}
        <div>
          <h2>Arriving in the next 2 hours</h2>
          <table><tbody>
            {arriving.map((b) => (
              <tr key={b.ref}>
                <td><b>{b.name}</b><div className="muted">{b.activity} · {fmtTime(b.startsAt)} · {b.seats} seat{b.seats > 1 ? 's' : ''} · {b.ref}</div></td>
                <td style={{ textAlign: 'right' }}><span className={`tag ${b.status === 'checked_in' ? 'dark' : b.status === 'pending' ? 'red' : ''}`}>
                  {b.status === 'checked_in' ? 'In' : b.status === 'pending' ? 'Payment pending' : 'Due'}</span></td>
              </tr>
            ))}
            {!arriving.length && <tr><td className="muted">Nobody due in the next 2 hours.</td></tr>}
          </tbody></table>
        </div>
      </section>
    </>
  );
}
