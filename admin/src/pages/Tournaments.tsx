import { useState } from 'react';
import { api, message, useApi } from '../api.ts';
import { can, type Me } from '../roles.ts';
import { fmtDay, fmtTime, fromIst, istDate, rupees } from '@fmh/shared/time';
import type { Bracket, Catalog, Match, Tournament } from '../types.ts';
import { Icon } from '../icons.tsx';
import { ask, toast } from '../ui.tsx';

const STATUS: Record<Tournament['status'], string> = { draft: 'Draft (hidden)', open: 'Registration open', closed: 'Registration closed', live: 'Live', finished: 'Finished' };
const TAG: Record<Tournament['status'], string> = { draft: '', open: 'ok', closed: 'warn', live: 'red', finished: 'dark' };
const blank = { title: '', activityId: '', date: istDate(new Date(Date.now() + 2 * 864e5)), time: '11:00', fee: '0', maxPlayers: '16' };

export function Tournaments({ me }: { me: Me }) {
  const list = useApi<{ tournament: Tournament; players: number }[]>('/admin/tournaments');
  const catalog = useApi<Catalog>('/admin/catalog');
  const [open, setOpen] = useState<number | null>(null);
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { id } = await api<{ id: number }>('/admin/tournaments', {
        title: f.title, activityId: Number(f.activityId), startsAt: fromIst(f.date, f.time),
        entryFee: Math.round(Number(f.fee) * 100), maxPlayers: Number(f.maxPlayers),
      });
      toast('Created as a draft. Open registration to show it in the app.');
      setF(blank); list.reload(); setOpen(id);
    } catch (err) { toast(message(err), true); }
  };

  const activity = (id: number) => catalog.data?.activities.find((a) => a.id === id)?.name ?? '';

  return (
    <>
      <header className="page"><div><h1>Tournaments</h1><span className="sub">Competitions and knockouts on top of regular sessions</span></div></header>
      {can(me, 'manager') && catalog.data && <section>
        <h2>New tournament</h2>
        <form className="form" onSubmit={create}>
          <label className="field">Title<input required maxLength={80} placeholder="Sunday Chess Cup" value={f.title} onChange={set('title')} /></label>
          <label className="field">Activity<select required value={f.activityId} onChange={set('activityId')}>
            <option value="">Choose…</option>{catalog.data.activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="field">Date<input type="date" required min={istDate(new Date())} value={f.date} onChange={set('date')} /></label>
          <label className="field">Start time<input type="time" required value={f.time} onChange={set('time')} /></label>
          <label className="field">Entry fee (₹, 0 = free)<input type="number" min={0} required value={f.fee} onChange={set('fee')} /></label>
          <label className="field">Max players (2–30)<input type="number" min={2} max={30} required value={f.maxPlayers} onChange={set('maxPlayers')} /></label>
          <button className="btn primary"><Icon n="plus" s={15} />Create</button>
        </form>
      </section>}

      <section>
        <h2>All tournaments</h2>
        <div className="scroll"><table>
          <thead><tr><th>When</th><th>Tournament</th><th>Players</th><th>Entry</th><th>Status</th><th /></tr></thead>
          <tbody>{(list.data ?? []).map(({ tournament: t, players }) => (
            <tr key={t.id}>
              <td className="num"><b>{fmtDay(t.startsAt)}</b><div className="muted">{fmtTime(t.startsAt)}</div></td>
              <td><b>{t.title}</b><div className="muted">{activity(t.activityId)}</div></td>
              <td className="num">{players}/{t.maxPlayers}</td>
              <td className="num">{t.entryFee ? rupees(t.entryFee) : 'Free'}</td>
              <td><span className={`tag ${TAG[t.status]}`}>{STATUS[t.status]}</span></td>
              <td style={{ textAlign: 'right' }}><button className="btn small" onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? 'Close' : 'Manage'}</button></td>
            </tr>
          ))}</tbody>
        </table></div>
        {!list.loading && !list.data?.length && <p className="empty">No tournaments yet.</p>}
      </section>

      {open && list.data && (() => {
        const row = list.data.find((r) => r.tournament.id === open);
        return row && <Manage key={open} me={me} t={row.tournament} players={row.players} onChange={list.reload} />;
      })()}
    </>
  );
}

