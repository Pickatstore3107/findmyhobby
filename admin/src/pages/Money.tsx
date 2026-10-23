import { useState } from 'react';
import { downloadCsv, useApi } from '../api.ts';
import { fromIst, istDate, rupees } from '../time.ts';
import type { Revenue } from '../types.ts';

export function Money() {
  const [month, setMonth] = useState(istDate(new Date()).slice(0, 7)); // "2026-10"
  const [y, m] = month.split('-').map(Number);
  const from = fromIst(`${month}-01`, '00:00');
  const to = fromIst(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`, '00:00');
  const data = useApi<Revenue>(`/admin/revenue?from=${from.toISOString()}&to=${to.toISOString()}`);
  const rows = data.data ?? [];
  const total = (k: 'collected' | 'refunded' | 'net') => rows.reduce((n, r) => n + Number(r[k]), 0);

  return (
    <>
      <header className="page"><div><div className="kicker">Verified money only · India time</div><h1>Money</h1></div>
        <div className="row">
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          <button className="btn" disabled={!rows.length} onClick={() => downloadCsv(`money-${month}`, [
            ['Date', 'Collected (₹)', 'Refunded (₹)', 'Net (₹)'], ...rows.map((r) => [r.day, Number(r.collected) / 100, Number(r.refunded) / 100, Number(r.net) / 100]),
            ['Total', total('collected') / 100, total('refunded') / 100, total('net') / 100]])}>Download CSV</button>
        </div>
      </header>
      <div className="stats" style={{ marginBottom: 24 }}>
        <div className="stat"><div className="kicker">Collected</div><div className="v num">{rupees(total('collected'))}</div></div>
        <div className="stat"><div className="kicker">Refunded</div><div className="v num">{rupees(total('refunded'))}</div></div>
        <div className="stat hot"><div className="kicker">Net</div><div className="v num">{rupees(total('net'))}</div></div>
      </div>
      {data.error && <p className="note error">{data.error}</p>}
      <div className="scroll"><table>
        <thead><tr><th>Date</th><th>Collected</th><th>Refunded</th><th>Net</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.day}><td className="num"><b>{new Date(r.day).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</b></td>
            <td className="num">{rupees(r.collected)}</td><td className="num">{rupees(r.refunded)}</td><td className="num"><b>{rupees(r.net)}</b></td></tr>
        ))}</tbody>
      </table></div>
      {!data.loading && !rows.length && <p className="muted" style={{ marginTop: 12 }}>No verified payments this month.</p>}
      <p className="muted" style={{ marginTop: 16 }}>Money counts here once a UPI payment is verified, cash is collected at check-in, or a refund is marked as sent.</p>
    </>
  );
}
