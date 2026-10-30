import { useApi } from '../api.ts';
import { can, type Me } from '../roles.ts';
import { fmtTime, istDay, istHours, rupees } from '@fmh/shared/time';
import { Icon, type IconName } from '../icons.tsx';
import { cat } from '../ui.tsx';
import type { AdminSlot, Booking, Payment, Revenue } from '../types.ts';

const pctOf = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
/** "9a 10 11 12p 1 2": the first label and noon carry am/pm, the rest stay quiet. */
const hourLabel = (h: number, isFirst: boolean) => (h === 12 ? '12p' : isFirst ? `${h % 12 || 12}${h < 12 ? 'a' : 'p'}` : `${h % 12 || 12}`);
const until = (ms: number) => { const m = Math.max(0, Math.round(ms / 60e3)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const greeting = () => { const h = istHours(new Date()); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

type Task = { icon: IconName; tone: string; title: string; detail: string; href: string; action: string };

export function Today({ me }: { me: Me }) {
  const range = `from=${istDay(0).toISOString()}&to=${istDay(1).toISOString()}`;
  const slots = useApi<AdminSlot[]>(`/admin/slots?${range}`);
  const bookings = useApi<Booking[]>(`/admin/bookings?${range}`);
  const payments = useApi<Payment[]>(can(me, 'manager') ? '/admin/payments' : null);
  const revenue = useApi<Revenue>(can(me, 'owner') ? `/admin/revenue?${range}` : null);

  const now = Date.now();
  const live = (slots.data ?? []).filter((s) => !s.slot.cancelled);
  const seats = live.reduce((n, s) => n + s.slot.bookedSeats, 0), capacity = live.reduce((n, s) => n + s.slot.capacity, 0);
  const active = (bookings.data ?? []).filter((b) => ['confirmed', 'checked_in', 'pending'].includes(b.status));
  const of = (s: AdminSlot) => active.filter((b) => b.startsAt === s.slot.startsAt);
  const arrivedIn = (s: AdminSlot) => of(s).filter((b) => b.status === 'checked_in').reduce((n, b) => n + b.seats, 0);
  const started = live.filter((s) => +new Date(s.slot.startsAt) <= now);
  const due = started.reduce((n, s) => n + of(s).reduce((m, b) => m + b.seats, 0), 0);
  const arrived = live.reduce((n, s) => n + arrivedIn(s), 0);
  const next = live.find((s) => +new Date(s.slot.endsAt) > now);

  // What only staff can sort out, most urgent first.
  const pay = payments.data ?? [];
  const upi = pay.filter((p) => p.payment.method === 'upi' && p.payment.amount > 0);
  const refunds = pay.filter((p) => p.payment.amount < 0);
  const sum = (list: Payment[]) => rupees(Math.abs(list.reduce((n, p) => n + p.payment.amount, 0)));
  const filling = live.filter((s) => +new Date(s.slot.startsAt) > now && s.slot.bookedSeats / s.slot.capacity >= 0.8 && s.slot.bookedSeats < s.slot.capacity);
  const unpaidNow = live.filter((s) => +new Date(s.slot.startsAt) <= now + 3600e3 && +new Date(s.slot.endsAt) > now)
    .flatMap((s) => of(s).filter((b) => b.status === 'pending'));
  const tasks: Task[] = [
    ...(upi.length ? [{ icon: 'rupee' as const, tone: 'warn', title: `${upi.length} UPI payment${upi.length > 1 ? 's' : ''} to verify`,
      detail: `Match the UTR numbers in your bank app · ${sum(upi)} in total`, href: '#/payments', action: 'Review payments' }] : []),
    ...(refunds.length ? [{ icon: 'refresh' as const, tone: 'red', title: `${refunds.length} refund${refunds.length > 1 ? 's' : ''} to send`,
      detail: `From cancelled bookings · ${sum(refunds)} in total`, href: '#/payments', action: 'Send refunds' }] : []),
    ...(unpaidNow.length ? [{ icon: 'alert' as const, tone: 'red', title: `${unpaidNow.length} unpaid booking${unpaidNow.length > 1 ? 's' : ''} arriving within the hour`,
      detail: 'Their payment is still pending. Collect or verify it at check-in.', href: '#/checkin', action: 'Open check-in' }] : []),
    ...filling.slice(0, 2).map((s) => ({ icon: 'chart' as const, tone: 'info', title: `${s.activity} at ${fmtTime(s.slot.startsAt)} is almost full`,
      detail: `${s.slot.bookedSeats} of ${s.slot.capacity} seats booked. Consider adding another session.`, href: '#/schedule', action: 'Open schedule' })),
  ];

  // Day strip: from the earlier of now and the first session, to the last session's end.
  const nowH = istHours(new Date());
  const hrs = live.map((s) => [istHours(s.slot.startsAt), istHours(s.slot.endsAt)]);
  const first = hrs.length ? Math.floor(Math.min(nowH, ...hrs.map(([a]) => a))) : 9;
  const last = hrs.length ? Math.max(first + 6, Math.ceil(Math.max(...hrs.map(([, b]) => b)))) : 21;
  const span = last - first, at = (h: number) => `${((Math.min(Math.max(h, first), last) - first) / span) * 100}%`;

  const day = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' });
  const firstName = me.name.split(' ')[0];
  const lede = !live.length ? 'No sessions today.'
    : next ? `${live.length} session${live.length > 1 ? 's' : ''} today · ${+new Date(next.slot.startsAt) <= now ? `${next.activity} is running now` : `next is ${next.activity} at ${fmtTime(next.slot.startsAt)}`}`
    : `${live.length} sessions today · all finished`;

  return (
    <>
      <header className="page">
        <div><h1>{greeting()}, {firstName}</h1><span className="sub">{day} · {lede}</span></div>
        <div className="row">
          <a className="btn" href="#/checkin"><Icon n="scan" s={15} />Check someone in</a>
          {can(me, 'manager') && <a className="btn primary" href="#/schedule?new=1"><Icon n="plus" s={15} />New session</a>}
        </div>
      </header>

      {payments.data && (
        <section className="flush" style={{ marginBottom: 16 }}>
          <div className="ph"><div><h2>Needs your attention</h2><p>{tasks.length ? 'Things only staff can sort out' : 'Nothing waiting. You’re all caught up.'}</p></div></div>
          {tasks.map((t) => (
            <div className="task" key={t.title}>
              <span className={`task-ico ${t.tone}`}><Icon n={t.icon} s={15} /></span>
              <div><b>{t.title}</b><span>{t.detail}</span></div>
              <a className="btn small" href={t.href}>{t.action}</a>
            </div>
          ))}
        </section>
      )}

      <div className="stats">
        <div className="stat"><span className="kicker">Bookings today</span><div className="v num">{active.length}</div>
          <span className="muted">{seats} seats across {live.length} sessions</span></div>
        <div className="stat"><span className="kicker">Seats filled</span><div className="v num">{pctOf(seats, capacity)}%<small>{seats} / {capacity}</small></div>
          <div className="meter"><span style={{ width: `${pctOf(seats, capacity)}%` }} /></div></div>
        <div className="stat"><span className="kicker">Checked in</span><div className="v num">{arrived}<small>of {due} due</small></div>
          <span className="muted">{started.length ? 'Seats in sessions that have started' : next ? `First session starts at ${fmtTime(next.slot.startsAt)}` : 'No sessions today'}</span></div>
        {revenue.data
          ? <div className="stat"><span className="kicker">Collected today</span><div className="v num">{rupees(revenue.data[0]?.net ?? 0)}</div>
              <span className="muted">Verified payments, after refunds</span></div>
          : <div className="stat"><span className="kicker">Unpaid bookings</span><div className="v num">{active.filter((b) => b.status === 'pending').length}</div>
              <span className="muted">Payment still pending today</span></div>}
      </div>

      <section className="flush">
        <div className="ph">
          <div><h2>Today’s sessions</h2><p>The centre runs one session at a time</p></div>
          <a className="btn ghost small" href="#/schedule">Full schedule<Icon n="chev" s={14} /></a>
        </div>
        {live.length > 0 && (
          <div style={{ padding: '14px 16px 6px' }}>
            <div className="hours num" style={{ gridTemplateColumns: `repeat(${span}, 1fr)`, marginBottom: 6 }}>
              {Array.from({ length: span }, (_, i) => <span key={i}>{hourLabel(first + i, i === 0)}</span>)}
            </div>
            <div className="lane" style={{ '--hours': span, height: 30, borderRadius: 6, background: undefined, backgroundColor: 'var(--sub)' } as React.CSSProperties}>
              {live.map((s) => {
                const a = istHours(s.slot.startsAt), b = istHours(s.slot.endsAt);
                return <a key={s.slot.id} href="#/checkin" title={`${s.activity} · ${fmtTime(s.slot.startsAt)}`}
                  style={{ ...cat(s.color), position: 'absolute', top: 5, bottom: 5, left: at(a), width: `calc(${at(b)} - ${at(a)} - 2px)`,
                    borderRadius: 4, background: 'var(--c)', opacity: +new Date(s.slot.endsAt) < now ? 0.35 : 1 }} />;
              })}
              {nowH >= first && nowH <= last && <div className="now" style={{ left: at(nowH) }} />}
            </div>
          </div>
        )}
        {live.length ? (
          <div className="scroll"><table>
            <thead><tr><th>Time</th><th>Activity</th><th>Seats booked</th><th>Arrived</th><th>Status</th><th /></tr></thead>
            <tbody>{live.map((s) => {
              const start = +new Date(s.slot.startsAt), end = +new Date(s.slot.endsAt), list = of(s);
              const unpaid = list.filter((b) => b.status === 'pending').length;
              const status = end <= now ? <span className="tag">Finished</span>
                : start <= now ? <span className="tag red live">Live now</span>
                : s.slot.closed ? <span className="tag warn">Closed to bookings</span>
                : s.slot.bookedSeats >= s.slot.capacity ? <span className="tag dark">Full</span>
                : start - now < 2 * 3600e3 ? <span className="tag info">Starts in {until(start - now)}</span>
                : <span className="tag">Upcoming</span>;
              return (
                <tr key={s.slot.id}>
                  <td className="num" style={{ whiteSpace: 'nowrap', width: 1 }}><b>{fmtTime(s.slot.startsAt)}</b>
                    <span className="sub2">{Math.round((end - start) / 60e3)} min</span></td>
                  <td><b>{s.activity}</b><span className="sub2"><span className="tag cat" style={cat(s.color)}>{s.hostName ? `with ${s.hostName}` : 'No host'}</span></span></td>
                  <td><div className="seats num" style={cat(s.color)}><div className="meter"><span style={{ width: `${pctOf(s.slot.bookedSeats, s.slot.capacity)}%` }} /></div>
                    {s.slot.bookedSeats} / {s.slot.capacity}</div>{unpaid > 0 && <span className="sub2" style={{ color: 'var(--warn)' }}>{unpaid} unpaid</span>}</td>
                  <td className="num">{start <= now ? `${arrivedIn(s)} / ${list.reduce((n, b) => n + b.seats, 0)}` : <span className="muted">—</span>}</td>
                  <td>{status}</td>
                  <td className="right">{end > now && <a className="btn small" href="#/checkin">Check in</a>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : !slots.loading && <p className="empty">No sessions today. {can(me, 'manager') && <a href="#/schedule?new=1" style={{ color: 'var(--brand-text)' }}>Schedule one</a>}</p>}
      </section>
    </>
  );
}
