// Fills the LOCAL database with sample data for development. Refuses to run against anything but localhost.
import { db, pool } from './db/index.ts';
import { activities, categories, users, zones } from './db/schema.ts';
import { bookSlot, createSlot, submitUtr } from './booking.ts';

if (!/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? '')) throw new Error('Seed only runs on a local database');

const IST = 5.5 * 3600e3;
const istMidnight = (dayOffset: number) => new Date(Math.floor((Date.now() + IST) / 864e5) * 864e5 - IST + dayOffset * 864e5);

const [{ n }] = (await pool.query('SELECT COUNT(*) AS n FROM zones'))[0] as any;
if (n > 0) { console.log('Already seeded.'); process.exit(0); }

await db.insert(categories).values([
  { name: 'Play', emoji: '🏆', sort: 1 }, { name: 'Move', emoji: '🧘', sort: 2 }, { name: 'Create', emoji: '🎨', sort: 3 },
  { name: 'Express', emoji: '🎤', sort: 4 }, { name: 'Learn', emoji: '💻', sort: 5 },
]);
await db.insert(zones).values([{ name: 'Zone A · Play' }, { name: 'Zone B · Move' }, { name: 'Zone C · Create' }]);
const [cat] = [await db.select().from(categories)].map((r) => Object.fromEntries(r.map((c) => [c.name, c.id])));
const acts = [
  ['Chess', 'Play', 99, 30], ['Carrom', 'Play', 149, 16], ['Board Games', 'Play', 149, 30], ['Quiz Night', 'Play', 99, 30],
  ['Yoga', 'Move', 199, 20], ['Dance', 'Move', 199, 20], ['Painting', 'Create', 299, 12], ['Calligraphy', 'Create', 249, 12],
  ['AI Class', 'Learn', 399, 15], ['Video Editing', 'Learn', 399, 15],
] as const;
await db.insert(activities).values(acts.map(([name, c, price, cap]) => ({ name, categoryId: cat[c], defaultPrice: price * 100, defaultCapacity: cap })));
const act = Object.fromEntries((await db.select().from(activities)).map((a) => [a.name, a]));
const zone = (await db.select().from(zones)).map((z) => z.id);

await db.insert(users).values([
  { googleSub: 'dev-owner@findmyhobby.local', email: 'owner@findmyhobby.local', name: 'owner', role: 'owner' },
  ...Array.from({ length: 40 }, (_, i) => ({ googleSub: `seed-${i}`, email: `member${i}@example.com`, name: `Member ${i + 1}`, phone: `98${String(i).padStart(8, '0')}` })),
]);
const owner = (await db.select().from(users))[0].id;
const members = (await db.select().from(users)).slice(1).map((u) => u.id);

// [zone index, activity, start hour IST, hours, host]
const day: [number, string, number, number, string?][] = [
  [0, 'Board Games', 14, 2], [0, 'Chess', 18, 1], [0, 'Carrom', 19, 1], [0, 'Quiz Night', 20, 1],
  [1, 'Yoga', 7, 1, 'Priya'], [1, 'Dance', 17, 1, 'Rohan'], [1, 'Yoga', 19, 1, 'Priya'],
  [2, 'AI Class', 14, 1, 'Kiran'], [2, 'Video Editing', 16, 1], [2, 'Painting', 18, 2, 'Meera'],
];
let key = 0;
for (let d = 0; d < 7; d++) {
  for (const [z, name, hour, hours, hostName] of day) {
    const startsAt = new Date(+istMidnight(d) + hour * 3600e3);
    if (startsAt <= new Date()) continue;
    const a = act[name];
    const slotId = await createSlot(owner, { activityId: a.id, zoneId: zone[z], startsAt, endsAt: new Date(+startsAt + hours * 3600e3), price: a.defaultPrice, capacity: a.defaultCapacity, hostName });
    const fill = Math.floor(Math.random() * a.defaultCapacity * 0.9);
    for (const userId of members.slice(0, fill)) {
      const method = Math.random() < 0.5 ? 'upi' : 'venue';
      const b = await bookSlot({ userId, slotId, seats: 1, method, idempotencyKey: `seed-${++key}` }).catch(() => null);
      if (b && method === 'upi') await submitUtr(userId, b.ref, String(4e11 + key)); // UPI payments waiting for verification
    }
  }
}
console.log('Seeded. Sign in to the admin as owner@findmyhobby.local');
await pool.end();
