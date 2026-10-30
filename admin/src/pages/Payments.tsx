import { useState } from 'react';
import { api, message, useApi } from '../api.ts';
import { fmtDay, fmtTime, rupees } from '@fmh/shared/time';
import type { Payment } from '../types.ts';
import { Icon } from '../icons.tsx';
import { ask, toast } from '../ui.tsx';

const TABS = [['pending', 'To do'], ['verified', 'Done'], ['rejected', 'Rejected']] as const;

export function Payments() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('pending');
  const list = useApi<Payment[]>(`/admin/payments?status=${tab}`);
  const verify = async (p: Payment['payment'], approve: boolean) => {
    if (!approve && !(await ask({ title: 'Not received?', body: 'The booking will be cancelled and its seats released for others to book.', confirm: 'Mark not received', danger: true }))) return;
    try { await api(`/admin/payments/${p.id}/verify`, { approve }); toast(approve ? (p.amount < 0 ? 'Refund marked as sent.' : 'Payment marked received.') : 'Booking cancelled.'); list.reload(); }
    catch (e) { toast(message(e), true); }
  };

  const kind = (p: Payment['payment']) => p.amount < 0 ? 'Refund to send' : p.method === 'upi' ? 'UPI to verify' : p.method === 'venue' ? 'Collect at desk' : 'Online';

  return (
    <>
      <header className="page"><div><h1>Payments</h1><span className="sub">UPI checks, cash at the desk and refunds</span></div>
        <div className="seg">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      </header>
      {tab === 'pending' && <p className="note"><Icon n="info" s={16} /><span>For <b>UPI</b>: open your bank or UPI app, find the transaction number (UTR) and amount, then tap <b>Received</b>.
        <b> Cash</b> is marked paid automatically when the member checks in. For <b>refunds</b>: send the money, then tap <b>Refund sent</b>.</span></p>}
      {list.error && <p className="note error">{list.error}</p>}
      <section><div className="scroll"><table>
        <thead><tr><th>Member</th><th>Type</th><th>UTR</th><th>Amount</th><th>Created</th><th /></tr></thead>
        <tbody>{(list.data ?? []).map(({ payment: p, name, phone, ref }) => (
          <tr key={p.id}>
            <td><b>{name ?? 'Tournament entry'}</b><div className="muted">{phone ?? ''}{ref ? ` · ${ref}` : ''}</div></td>
            <td><span className={`tag ${p.amount < 0 ? 'red' : p.method === 'upi' ? 'warn' : ''}`}>{kind(p)}</span></td>
            <td className="num">{p.utr ? <code>{p.utr}</code> : <span className="muted">—</span>}</td>
            <td className="num" style={{ color: p.amount < 0 ? 'var(--brand-text)' : undefined }}><b>{p.amount < 0 ? '−' : ''}{rupees(Math.abs(p.amount))}</b></td>
            <td className="muted num">{fmtDay(p.createdAt)} {fmtTime(p.createdAt)}</td>
            <td style={{ textAlign: 'right' }}>{tab === 'pending' && <div className="row" style={{ justifyContent: 'flex-end' }}>
              {p.method === 'gateway' && p.amount > 0 ? <span className="tag info">Confirmed automatically</span>
                : <button className="btn small dark" onClick={() => verify(p, true)}>{p.amount < 0 ? 'Refund sent' : 'Received'}</button>}
              {p.amount > 0 && p.method === 'upi' && <button className="btn small ghost" onClick={() => verify(p, false)}>Not received</button>}
            </div>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      {!list.loading && !list.data?.length && <p className="empty">{tab === 'pending' ? 'All caught up. Nothing waiting.' : 'Nothing here.'}</p>}
      </section>
    </>
  );
}
