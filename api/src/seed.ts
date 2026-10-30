// Fills the LOCAL database with sample data for development. Refuses to run against anything but localhost.
import { client, db } from './db/index.ts';
import { activities, categories, hosts, users } from './db/schema.ts';
import { bookSlot, createSlot, submitUtr } from './booking.ts';

if (!/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? '')) throw new Error('Seed only runs on a local database');

const IST = 5.5 * 3600e3;
const istMidnight = (dayOffset: number) => new Date(Math.floor((Date.now() + IST) / 864e5) * 864e5 - IST + dayOffset * 864e5);

if ((await db.select().from(activities)).length > 0) { console.log('Already seeded.'); process.exit(0); }

// The four categories also come from a migration; insert them here only if that migration did not.
await db.insert(categories).values([
  { name: 'Play', emoji: '♟️', color: '#FFD45C', sort: 1 }, { name: 'Move', emoji: '🧘', color: '#9CCBFF', sort: 2 },
  { name: 'Create', emoji: '🎨', color: '#F7B8DD', sort: 3 }, { name: 'Learn', emoji: '💡', color: '#BDEB9A', sort: 4 },
]).onConflictDoNothing();
const [cat] = [await db.select().from(categories)].map((r) => Object.fromEntries(r.map((c) => [c.name, c.id])));
await db.insert(hosts).values([{ name: 'Priya' }, { name: 'Rohan' }, { name: 'Meera' }, { name: 'Kiran' }]);
const host = Object.fromEntries((await db.select().from(hosts)).map((h) => [h.name, h.id]));
const acts = [
  ['Chess', 'Play', 99, 'Beginner'], ['Board Games & Carrom', 'Play', 149, 'All levels'], ['Quiz & Challenges', 'Play', 99, 'All levels'],
  ['Yoga', 'Move', 199, 'All levels', 'Priya'], ['Dance / Zumba', 'Move', 199, 'All levels', 'Rohan'],
  ['Painting / Art', 'Create', 299, 'Beginner', 'Meera'], ['Calligraphy', 'Create', 249, 'Beginner', 'Meera'],
  ['AI Basics', 'Learn', 399, 'Beginner', 'Kiran'],
] as const;
await db.insert(activities).values(acts.map(([name, c, price, level, h]) => ({
  name, categoryId: cat[c], defaultPrice: price * 100, level, defaultHostId: h ? host[h] : null,
  about: `A friendly ${name.toLowerCase()} session at the FindMyHobby centre.`, bring: 'Water bottle',
})));
const act = Object.fromEntries((await db.select().from(activities)).map((a) => [a.name, a]));

await db.insert(users).values([
  { googleSub: 'dev-owner@findmyhobby.local', email: 'owner@findmyhobby.local', name: 'owner', role: 'owner' },
  ...Array.from({ length: 40 }, (_, i) => ({ googleSub: `seed-${i}`, email: `member${i}@example.com`, name: `Member ${i + 1}`, phone: `98${String(i).padStart(8, '0')}` })),
]);
const owner = (await db.select().from(users))[0].id;
const members = (await db.select().from(users)).slice(1).map((u) => u.id);

// The brief's example timetable: [activity, start hour IST]. One session at a time, 30 minutes to change over.
const day: [string, number][] = [
  ['Yoga', 7], ['Painting / Art', 10], ['Chess', 11.5], ['AI Basics', 14], ['Calligraphy', 15.5],
  ['Dance / Zumba', 17], ['Board Games & Carrom', 18.5], ['Quiz & Challenges', 20],
];
let key = 0;
for (let d = 0; d < 7; d++) {
  for (const [name, hour] of day) {
    const startsAt = new Date(+istMidnight(d) + hour * 3600e3);
    if (startsAt <= new Date()) continue;
    const a = act[name];
    const slotId = await createSlot(owner, { activityId: a.id, startsAt, endsAt: new Date(+startsAt + a.durationMin * 60e3), price: a.defaultPrice, capacity: a.defaultCapacity, hostId: a.defaultHostId });
    const fill = Math.floor(Math.random() * a.defaultCapacity * 0.9);
    for (const userId of members.slice(0, fill)) {
      const method = Math.random() < 0.5 ? 'upi' : 'venue';
      const b = await bookSlot({ userId, slotId, seats: 1, method, idempotencyKey: `seed-${++key}` }).catch(() => null);
      if (b && method === 'upi') await submitUtr(userId, b.ref, String(4e11 + key)); // UPI payments waiting for verification
    }
  }
}
console.log('Seeded. Sign in to the admin as owner@findmyhobby.local');
await client.end();
