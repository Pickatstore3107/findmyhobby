import { useState } from 'react';
import { api, message, useApi } from '../api.ts';
import { fmtDay, fmtTime, rupees } from '../time.ts';
import type { Payment } from '../types.ts';

const TABS = [['pending', 'To do'], ['verified', 'Done'], ['rejected', 'Rejected']] as const;

export function Payments() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('pending');
  const list = useApi<Payment[]>(`/admin/payments?status=${tab}`);
  const [error, setError] = useState('');

  const verify = async (p: Payment['payment'], approve: boolean) => {
    if (!approve && !confirm('Mark as NOT received? The booking will be cancelled and the seats released.')) return;
    setError('');
    try { await api(`/admin/payments/${p.id}/verify`, { approve }); list.reload(); } catch (e) { setError(message(e)); }
  };

  const kind = (p: Payment['payment']) => p.amount < 0 ? 'Refund to send' : p.method === 'upi' ? 'UPI to verify' : p.method === 'venue' ? 'Collect at desk' : 'Online';

  return (
    <>
      <header className="page"><div><div className="kicker">UPI checks, cash at the desk and refunds</div><h1>Payments</h1></div>
        <div className="row">{TABS.map(([k, l]) => <button key={k} className={`btn ${tab === k ? 'dark' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      </header>
      {tab === 'pending' && <p className="note">For <b>UPI</b>: open your bank or UPI app, find the transaction number (UTR) and amount, then tap <b>Received</b>.
        <b> Cash</b> is marked paid automatically when the member checks in. For <b>refunds</b>: send the money, then tap <b>Refund sent</b>.</p>}
      {error && <p className="note error">{error}</p>}
      {list.error && <p className="note error">{list.error}</p>}
      <div className="scroll"><table>
        <thead><tr><th>Member</th><th>Type</th><th>UTR</th><th>Amount</th><th>Created</th><th /></tr></thead>
        <tbody>{(list.data ?? []).map(({ payment: p, name, phone, ref }) => (
          <tr key={p.id}>
            <td><b>{name ?? 'Tournament entry'}</b><div className="muted">{phone ?? ''}{ref ? ` · ${ref}` : ''}</div></td>
            <td>{kind(p)}</td>
            <td className="num">{p.utr ? <code>{p.utr}</code> : <span className="muted">—</span>}</td>
            <td className="num" style={{ color: p.amount < 0 ? 'var(--accent-700)' : undefined }}><b>{p.amount < 0 ? '−' : ''}{rupees(Math.abs(p.amount))}</b></td>
            <td className="muted num">{fmtDay(p.createdAt)} {fmtTime(p.createdAt)}</td>
            <td style={{ textAlign: 'right' }}>{tab === 'pending' && <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn small dark" onClick={() => verify(p, true)}>{p.amount < 0 ? 'Refund sent' : 'Received'}</button>
              {p.amount > 0 && p.method === 'upi' && <button className="btn small" onClick={() => verify(p, false)}>Not received</button>}
            </div>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      {!list.loading && !list.data?.length && <p className="muted" style={{ marginTop: 12 }}>Nothing here.</p>}
    </>
  );
}
