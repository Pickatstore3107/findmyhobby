import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import Constants from 'expo-constants';

// Production uses EXPO_PUBLIC_API_URL. In development the API runs on the same computer as Expo,
// so we reuse Expo's host address; that way a real phone on the same Wi-Fi can reach it too.
const devHost = Constants.expoConfig?.hostUri?.split(':')[0];
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? `http://${devHost ?? '127.0.0.1'}:4000`;

let token: string | null = null;
export const setApiToken = (t: string | null) => { token = t; };

export class ApiError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

export async function api<T = any>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { throw new ApiError('NETWORK', 0); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? 'UNKNOWN', res.status);
  return data;
}

/** Loads a GET endpoint (pass null to skip) and reloads whenever the screen comes back into view. */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: !!path });
  const reload = useCallback(async () => {
    if (!path) return setState({ loading: false });
    setState((s) => ({ ...s, loading: true }));
    try { setState({ data: await api<T>(path), loading: false }); } catch (e) { setState((s) => ({ ...s, error: message(e), loading: false })); }
  }, [path]);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  return { ...state, reload };
}

/** Current time, refreshed every `ms` milliseconds, so screens re-render as time passes. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

const MESSAGES: Record<string, string> = {
  NETWORK: "Can't reach FindMyHobby. Check your internet and try again.",
  NOT_ENOUGH_SEATS: 'Not enough seats left in this slot. Try fewer seats or another time.',
  SLOT_NOT_BOOKABLE: 'This slot can no longer be booked.',
  ALREADY_BOOKED: 'You already have a booking for this slot.',
  HOLD_EXPIRED: 'The 10 minutes to pay ran out, so the seat was released. Please book again.',
  UTR_ALREADY_USED: 'That UPI reference was already used. Check the 12-digit number in your UPI app.',
  INVALID_UTR: 'The UPI reference (UTR) is the 12-digit number in your UPI app.',
  CANCEL_WINDOW_CLOSED: 'Slots can be cancelled up to 2 hours before they start.',
  BOOKING_NOT_CANCELLABLE: 'This booking can no longer be cancelled.',
  REGISTRATION_CLOSED: 'Registration for this tournament is closed.',
  TOURNAMENT_FULL: 'This tournament is full.',
  ALREADY_REGISTERED: "You're already registered.",
  PHONE_REQUIRED: 'Add your phone number in Me before joining a tournament.',
  CANCEL_UPCOMING_BOOKINGS_FIRST: 'Cancel your upcoming bookings first, then delete your account.',
  ACCOUNT_BLOCKED: 'This account has been blocked. Please contact the club.',
  INVALID_INPUT: 'Please check what you entered.',
  INVALID_GOOGLE_TOKEN: 'Google sign-in could not be verified. Please try again.',
  GOOGLE_UNAVAILABLE: 'Google sign-in is not available in this version of the app.',
};
export const message = (e: unknown) => MESSAGES[(e as ApiError)?.code] ?? 'Something went wrong. Please try again.';