function Manage({ me, t, players, onChange }: { me: Me; t: Tournament; players: number; onChange: () => void }) {
  const bracket = useApi<Bracket>(t.status === 'draft' ? null : `/tournaments/${t.id}`);
  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); onChange(); bracket.reload(); } catch (e) { toast(message(e), true); }
  };
  const setStatus = (status: string) => run(() => api(`/admin/tournaments/${t.id}`, { status }, 'PATCH'));
  const draw = async () => (await ask({ title: 'Generate the draw?', body: `${players} players. Registration closes and the bracket is fixed.`, confirm: 'Generate draw' }))
    && run(() => api(`/admin/tournaments/${t.id}/draw`, {}));
  const manager = can(me, 'manager');

  return (
    <section>
      <div className="spread" style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 30, fontWeight: 900, fontStretch: '62%', textTransform: 'uppercase', lineHeight: .95 }}>{t.title}</h3>
        {manager && <div className="row">
          {t.status === 'draft' && <button className="btn primary" onClick={() => setStatus('open')}>Open registration</button>}
          {t.status === 'open' && <button className="btn" onClick={() => setStatus('closed')}>Close registration</button>}
          {t.status === 'closed' && <button className="btn" onClick={() => setStatus('open')}>Reopen registration</button>}
          {(t.status === 'open' || t.status === 'closed') && <button className="btn primary" onClick={draw} disabled={players < 2}>Generate draw</button>}
        </div>}
      </div>
      {t.status === 'draft' && <p className="note"><Icon n="info" s={16} />Draft: members can't see it yet. Open registration to show the banner in the app.</p>}
      {(t.status === 'open' || t.status === 'closed') && bracket.data && <>
        <p className="muted" style={{ margin: '8px 0' }}>{players} registered of {t.maxPlayers}.</p>
        <p>{bracket.data.players.map((p) => p.name).join(' · ') || <span className="muted">Nobody yet.</span>}</p>
      </>}
      {(t.status === 'live' || t.status === 'finished') && bracket.data &&
        <BracketView data={bracket.data} canEdit={can(me, 'desk')} onPick={(m, winnerId) => run(() => api(`/admin/matches/${m.id}/winner`, { winnerId }))} />}
    </section>
  );
}

/** Left-to-right knockout bracket. Tap a name to make them the winner; losers are dimmed. */
function BracketView({ data, canEdit, onPick }: { data: Bracket; canEdit: boolean; onPick: (m: Match, winnerId: number | null) => void }) {
  const name = (id: number | null) => data.players.find((p) => p.id === id)?.name;
  const rounds = Math.max(...data.matches.map((m) => m.round));
  const label = (r: number) => ['Final', 'Semi-finals', 'Quarter-finals', 'Round of 16', 'Round of 32'][rounds - r] ?? `Round ${r}`;
  const final = data.matches.find((m) => m.round === rounds);
  return (
    <>
      {final?.winnerId && <p className="note ok" style={{ fontSize: 16 }}><Icon n="trophy" s={20} />Champion: <b>{name(final.winnerId)}</b></p>}
      <div className="scroll"><div style={{ display: 'flex', gap: 24, padding: '12px 0', alignItems: 'stretch' }}>
        {Array.from({ length: rounds }, (_, i) => i + 1).map((r) => (
          <div key={r} style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 190 }}>
            <div className="kicker">{label(r)}</div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-around', gap: 10 }}>
            {data.matches.filter((m) => m.round === r).map((m) => {
              const bye = r === 1 && !m.player2Id;
              return (
                <div key={m.id} className="match">
                  {[m.player1Id, m.player2Id].map((p, i) => {
                    const won = !!p && m.winnerId === p, lost = !!m.winnerId && !!p && !won;
                    const clickable = canEdit && !bye && !!m.player1Id && !!m.player2Id && !!p && !won;
                    return (
                      <button key={i} disabled={!clickable} onClick={() => clickable && onPick(m, p)} className={won ? 'won' : lost ? 'lost' : ''}
                        style={{ cursor: clickable ? 'pointer' : 'default' }}>
                        <span>{name(p) ?? (bye && i ? 'Bye' : '—')}</span>{won && <span>✓</span>}
                      </button>
                    );
                  })}
                  {canEdit && m.winnerId && !bye && <button style={{ justifyContent: 'center', color: 'var(--brand-text)', fontSize: 12 }} onClick={() => onPick(m, null)}>Undo</button>}
                </div>
              );
            })}
            </div>
          </div>
        ))}
      </div></div>
    </>
  );
}
