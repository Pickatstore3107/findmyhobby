import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { api, setApiToken } from './api';

// The login token is kept in the phone's secure keychain (Keychain on iOS, Keystore on Android), never in plain storage.
const KEY = 'fmh.session';
const store = Platform.OS === 'web'
  ? { get: async () => localStorage.getItem(KEY), set: async (v: string) => localStorage.setItem(KEY, v), del: async () => localStorage.removeItem(KEY) }
  : { get: () => SecureStore.getItemAsync(KEY), set: (v: string) => SecureStore.setItemAsync(KEY, v), del: () => SecureStore.deleteItemAsync(KEY) };

export type Me = { id: number; name: string; email: string; phone: string | null; role: string };
type Auth = { me: Me | null; ready: boolean; signIn: (token: string) => Promise<void>; signOut: () => Promise<void>; refresh: () => Promise<void> };

const Ctx = createContext<Auth>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => setMe(await api<Me>('/me')), []);

  const signIn = useCallback(async (token: string) => {
    setApiToken(token);
    await store.set(token);
    await refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await api('/auth/logout', {}).catch(() => {});
    setApiToken(null);
    await store.del();
    setMe(null);
  }, []);

  useEffect(() => {
    (async () => {
      const token = await store.get();
      if (token) {
        setApiToken(token);
        // An expired or revoked session simply sends the user back to sign-in.
        await refresh().catch(async () => { setApiToken(null); await store.del(); });
      }
      setReady(true);
    })();
  }, [refresh]);

  return <Ctx.Provider value={{ me, ready, signIn, signOut, refresh }}>{children}</Ctx.Provider>;
}
