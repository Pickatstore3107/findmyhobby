// Google sign-in → our own session token. The app sends the token as "Authorization: Bearer <token>".
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt, ne } from 'drizzle-orm';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FastifyRequest } from 'fastify';
import { db } from './db/index.ts';
import { auditLog, sessions, users } from './db/schema.ts';
import { AppError } from './booking.ts';

export type GoogleProfile = { sub: string; email: string; name: string };
export type User = typeof users.$inferSelect;

const MEMBER_SESSION_MS = 30 * 864e5;
const STAFF_SESSION_MS = 12 * 3600e3; // staff sign in again every shift
const ROLE_LEVEL = { member: 0, desk: 1, manager: 2, owner: 3 } as const;
export type Role = keyof typeof ROLE_LEVEL;

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

/** Checks the Google ID token's signature, issuer, audience (our client IDs) and expiry. */
export async function verifyGoogle(idToken: string): Promise<GoogleProfile> {
  const { payload } = await jwtVerify(idToken, googleKeys, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: (process.env.GOOGLE_CLIENT_IDS ?? '').split(',').filter(Boolean),
  }).catch(() => { throw new AppError('INVALID_GOOGLE_TOKEN', 401); });
  if (!payload.sub || !payload.email || payload.email_verified !== true) throw new AppError('INVALID_GOOGLE_TOKEN', 401);
  return { sub: payload.sub, email: String(payload.email), name: String(payload.name ?? payload.email).slice(0, 100) };
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Finds or creates the user and starts a session. OWNER_EMAILS only bootstraps the very first owner:
 * once any owner exists it is ignored, so demoting or blocking an owner always sticks.
 */
export async function login(profile: GoogleProfile, ip?: string) {
  const owners = (process.env.OWNER_EMAILS ?? '').toLowerCase().split(',').filter(Boolean);
  await db.insert(users).values({ googleSub: profile.sub, email: profile.email, name: profile.name })
    .onConflictDoUpdate({ target: users.googleSub, set: { email: profile.email } });
  const [user] = await db.select().from(users).where(eq(users.googleSub, profile.sub));
  if (user.blocked) throw new AppError('ACCOUNT_BLOCKED', 403);
  if (owners.includes(user.email.toLowerCase()) && user.role !== 'owner') {
    const [anyOwner] = await db.select({ id: users.id }).from(users).where(and(eq(users.role, 'owner'), ne(users.id, user.id))).limit(1);
    if (!anyOwner) {
      await db.update(users).set({ role: 'owner' }).where(eq(users.id, user.id));
      user.role = 'owner';
    }
  }
  const staff = user.role !== 'member';
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({ tokenHash: hash(token), userId: user.id, expiresAt: new Date(Date.now() + (staff ? STAFF_SESSION_MS : MEMBER_SESSION_MS)) });
  if (staff) await db.insert(auditLog).values({ actorId: user.id, action: 'auth.login', entity: 'user', entityId: user.id, data: { ip } });
  return { token, user };
}

export const logout = (token: string) => db.delete(sessions).where(eq(sessions.tokenHash, hash(token)));

/** Signs a user out everywhere, e.g. when they are blocked or their role changes. */
export const revokeSessions = (userId: number) => db.delete(sessions).where(eq(sessions.userId, userId));

/** Removes expired session rows. Runs hourly on the server. */
export const purgeSessions = (now = new Date()) => db.delete(sessions).where(lt(sessions.expiresAt, now));

export const bearer = (req: FastifyRequest) => req.headers.authorization?.match(/^Bearer ([\w-]{20,100})$/)?.[1];

/** Returns the signed-in user, or throws 401/403. Checked on every request, so blocking a user takes effect immediately. */
export async function requireUser(req: FastifyRequest, minRole: Role = 'member'): Promise<User> {
  const token = bearer(req);
  if (!token) throw new AppError('UNAUTHORIZED', 401);
  const [row] = await db.select({ user: users }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hash(token)), gt(sessions.expiresAt, new Date())));
  if (!row) throw new AppError('UNAUTHORIZED', 401);
  if (row.user.blocked) throw new AppError('ACCOUNT_BLOCKED', 403);
  if (ROLE_LEVEL[row.user.role] < ROLE_LEVEL[minRole]) throw new AppError('FORBIDDEN', 403);
  return row.user;
}

