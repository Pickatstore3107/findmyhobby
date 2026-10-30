import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { client, db } from '../src/db/index.ts';
import { activities, categories, matches, tournaments, users } from '../src/db/schema.ts';
import { generateDraw, getBracket, register, setWinner, unregister } from '../src/tournament.ts';
import { resetDb } from './reset.ts';

let admin = 0, activity = 0, seq = 0;
const newUsers = async (n: number) => {
  const tag = `t${++seq}`;
  await db.insert(users).values(Array.from({ length: n }, (_, i) => ({ googleSub: `${tag}-${i}`, email: `${tag}-${i}@t.in`, name: `P${i + 1}` })));
  return (await db.select({ id: users.id }).from(users)).slice(-n).map((u) => u.id);
};
const newTournament = async (maxPlayers = 30) => {
  const [res] = await db.insert(tournaments).values({ title: `Cup ${++seq}`, activityId: activity, startsAt: new Date('2026-10-25T05:30:00Z'), maxPlayers, status: 'open' }).returning();
  return res.id;
};
const withPlayers = async (n: number) => {
  const id = await newTournament();
  for (const u of await newUsers(n)) await register(u, id);
  return id;
};
const roundOf = async (id: number, round: number) =>
  db.select().from(matches).where(and(eq(matches.tournamentId, id), eq(matches.round, round))).orderBy(matches.position);

beforeAll(async () => {
  await resetDb();
  [admin] = await newUsers(1);
  const [c] = await db.insert(categories).values({ name: 'Tour', emoji: '🏆' }).returning();
  const [a] = await db.insert(activities).values({ name: 'Tour Chess', categoryId: c.id, defaultPrice: 0, defaultCapacity: 30 }).returning();
  activity = a.id;
});
afterAll(() => client.end());

describe('registration', () => {
  it('40 people racing for 30 places: exactly 30 get in', async () => {
    const id = await newTournament(30);
    const results = await Promise.allSettled((await newUsers(40)).map((u) => register(u, id)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(30);
  });

  it('no double registration; no leaving after the draw', async () => {
    const id = await newTournament();
    const [a, b] = await newUsers(2);
    await register(a, id);
    await expect(register(a, id)).rejects.toThrow('ALREADY_REGISTERED');
    await register(b, id);
    await generateDraw(admin, id);
    await expect(unregister(a, id)).rejects.toThrow('REGISTRATION_CLOSED');
  });
});

describe('draw', () => {
  it('30 players → 32-slot bracket with 2 byes in different quarters; everyone appears exactly once', async () => {
    const id = await withPlayers(30);
    await generateDraw(admin, id);
    const r1 = await roundOf(id, 1);
    expect(r1).toHaveLength(16);
    const byes = r1.filter((m) => !m.player2Id);
    expect(byes).toHaveLength(2);
    expect(new Set(byes.map((m) => Math.floor(m.position / 4))).size).toBe(2);
    const seen = r1.flatMap((m) => [m.player1Id, m.player2Id]).filter(Boolean);
    expect(new Set(seen).size).toBe(30);
    const r2 = await roundOf(id, 2);
    for (const b of byes) expect([r2[b.position >> 1].player1Id, r2[b.position >> 1].player2Id]).toContain(b.player1Id);
    expect((await roundOf(id, 5))).toHaveLength(1); // the final
    await expect(generateDraw(admin, id)).rejects.toThrow('DRAW_ALREADY_MADE');
  });

  it.each([2, 3, 5, 16, 17])('%i players builds a valid bracket', async (n) => {
    const id = await withPlayers(n);
    await generateDraw(admin, id);
    const r1 = await roundOf(id, 1);
    expect(r1).toHaveLength(2 ** Math.ceil(Math.log2(n)) / 2);
    expect(r1.every((m) => m.player1Id)).toBe(true); // a bye never meets a bye
  });
});

describe('results', () => {
  it('plays a full 30-player tournament to a single champion', async () => {
    const id = await withPlayers(30);
    await generateDraw(admin, id);
    for (let round = 1; round <= 5; round++)
      for (const m of await roundOf(id, round)) if (m.player2Id) await setWinner(admin, m.id, m.player1Id);
    const { tournament, matches: all } = await getBracket(id);
    expect(tournament.status).toBe('finished');
    expect(all.every((m) => m.winnerId)).toBe(true);
  });

  it('guards: only a player in the match can win; byes are fixed; decided paths are locked', async () => {
    const id = await withPlayers(6); // 8-slot bracket, 2 byes
    await generateDraw(admin, id);
    const r1 = await roundOf(id, 1);
    const bye = r1.find((m) => !m.player2Id)!, real = r1.find((m) => m.player2Id)!;
    await expect(setWinner(admin, bye.id, bye.player1Id)).rejects.toThrow('MATCH_NOT_READY');
    await expect(setWinner(admin, real.id, bye.player1Id)).rejects.toThrow('NOT_IN_MATCH');

    await setWinner(admin, real.id, real.player1Id);
    await setWinner(admin, real.id, real.player2Id); // correcting a mistake is fine…
    const next = (await roundOf(id, 2))[real.position >> 1];
    expect([next.player1Id, next.player2Id]).toContain(real.player2Id);
    expect([next.player1Id, next.player2Id]).not.toContain(real.player1Id);

    for (const m of await roundOf(id, 1)) if (m.player2Id && !m.winnerId) await setWinner(admin, m.id, m.player1Id);
    const decided = (await roundOf(id, 2))[real.position >> 1];
    await setWinner(admin, decided.id, decided.player1Id);
    await expect(setWinner(admin, real.id, null)).rejects.toThrow('NEXT_MATCH_ALREADY_DECIDED'); // …until the next round is played
    await setWinner(admin, decided.id, null);
    await expect(setWinner(admin, real.id, null)).resolves.toBeUndefined(); // undo works backwards, step by step
  });
});
