import { useEffect, useRef, useState } from 'react';
import { api, message, useApi } from '../api.ts';
import { fmtTime, istDay } from '@fmh/shared/time';
import type { Booking } from '../types.ts';

type Result = { ok: boolean; text: string };
declare const BarcodeDetector: { new (o: { formats: string[] }): { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } } | undefined;
const canScan = typeof BarcodeDetector !== 'undefined';

export function Checkin() {
  const today = useApi<Booking[]>(`/admin/bookings?from=${istDay(0).toISOString()}&to=${istDay(1).toISOString()}`);
  const [code, setCode] = useState('');
  const [q, setQ] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [scanning, setScanning] = useState(false);

  const checkIn = async (raw: string) => {
    const ref = raw.trim().toUpperCase().replace(/^(FMH-?)?/, 'FMH-');
    try {
      const r = await api<{ name: string; seats: number; startsAt: string }>('/admin/checkin', { ref });
      setResult({ ok: true, text: `✓ ${r.name} checked in · ${r.seats} seat${r.seats > 1 ? 's' : ''} · ${fmtTime(r.startsAt)} slot` });
      setCode(''); today.reload();
    } catch (e) { setResult({ ok: false, text: `${ref}: ${message(e)}` }); }
  };

  const needle = q.trim().toLowerCase();
  const rows = (today.data ?? []).filter((b) => ['confirmed', 'checked_in', 'pending'].includes(b.status) &&
    (!needle || [b.name, b.phone, b.ref].some((v) => v?.toLowerCase().includes(needle))));

  return (
    <>
      <header className="page"><div><div className="kicker">Scan the member's QR or type their booking code</div><h1>Check-in</h1></div></header>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (code.trim()) checkIn(code); }}>
        <input placeholder="Booking code, e.g. 4K9P2X" value={code} onChange={(e) => setCode(e.target.value)} style={{ flex: 1, minWidth: 200, textTransform: 'uppercase' }} autoFocus />
        <button className="btn primary">Check in</button>
        {canScan && <button type="button" className="btn" onClick={() => setScanning(!scanning)}>{scanning ? 'Stop camera' : 'Scan QR'}</button>}
      </form>
      {scanning && <Scanner onCode={(c) => { setScanning(false); checkIn(c); }} />}
      {result && <p className={`note ${result.ok ? 'ok' : 'error'}`} style={{ fontSize: 16 }}><b>{result.text}</b></p>}

      <section style={{ marginTop: 28 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}><h2>Today's bookings</h2>
          <input placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} /></div>
        <div className="scroll"><table>
          <tbody>{rows.map((b) => (
            <tr key={b.ref}>
              <td className="num"><b>{fmtTime(b.startsAt)}</b></td>
              <td><b>{b.name}</b><div className="muted">{b.phone ?? ''} · {b.ref}</div></td>
              <td>{b.activity}<div className="muted">{b.seats} seat{b.seats > 1 ? 's' : ''}</div></td>
              <td style={{ textAlign: 'right' }}>{b.status === 'checked_in' ? <span className="tag dark">In</span>
                : b.status === 'pending' ? <span className="tag red">Payment pending</span>
                : <button className="btn small dark" onClick={() => checkIn(b.ref)}>Check in</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        {!today.loading && !rows.length && <p className="muted" style={{ marginTop: 12 }}>No bookings found for today.</p>}
      </section>
    </>
  );
}

/** Reads QR codes with the device camera (Chrome and Android browsers support this natively). */
function Scanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const report = useRef(onCode);
  report.current = onCode;
  const [error, setError] = useState('');
  useEffect(() => {
    let stream: MediaStream | undefined, timer = 0, done = false;
    const detector = new BarcodeDetector!({ formats: ['qr_code'] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then((s) => {
      stream = s;
      video.current!.srcObject = s;
      timer = window.setInterval(async () => {
        const [hit] = await detector.detect(video.current!).catch(() => []);
        if (hit && !done) { done = true; report.current(hit.rawValue); }
      }, 300);
    }, () => setError('Camera blocked. Allow camera access in the browser, or type the code instead.'));
    return () => { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return error ? <p className="note error">{error}</p>
    : <video ref={video} autoPlay playsInline muted style={{ width: '100%', maxWidth: 420, marginTop: 12, border: '2px solid var(--ink)' }} />;
}
