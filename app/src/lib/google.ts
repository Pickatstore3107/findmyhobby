import { Platform } from 'react-native';

// Public OAuth client IDs (not secrets). The web client ID makes Google issue an ID token our API can verify.
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

// The native module exists only in real builds (not in Expo Go or the browser preview), so it is loaded lazily.
type GoogleModule = typeof import('@react-native-google-signin/google-signin');
let google: GoogleModule | null | undefined;
function load(): GoogleModule | null {
  if (google !== undefined) return google;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must not crash where the native module is absent
    google = Platform.OS === 'web' ? null : (require('@react-native-google-signin/google-signin') as GoogleModule);
    google?.GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, iosClientId: IOS_CLIENT_ID });
  } catch {
    google = null;
  }
  return google;
}

export const googleAvailable = () => !!WEB_CLIENT_ID && !!load();

/** Opens Google's account picker. Returns an ID token for our API, or null if the user closed the picker. */
export async function googleIdToken(): Promise<string | null> {
  const g = load();
  if (!g) throw new Error('GOOGLE_UNAVAILABLE');
  const { GoogleSignin, isSuccessResponse } = g;
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res = await GoogleSignin.signIn();
  if (!isSuccessResponse(res)) return null;
  return res.data.idToken ?? (await GoogleSignin.getTokens()).idToken;
}

/** Also forget the Google account choice, so the next sign-in shows the picker again. */
export const googleSignOut = () => load()?.GoogleSignin.signOut().catch(() => {});
