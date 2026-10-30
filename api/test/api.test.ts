import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { client } from '../src/db/index.ts';
import { resetDb } from './reset.ts';

process.env.OWNER_EMAILS = 'owner@fmh.in';
process.env.AUTH_RATE_LIMIT = '100'; // these tests sign many people in within a minute
// Google is replaced by a fake that trusts "google:<email>" tokens; the real check is covered by jose's own tests.
const app = buildApp({
  verifyGoogle: async (t) => {
    if (!t.startsWith('google:')) throw Object.assign(new Error(), { statusCode: 401 });
    const email = t.slice(7);
    return { sub: `sub-${email}`, email, name: email.split('@')[0] };
  },
});

type Opts = { token?: string; body?: unknown };
const call = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, { token, body }: Opts = {}) => {
  const res = await app.inject({ method, url, payload: body as any, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.statusCode, body: res.json() };
};
const loginAs = async (email: string) => (await call('POST', '/auth/google', { body: { idToken: `google:${email}` } })).body.token as string;

let owner = '', member = '', desk = '', slotId = 0, act = 0;
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

beforeAll(async () => {
  await resetDb();
  owner = await loginAs('owner@fmh.in');
  member = await loginAs('aanya@gmail.com');
  desk = await loginAs('desk@fmh.in');
});
afterAll(async () => { await app.close(); await client.end(); });

describe('auth and roles', () => {
  it('owner email becomes owner; others are members', async () => {
    expect((await call('GET', '/me', { token: owner })).body.role).toBe('owner');
    expect((await call('GET', '/me', { token: member })).body.role).toBe('member');
  });

  it('rejects missing, fake and malformed tokens', async () => {
    expect((await call('GET', '/me')).status).toBe(401);
    expect((await call('GET', '/me', { token: 'x'.repeat(43) })).status).toBe(401);
    expect((await call('GET', '/me', { token: "' OR 1=1 --" })).status).toBe(401);
  });

  it('members cannot reach admin; desk cannot touch money', async () => {
    expect((await call('GET', '/admin/payments', { token: member })).status).toBe(403);
    const users = (await call('GET', '/admin/users', { token: owner })).body;
    const deskId = users.find((u: any) => u.email === 'desk@fmh.in').id;
    expect((await call('PATCH', `/admin/users/${deskId}`, { token: owner, body: { role: 'desk' } })).status).toBe(200);
    // A role change signs the person out everywhere; their next sign-in carries the new role.
    expect((await call('GET', '/me', { token: desk })).status).toBe(401);
    desk = await loginAs('desk@fmh.in');
    expect((await call('GET', '/me', { token: desk })).body.role).toBe('desk');
    expect((await call('GET', '/admin/payments', { token: desk })).status).toBe(403);
    expect((await call('GET', '/admin/revenue?from=2026-01-01&to=2026-02-01', { token: desk })).status).toBe(403);
  });

  it('owner cannot demote themselves', async () => {
    const me = (await call('GET', '/me', { token: owner })).body;
    expect((await call('PATCH', `/admin/users/${me.id}`, { token: owner, body: { role: 'member' } })).body.error).toBe('CANNOT_CHANGE_SELF');
  });
});

describe('protections', () => {
  it('the last active owner can never be demoted or blocked', async () => {
    const second = await loginAs('second@fmh.in');
    const list = (await call('GET', '/admin/users', { token: owner })).body;
    const meId = list.find((u: any) => u.email === 'owner@fmh.in').id, secondId = list.find((u: any) => u.email === 'second@fmh.in').id;
    await call('PATCH', `/admin/users/${secondId}`, { token: owner, body: { role: 'owner' } });
    const second2 = await loginAs('second@fmh.in'); // the role change signed them out
    expect((await call('PATCH', `/admin/users/${meId}`, { token: second2, body: { blocked: true } })).status).toBe(200);
    // owner@ is now blocked, so second@ is the last active owner; no one can remove them.
    const third = (await call('GET', '/admin/users', { token: second2 })).body.find((u: any) => u.email === 'second@fmh.in').id;
    expect(third).toBe(secondId);
    expect((await call('PATCH', `/admin/users/${meId}`, { token: second2, body: { blocked: false } })).status).toBe(200);
    owner = await loginAs('owner@fmh.in');
    expect((await call('PATCH', `/admin/users/${secondId}`, { token: owner, body: { role: 'member' } })).status).toBe(200);
    expect(second).toBeTruthy();
  });

  it('OWNER_EMAILS only bootstraps the first owner: a demoted listed owner stays demoted', async () => {
    const list = (await call('GET', '/admin/users', { token: owner })).body;
    expect(list.filter((u: any) => u.role === 'owner').map((u: any) => u.email)).toEqual(['owner@fmh.in']);
  });

  it('the payment page escapes and rebuilds the return link', async () => {
    const evil = encodeURIComponent('findmyhobby://x"><meta http-equiv=refresh content="0;url=https://evil.example">');
    const res = await app.inject({ method: 'GET', url: `/pay/FMH-AAAAAA?return=${evil}` });
    expect(res.body).not.toContain('<meta http-equiv');
    expect(res.body).not.toContain('evil.example');
    expect(res.headers['content-security-policy']).toContain("base-uri 'none'");
  });
});

describe('full flow', () => {
  it('owner sets up catalog and a slot (with weekly repeat and clash report)', async () => {
    const cat = (await call('POST', '/admin/categories', { token: owner, body: { name: 'Move', emoji: '🧘', color: '#9CCBFF', sort: 2 } })).body.id;
    const priya = (await call('POST', '/admin/hosts', { token: owner, body: { name: 'Priya' } })).body.id;
    act = (await call('POST', '/admin/activities', { token: owner, body: {
      name: 'Yoga', categoryId: cat, defaultPrice: 19900, durationMin: 60, defaultHostId: priya, bring: 'Yoga mat' } })).body.id;
    // Price, seats (default 20), length and host come from the activity.
    const res = await call('POST', '/admin/slots', { token: owner, body: { activityId: act, startsAt: inMinutes(10), repeatEvery: 'week', repeatCount: 1 } });
    expect(res.body.created).toHaveLength(2);
    slotId = res.body.created[0];
    const again = await call('POST', '/admin/slots', { token: owner, body: { activityId: act, startsAt: inMinutes(30), repeatCount: 1 } });
    expect(again.body).toMatchObject({ created: [], clashes: [expect.objectContaining({ code: 'SLOT_CLASH', with: expect.objectContaining({ activity: 'Yoga' }) }), expect.anything()] });
  });

  it('member sees the slot, books, and desk checks them in once', async () => {
    const slots = (await call('GET', '/slots')).body;
    expect(slots.find((s: any) => s.id === slotId)).toMatchObject({ activity: 'Yoga', seatsLeft: 20, hostName: 'Priya' });

    expect((await call('POST', '/bookings', { token: member, body: { slotId, seats: 5, method: 'venue', idempotencyKey: 'k-12345678' } })).status).toBe(400);
    const booked = await call('POST', '/bookings', { token: member, body: { slotId, seats: 2, method: 'venue', idempotencyKey: 'k-12345678' } });
    expect(booked.body).toMatchObject({ status: 'confirmed', seats: 2, amount: 39800 });
    expect(booked.body.idempotencyKey).toBeUndefined();

    const today = new Date(Date.now() - 864e5).toISOString(), tomorrow = new Date(Date.now() + 864e5).toISOString();
    const net = async () => Number((await call('GET', `/admin/revenue?from=${today}&to=${tomorrow}`, { token: owner })).body.at(-1)?.net ?? 0);
    const before = await net();
    expect((await call('POST', '/admin/checkin', { token: member, body: { ref: booked.body.ref } })).status).toBe(403);
    expect((await call('POST', '/admin/checkin', { token: desk, body: { ref: booked.body.ref } })).body).toMatchObject({ name: 'aanya', seats: 2 });
    expect((await call('POST', '/admin/checkin', { token: desk, body: { ref: booked.body.ref } })).body.error).toBe('ALREADY_CHECKED_IN');

    expect(await net()).toBe(before + 39800); // cash collected at the desk
  });

  it('attendance shows up in progress, the leaderboard and the reports', async () => {
    const progress = (await call('GET', '/me/progress', { token: member })).body;
    expect(progress).toMatchObject({ points: 10, attended: 1, hobbiesTried: [expect.objectContaining({ activity: 'Yoga' })] });
    expect(progress.achievements.find((x: any) => x.id === 'first').done).toBe(true);
    const board = (await call('GET', '/leaderboard')).body;
    expect(board.find((r: any) => r.name === 'aanya')).toMatchObject({ points: 10, rank: expect.any(Number) });
    expect(board.map((r: any) => r.rank)).toEqual(board.map((_: unknown, i: number) => i + 1));

    const from = new Date(Date.now() - 864e5).toISOString(), to = new Date(Date.now() + 864e5).toISOString();
    expect((await call('GET', `/admin/reports?from=${from}&to=${to}`, { token: desk })).status).toBe(403);
    const r = (await call('GET', `/admin/reports?from=${from}&to=${to}`, { token: owner })).body;
    expect(r.byActivity.find((x: any) => x.activity === 'Yoga')).toMatchObject({ sessions: 1, capacity: 20, booked: 2, attended: 2, revenue: 39800 });
    expect(r.totals).toMatchObject({ bookings: 1, members: 1, repeat_members: 0 });
    const deskId = (await call('GET', '/admin/users', { token: owner })).body.find((u: any) => u.email === 'desk@fmh.in').id;
    await call('PATCH', `/admin/users/${deskId}`, { token: owner, body: { role: 'manager' } });
    const manager = await loginAs('desk@fmh.in');
    const mr = (await call('GET', `/admin/reports?from=${from}&to=${to}`, { token: manager })).body;
    expect(mr.totals.revenue).toBeUndefined();
    expect(mr.byActivity[0].revenue).toBeUndefined();
    await call('PATCH', `/admin/users/${deskId}`, { token: owner, body: { role: 'desk' } });
    desk = await loginAs('desk@fmh.in');

    const memberId = (await call('GET', '/me', { token: member })).body.id;
    await call('POST', `/admin/users/${memberId}/points`, { token: owner, body: { points: 5, note: 'Quiz winner' } });
    expect((await call('GET', `/admin/users/${memberId}`, { token: owner })).body.points.total).toBe(15);
  });

  it('account deletion waits for upcoming bookings, then erases personal data and logs out', async () => {
    const temp = await loginAs('temp@gmail.com');
    const slot = (await call('POST', '/admin/slots', { token: owner, body: { activityId: act, startsAt: inMinutes(200) } })).body.created[0];
    const b = (await call('POST', '/bookings', { token: temp, body: { slotId: slot, seats: 1, method: 'upi', idempotencyKey: 'k-temp-0001' } })).body;
    expect((await call('DELETE', '/me', { token: temp })).body.error).toBe('CANCEL_UPCOMING_BOOKINGS_FIRST');
    expect((await call('POST', `/bookings/${b.ref}/cancel`, { token: temp })).status).toBe(200);
    expect((await call('DELETE', '/me', { token: temp })).status).toBe(200);
    expect((await call('GET', '/me', { token: temp })).status).toBe(401);
  });

  it('admin tournament list counts registered players correctly', async () => {
    const act = (await call('GET', '/catalog')).body.activities[0].id;
    const id = (await call('POST', '/admin/tournaments', { token: owner, body: {
      title: 'Count Cup', activityId: act, startsAt: inMinutes(3000), entryFee: 0, maxPlayers: 8, status: 'open' } })).body.id;
    for (const email of ['p1@x.in', 'p2@x.in', 'p3@x.in']) {
      const t = await loginAs(email);
      expect((await call('POST', `/tournaments/${id}/register`, { token: t })).body.error).toBe('PHONE_REQUIRED');
      await call('PATCH', '/me', { token: t, body: { phone: '9876543210' } });
      expect((await call('POST', `/tournaments/${id}/register`, { token: t })).status).toBe(200);
    }
    const list = (await call('GET', '/admin/tournaments', { token: owner })).body;
    expect(list.find((r: any) => r.tournament.id === id).players).toBe(3);
  });
});
