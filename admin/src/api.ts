import { useCallback, useEffect, useState } from 'react';

const TOKEN = 'fmh.token';
export const getToken = () => localStorage.getItem(TOKEN);
export const setToken = (t: string | null) => (t ? localStorage.setItem(TOKEN, t) : localStorage.removeItem(TOKEN));

export class ApiError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

export async function api<T = any>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const token = getToken();
  const res = await fetch('/api' + path, {
    method,
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { setToken(null); location.hash = '#/login'; }
  if (!res.ok) throw new ApiError(data.error ?? 'NETWORK', res.status);
  return data;
}

/** Loads a GET endpoint; pass null to skip (e.g. when the role can't see it). */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: !!path });
  const load = useCallback(() => {
    if (!path) return setState({ loading: false });
    setState((s) => ({ ...s, loading: true }));
    api<T>(path).then((data) => setState({ data, loading: false }), (e) => setState({ error: message(e), loading: false }));
  }, [path]);
  useEffect(load, [load]);
  return { ...state, reload: load };
}

const MESSAGES: Record<string, string> = {
  ZONE_CLASH: 'Another slot already uses this zone at that time.',
  SLOT_IN_PAST: 'The start time is in the past.',
  SLOT_TOO_LONG: 'A slot can be at most 12 hours.',
  INVALID_TIMES: 'The end time must be after the start time.',
  INVALID_INPUT: 'Please check the form. Something is missing or invalid.',
  PAYMENT_NOT_PENDING: 'Someone already handled this payment.',
  FORBIDDEN: 'Your role does not allow this.',
  NETWORK: 'Cannot reach the server. Check your connection.',
  BOOKING_NOT_FOUND: 'No booking with that code.',
  ALREADY_CHECKED_IN: 'Already checked in.',
  BOOKING_NOT_CONFIRMED: 'This booking is not confirmed (payment pending or cancelled).',
  OUTSIDE_CHECKIN_WINDOW: 'Check-in opens 15 minutes before the slot and closes when it ends.',
  NOT_ENOUGH_PLAYERS: 'At least 2 players are needed for a draw.',
  DRAW_ALREADY_MADE: 'The draw has already been made.',
  NEXT_MATCH_ALREADY_DECIDED: 'The next round of this match is already decided. Undo that one first.',
  MATCH_NOT_READY: 'Both players are not known yet for this match.',
  TOURNAMENT_ALREADY_STARTED: 'The tournament has started and can no longer be edited.',
  BELOW_REGISTERED_COUNT: 'More players have already registered than that.',
  CANNOT_CHANGE_SELF: 'You cannot change your own role or block yourself.',
  UPLOADS_NOT_CONFIGURED: 'Photo upload is not set up on this server yet (it is enabled when we deploy to AWS).',
  UNSUPPORTED_IMAGE_TYPE: 'Please use a JPG, PNG or WebP image.',
};
export const message = (e: unknown) => MESSAGES[(e as ApiError)?.code] ?? `Something went wrong (${(e as ApiError)?.code ?? 'unknown'}).`;

/** Downloads rows as a CSV file that opens in Excel or Google Sheets. */
export function downloadCsv(name: string, rows: (string | number | null)[][]) {
  // Cells starting with = + - @ are prefixed with ' so spreadsheets don't run them as formulas.
  const cell = (v: string | number | null) => { const s = String(v ?? ''); return `"${(/^[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`; };
  const blob = new Blob(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${name}.csv` });
  a.click();
  URL.revokeObjectURL(a.href);
}
