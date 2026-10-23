// Knockout tournaments. Every write locks the tournament row first, so admin clicks and registrations never interleave.
import { randomInt } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db, type Tx } from './db/index.ts';
import { matches, payments, tournamentPlayers, tournaments, users } from './db/schema.ts';
import { AppError, audit, tx } from './booking.ts';

const lockTournament = async (t: Tx, id: number) => {
  const [row] = await t.select().from(tournaments).where(eq(tournaments.id, id)).for('update');
  if (!row) throw new AppError('TOURNAMENT_NOT_FOUND', 404);
  return row;
};

/** Member joins. The entry fee (if any) is collected at the desk on the day. */
export function register(userId: number, tournamentId: number) {
  return tx(async (t) => {
    const tour = await lockTournament(t, tournamentId);
    if (tour.status !== 'open') throw new AppError('REGISTRATION_CLOSED', 409);
    const [{ n }] = await t.select({ n: sql<number>`COUNT(*)` }).from(tournamentPlayers).where(eq(tournamentPlayers.tournamentId, tournamentId));
    if (n >= tour.maxPlayers) throw new AppError('TOURNAMENT_FULL', 409);
    const [res] = await t.insert(tournamentPlayers).values({ tournamentId, userId }).catch((e) => {
      throw (e?.cause ?? e)?.code === 'ER_DUP_ENTRY' ? new AppError('ALREADY_REGISTERED', 409) : e;
    });
    if (tour.entryFee > 0) await t.insert(payments).values({ tournamentPlayerId: res.insertId, method: 'venue', amount: tour.entryFee, status: 'pending' });
    return res.insertId;
  });
}

export function unregister(userId: number, tournamentId: number) {
  return tx(async (t) => {
    const tour = await lockTournament(t, tournamentId);
    if (tour.status !== 'open') throw new AppError('REGISTRATION_CLOSED', 409);
    const [p] = await t.select().from(tournamentPlayers).where(and(eq(tournamentPlayers.tournamentId, tournamentId), eq(tournamentPlayers.userId, userId)));
    if (!p) throw new AppError('NOT_REGISTERED', 404);
    await t.update(payments).set({ status: 'rejected' }).where(and(eq(payments.tournamentPlayerId, p.id), eq(payments.status, 'pending')));
    await t.delete(tournamentPlayers).where(eq(tournamentPlayers.id, p.id));
  });
}

/**
 * Shuffles players into a knockout bracket and creates every match up front, so the app can draw the whole tree.
 * Bracket size is the next power of two; the spare places become byes, spread evenly so no two byes meet.
 */
export function generateDraw(adminId: number, tournamentId: number) {
  return tx(async (t) => {
    const tour = await lockTournament(t, tournamentId);
    if (tour.status !== 'open' && tour.status !== 'closed') throw new AppError('DRAW_ALREADY_MADE', 409);
    const players = (await t.select({ id: tournamentPlayers.id }).from(tournamentPlayers)
      .where(eq(tournamentPlayers.tournamentId, tournamentId))).map((p) => p.id);
    if (players.length < 2) throw new AppError('NOT_ENOUGH_PLAYERS', 409);
    for (let i = players.length - 1; i > 0; i--) { // Fisher–Yates shuffle with a cryptographic random source
      const j = randomInt(i + 1);
      [players[i], players[j]] = [players[j], players[i]];
    }
    const size = 2 ** Math.ceil(Math.log2(players.length)), first = size / 2, byes = size - players.length;
    const byeAt = new Set(Array.from({ length: byes }, (_, k) => Math.floor((k * first) / byes)));
    const rows: (typeof matches.$inferInsert)[] = [];
    for (let pos = 0; pos < first; pos++) {
      const p1 = players.shift()!, p2 = byeAt.has(pos) ? null : players.shift()!;
      rows.push({ tournamentId, round: 1, position: pos, player1Id: p1, player2Id: p2, winnerId: p2 ? null : p1 });
    }
    for (let round = 2, count = first / 2; count >= 1; round++, count /= 2)
      for (let pos = 0; pos < count; pos++) rows.push({ tournamentId, round, position: pos });
    // Bye winners go straight into round 2.
    for (const m of rows.filter((r) => r.round === 1 && r.winnerId)) {
      const next = rows.find((r) => r.round === 2 && r.position === Math.floor(m.position / 2));
      if (next) next[m.position % 2 ? 'player2Id' : 'player1Id'] = m.winnerId;
    }
    await t.insert(matches).values(rows);
    await t.update(tournaments).set({ status: 'live' }).where(eq(tournaments.id, tournamentId));
    await audit(t, adminId, 'tournament.draw', 'tournament', tournamentId, { players: size - byes, byes });
  });
}

/**
 * Admin taps the winner (or null to undo). A result can be changed only while the next match has no result,
 * so a correction can never leave the bracket inconsistent.
 */
export function setWinner(adminId: number, matchId: number, winnerId: number | null) {
  return tx(async (t) => {
    const [m] = await t.select().from(matches).where(eq(matches.id, matchId));
    if (!m) throw new AppError('MATCH_NOT_FOUND', 404);
    const tour = await lockTournament(t, m.tournamentId);
    if (tour.status !== 'live' && tour.status !== 'finished') throw new AppError('TOURNAMENT_NOT_LIVE', 409);
    if (!m.player1Id || !m.player2Id) throw new AppError('MATCH_NOT_READY', 409); // byes and unfilled matches
    if (winnerId !== null && winnerId !== m.player1Id && winnerId !== m.player2Id) throw new AppError('NOT_IN_MATCH');

    const [next] = await t.select().from(matches).where(and(eq(matches.tournamentId, m.tournamentId),
      eq(matches.round, m.round + 1), eq(matches.position, Math.floor(m.position / 2)))).for('update');
    if (next?.winnerId) throw new AppError('NEXT_MATCH_ALREADY_DECIDED', 409);

    await t.update(matches).set({ winnerId }).where(eq(matches.id, m.id));
    if (next) await t.update(matches).set({ [m.position % 2 ? 'player2Id' : 'player1Id']: winnerId }).where(eq(matches.id, next.id));
    // No next match means this was the final.
    await t.update(tournaments).set({ status: next || winnerId === null ? 'live' : 'finished' }).where(eq(tournaments.id, tour.id));
    await audit(t, adminId, winnerId ? 'match.winner' : 'match.undo', 'match', m.id, { winnerId });
  });
}

/** Everything the bracket screen needs: tournament, players with names, and every match. */
export async function getBracket(tournamentId: number) {
  const [tour] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId));
  if (!tour || tour.status === 'draft') throw new AppError('TOURNAMENT_NOT_FOUND', 404);
  const players = await db.select({ id: tournamentPlayers.id, name: users.name }).from(tournamentPlayers)
    .innerJoin(users, eq(users.id, tournamentPlayers.userId)).where(eq(tournamentPlayers.tournamentId, tournamentId))
    .orderBy(asc(tournamentPlayers.id));
  const rounds = await db.select().from(matches).where(eq(matches.tournamentId, tournamentId)).orderBy(asc(matches.round), asc(matches.position));
  return { tournament: tour, players, matches: rounds };
}
