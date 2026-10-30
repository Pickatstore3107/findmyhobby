// Business reports for the admin: occupancy, revenue, attendance and repeat customers.
// Revenue is real money: verified payments minus refunds, not just what was booked.
import { sql } from 'drizzle-orm';
import { db } from './db/index.ts';

const ACTIVE = sql`('confirmed', 'checked_in', 'no_show')`; // bookings that held a seat when the session ran

export async function report(fromDate: Date, toDate: Date) {
  const from = sql`${fromDate.toISOString()}::timestamptz`, to = sql`${toDate.toISOString()}::timestamptz`;
  // One row per session in the range, with its seat and money totals.
  const sessions = sql`
    SELECT s.id, s.activity_id, s.starts_at, s.capacity,
      COALESCE(SUM(b.seats) FILTER (WHERE b.status IN ${ACTIVE}), 0)::int AS booked,
      COALESCE(SUM(b.seats) FILTER (WHERE b.status = 'checked_in'), 0)::int AS attended,
      COALESCE(SUM(b.seats) FILTER (WHERE b.status = 'no_show'), 0)::int AS no_shows,
      COUNT(b.id) FILTER (WHERE b.status = 'cancelled')::int AS cancellations,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p JOIN bookings pb ON pb.id = p.booking_id
        WHERE pb.slot_id = s.id AND p.status = 'verified')::int AS revenue
    FROM slots s LEFT JOIN bookings b ON b.slot_id = s.id
    WHERE NOT s.cancelled AND s.starts_at >= ${from} AND s.starts_at < ${to}
    GROUP BY s.id`;

  const [byActivity, bySession, byHour, [totals]] = await Promise.all([
    db.execute(sql`WITH s AS (${sessions})
      SELECT a.id, a.name AS activity, c.name AS category, COUNT(*)::int AS sessions,
        SUM(s.capacity)::int AS capacity, SUM(s.booked)::int AS booked, SUM(s.attended)::int AS attended,
        SUM(s.no_shows)::int AS no_shows, SUM(s.cancellations)::int AS cancellations, SUM(s.revenue)::int AS revenue
      FROM s JOIN activities a ON a.id = s.activity_id JOIN categories c ON c.id = a.category_id
      GROUP BY a.id, a.name, c.name ORDER BY SUM(s.booked) DESC`),
    db.execute(sql`WITH s AS (${sessions})
      SELECT s.id, a.name AS activity, s.starts_at, s.capacity, s.booked, s.attended, s.no_shows, s.cancellations, s.revenue
      FROM s JOIN activities a ON a.id = s.activity_id ORDER BY s.starts_at`),
    // Peak and dead hours (IST start hour).
    db.execute(sql`WITH s AS (${sessions})
      SELECT EXTRACT(HOUR FROM s.starts_at AT TIME ZONE 'Asia/Kolkata')::int AS hour, COUNT(*)::int AS sessions,
        SUM(s.capacity)::int AS capacity, SUM(s.booked)::int AS booked
      FROM s GROUP BY 1 ORDER BY 1`),
    db.execute(sql`WITH per_member AS (
        SELECT b.user_id, COUNT(*) AS n FROM bookings b JOIN slots s ON s.id = b.slot_id
        WHERE b.status IN ${ACTIVE} AND NOT s.cancelled AND s.starts_at >= ${from} AND s.starts_at < ${to}
        GROUP BY b.user_id)
      SELECT COALESCE(SUM(n), 0)::int AS bookings, COUNT(*)::int AS members, COUNT(*) FILTER (WHERE n >= 2)::int AS repeat_members
      FROM per_member`),
  ]);
  const sum = (k: string) => byActivity.reduce((t, r: any) => t + r[k], 0);
  return {
    totals: {
      ...totals, sessions: sum('sessions'), capacity: sum('capacity'), booked: sum('booked'), attended: sum('attended'),
      noShows: sum('no_shows'), cancellations: sum('cancellations'), revenue: sum('revenue'),
    },
    byActivity, bySession, byHour,
  };
}
