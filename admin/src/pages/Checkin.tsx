import { useEffect, useRef, useState } from 'react';
import { api, message, useApi } from '../api.ts';
import { fmtRange, fmtTime, istDay } from '@fmh/shared/time';
import { Icon } from '../icons.tsx';
import { cat } from '../ui.tsx';
import type { AdminSlot, Booking } from '../types.ts';

type Result = { ok: boolean; text: string; sub?: string };
declare const BarcodeDetector: { new (o: { formats: string[] }): { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } } | undefined;
const canScan = typeof BarcodeDetector !== 'undefined';
const pctOf = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

export function Checkin() {
  const range = `from=${istDay(0).toISOString()}&to=${istDay(1).toISOString()}`;
  const slots = useApi<AdminSlot[]>(`/admin/slots?${range}`);
  const today = useApi<Booking[]>(`/admin/bookings?${range}`);
  const [picked, setPicked] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [scanning, setScanning] = useState(false);

  const now = Date.now();
  const sessions = (slots.data ?? []).filter((s) => !s.slot.cancelled && +new Date(s.slot.endsAt) > now - 30 * 60e3);
  // Default to the session running now, else the next one.
  const current = sessions.find((s) => s.slot.id === picked) ?? sessions.find((s) => +new Date(s.slot.endsAt) > now) ?? sessions[0];

  const checkIn = async (raw: string) => {
    const ref = raw.trim().toUpperCase().replace(/^(FMH-?)?/, 'FMH-');
    try {
      const r = await api<{ name: string; seats: number; startsAt: string }>('/admin/checkin', { ref });
      setResult({ ok: true, text: `${r.name} is checked in`, sub: `${r.seats} seat${r.seats > 1 ? 's' : ''} · ${fmtTime(r.startsAt)} session · ${ref}` });
      setQ(''); today.reload(); slots.reload();
    } catch (e) { setResult({ ok: false, text: message(e), sub: ref }); }
  };

  const needle = q.trim().toLowerCase();
  const attendees = (today.data ?? []).filter((b) => ['confirmed', 'checked_in', 'pending'].includes(b.status) &&
    (needle ? [b.name, b.phone, b.ref].some((v) => v?.toLowerCase().includes(needle)) : b.startsAt === current?.slot.startsAt));
  const inCurrent = (today.data ?? []).filter((b) => b.startsAt === current?.slot.startsAt && ['confirmed', 'checked_in', 'pending'].includes(b.status));
  const arrived = inCurrent.filter((b) => b.status === 'checked_in').reduce((n, b) => n + b.seats, 0);
  const expected = inCurrent.reduce((n, b) => n + b.seats, 0);

  return (
    <>
      <header className="page"><div><h1>Check-in</h1><span className="sub">Scan the member's QR ticket, or search by booking code, name or phone</span></div></header>

      <div className="pills">{sessions.map((s) => {
        const isLive = +new Date(s.slot.startsAt) <= now && +new Date(s.slot.endsAt) > now;
        return (
          <button key={s.slot.id} className={`pill ${s.slot.id === current?.slot.id ? 'on' : ''}`} onClick={() => { setPicked(s.slot.id); setQ(''); }}>
            <b><span className="dot" style={cat(s.color)} />{s.activity} · {fmtTime(s.slot.startsAt)}</b>
            <span>{isLive ? 'Live now' : `in ${Math.max(0, Math.round((+new Date(s.slot.startsAt) - now) / 60e3))} min`} · {s.slot.bookedSeats} booked</span>
          </button>
        );
      })}{!sessions.length && !slots.loading && <p className="muted">No more sessions today.</p>}</div>

      <div className="grid2" style={{ gridTemplateColumns: '1.15fr 1fr' }}>
        <div className="stack">
          <div className="scanner">
            {scanning ? <Scanner onCode={(c) => { setScanning(false); checkIn(c); }} onError={(text) => { setScanning(false); setResult({ ok: false, text }); }} />
              : <div style={{ textAlign: 'center', display: 'grid', gap: 14, justifyItems: 'center', padding: 24 }}>
                <Icon n="camera" s={36} />
                <b style={{ fontSize: 18 }}>{canScan ? 'Scan a QR ticket' : 'Camera scanning needs Chrome or an Android browser'}</b>
                {canScan && <button className="btn primary lg" onClick={() => { setResult(null); setScanning(true); }}>Start camera</button>}
              </div>}
            {scanning && <div className="scan-frame" />}
            {scanning && <button className="btn small" style={{ position: 'absolute', top: 14, right: 14 }} onClick={() => setScanning(false)}>Stop</button>}
            <span className="cap">Point the camera at the member's QR ticket</span>
          </div>
          {result && <div className={`result ${result.ok ? 'ok' : 'error'}`}><Icon n={result.ok ? 'check' : 'alert'} s={22} />
            <div>{result.text}{result.sub && <div style={{ fontSize: 12, fontWeight: 500, opacity: .8 }}>{result.sub}</div>}</div></div>}
        </div>

        <section style={{ marginTop: 0 }}>
          {current && <>
            <div className="kicker"><span className="dot" style={cat(current.color)} />{current.activity} · {fmtRange(current.slot.startsAt, current.slot.endsAt)}</div>
            <div className="row" style={{ alignItems: 'baseline', marginTop: 8 }}>
              <span className="big-count num">{arrived}</span><span className="muted" style={{ fontSize: 16 }}>/ {expected} seats checked in</span>
            </div>
            <div className="meter" style={{ height: 8, color: 'var(--text)' }}><span style={{ width: `${pctOf(arrived, expected)}%` }} /></div>
            <p className="muted" style={{ fontSize: 12, margin: '8px 0 18px' }}>{inCurrent.length} bookings · {inCurrent.filter((b) => b.status === 'pending').length} unpaid · capacity {current.slot.capacity}</p>
          </>}
          <form onSubmit={(e) => { e.preventDefault(); if (/^(FMH-?)?[A-Z0-9]{6}$/i.test(q.trim())) checkIn(q); }}>
            <label className="field">Manual search
              <input placeholder="Booking code (FMH-4K9P2X), name or phone" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></label>
          </form>
          <div className="kicker" style={{ margin: '18px 0 4px' }}>{needle ? 'Matches today' : 'Booked in this session'}</div>
          <table><tbody>{attendees.map((b) => (
            <tr key={b.ref}>
              <td><b>{b.name}</b> <span className="muted">· {b.seats} seat{b.seats > 1 ? 's' : ''}</span>
                <div className="muted" style={{ fontSize: 12 }}>{b.ref} · {b.phone ?? 'no phone'}{needle && ` · ${b.activity} ${fmtTime(b.startsAt)}`}</div></td>
              <td style={{ textAlign: 'right' }}>{b.status === 'checked_in' ? <span className="tag dark">Checked in</span>
                : b.status === 'pending' ? <span className="tag warn">Payment pending</span>
                : <button className="btn small dark" onClick={() => checkIn(b.ref)}>Check in</button>}</td>
            </tr>
          ))}</tbody></table>
          {!attendees.length && !today.loading && <p className="empty">{needle ? 'No booking matches.' : 'No bookings in this session yet.'}</p>}
        </section>
      </div>
    </>
  );
}

/** Reads QR codes with the device camera (Chrome and Android browsers support this natively). */
function Scanner({ onCode, onError }: { onCode: (code: string) => void; onError: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const report = useRef({ onCode, onError });
  report.current = { onCode, onError };
  useEffect(() => {
    let stream: MediaStream | undefined, timer = 0, done = false;
    const detector = new BarcodeDetector!({ formats: ['qr_code'] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then((s) => {
      stream = s;
      video.current!.srcObject = s;
      timer = window.setInterval(async () => {
        const [hit] = await detector.detect(video.current!).catch(() => []);
        if (hit && !done) { done = true; report.current.onCode(hit.rawValue); }
      }, 300);
    }, () => report.current.onError('Camera blocked. Allow camera access in the browser, or type the code instead.'));
    return () => { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return <video ref={video} autoPlay playsInline muted />;
}
