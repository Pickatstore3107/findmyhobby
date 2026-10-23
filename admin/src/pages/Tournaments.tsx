import { useState } from 'react';
import { api, message, useApi } from '../api.ts';
import { can, type Me } from '../roles.ts';
import { fmtDay, fmtTime, fromIst, istDate, rupees } from '../time.ts';
import type { Bracket, Catalog, Match, Tournament } from '../types.ts';

const STATUS: Record<Tournament['status'], string> = { draft: 'Draft (hidden)', open: 'Registration open', closed: 'Registration closed', live: 'Live', finished: 'Finished' };
const blank = { title: '', activityId: '', date: istDate(new Date(Date.now() + 2 * 864e5)), time: '11:00', fee: '0', maxPlayers: '16' };

export function Tournaments({ me }: { me: Me }) {
  const list = useApi<{ tournament: Tournament; players: number }[]>('/admin/tournaments');
  const catalog = useApi<Catalog>('/admin/catalog');
  const [open, setOpen] = useState<number | null>(null);
  const [f, setF] = useState(blank);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { id } = await api<{ id: number }>('/admin/tournaments', {
        title: f.title, activityId: Number(f.activityId), startsAt: fromIst(f.date, f.time),
        entryFee: Math.round(Number(f.fee) * 100), maxPlayers: Number(f.maxPlayers),
      });
      setNote({ ok: true, text: 'Tournament created as a draft. Open registration when you are ready; it then appears as a banner in the app.' });
      setF(blank); list.reload(); setOpen(id);
    } catch (err) { setNote({ ok: false, text: message(err) }); }
  };

  const activity = (id: number) => catalog.data?.activities.find((a) => a.id === id)?.name ?? '';

  return (
    <>
      <header className="page"><div><div className="kicker">Weekend knockouts</div><h1>Tournaments</h1></div></header>
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
          <button className="btn primary">Create</button>
        </form>
        {note && <p className={`note ${note.ok ? 'ok' : 'error'}`}>{note.text}</p>}
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
              <td><span className={`tag ${t.status === 'live' ? 'red' : t.status === 'finished' ? 'dark' : ''}`}>{STATUS[t.status]}</span></td>
              <td style={{ textAlign: 'right' }}><button className="btn small" onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? 'Close' : 'Manage'}</button></td>
            </tr>
          ))}</tbody>
        </table></div>
        {!list.loading && !list.data?.length && <p className="muted" style={{ marginTop: 12 }}>No tournaments yet.</p>}
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
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try { await fn(); onChange(); bracket.reload(); } catch (e) { setError(message(e)); }
  };
  const setStatus = (status: string) => run(() => api(`/admin/tournaments/${t.id}`, { status }, 'PATCH'));
  const draw = () => confirm(`Generate the draw for ${players} players? Registration closes and the bracket is fixed.`) && run(() => api(`/admin/tournaments/${t.id}/draw`, {}));
  const manager = can(me, 'manager');

  return (
    <section style={{ borderTop: '2px solid var(--ink)', paddingTop: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: 26 }}>{t.title}</h2>
        {manager && <div className="row">
          {t.status === 'draft' && <button className="btn primary" onClick={() => setStatus('open')}>Open registration</button>}
          {t.status === 'open' && <button className="btn" onClick={() => setStatus('closed')}>Close registration</button>}
          {t.status === 'closed' && <button className="btn" onClick={() => setStatus('open')}>Reopen registration</button>}
          {(t.status === 'open' || t.status === 'closed') && <button className="btn primary" onClick={draw} disabled={players < 2}>Generate draw</button>}
        </div>}
      </div>
      {error && <p className="note error">{error}</p>}
      {t.status === 'draft' && <p className="note">Draft: members can't see it yet. Open registration to show the banner in the app.</p>}
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
      {final?.winnerId && <p className="note ok" style={{ fontSize: 18 }}>🏆 Champion: <b>{name(final.winnerId)}</b></p>}
      <div className="scroll"><div style={{ display: 'flex', gap: 24, padding: '12px 0', alignItems: 'stretch' }}>
        {Array.from({ length: rounds }, (_, i) => i + 1).map((r) => (
          <div key={r} style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 190 }}>
            <div className="kicker">{label(r)}</div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-around', gap: 10 }}>
            {data.matches.filter((m) => m.round === r).map((m) => {
              const bye = r === 1 && !m.player2Id;
              return (
                <div key={m.id} style={{ border: '2px solid var(--ink)', background: '#fff' }}>
                  {[m.player1Id, m.player2Id].map((p, i) => {
                    const won = !!p && m.winnerId === p, lost = !!m.winnerId && !!p && !won;
                    const clickable = canEdit && !bye && !!m.player1Id && !!m.player2Id && !!p && !won;
                    return (
                      <button key={i} disabled={!clickable} onClick={() => clickable && onPick(m, p)}
                        style={{ display: 'flex', justifyContent: 'space-between', width: '100%', padding: '7px 9px', border: 0, borderTop: i ? '1px solid var(--rule)' : 0,
                          background: won ? 'var(--ink)' : 'transparent', color: won ? '#fff' : undefined, opacity: lost ? 0.4 : 1,
                          fontWeight: won ? 800 : 600, textAlign: 'left', cursor: clickable ? 'pointer' : 'default' }}>
                        <span>{name(p) ?? (bye && i ? 'Bye' : '—')}</span>{won && <span>✓</span>}
                      </button>
                    );
                  })}
                  {canEdit && m.winnerId && !bye && <button className="btn small" style={{ width: '100%', border: 0, borderTop: '1px solid var(--rule)' }} onClick={() => onPick(m, null)}>Undo</button>}
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
