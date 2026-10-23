import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, message } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { C, F, GUTTER } from '@/lib/theme';
import { Btn, Note, T } from '@/components/ui';

export default function Login() {
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Development sign-in (the API allows it only on a local test server). Google sign-in replaces it for release.
  const devSignIn = async () => {
    setBusy(true); setError('');
    try { await signIn((await api<{ token: string }>('/auth/dev', { email: email.trim() })).token); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 20 }}>
        <View style={{ height: 440 }}>
          <Image source={require('../../assets/img/welcome.webp')} style={{ flex: 1 }} contentFit="cover" contentPosition="top" />
          <LinearGradient colors={['rgba(243,242,242,0)', C.bg]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 120 }} />
          <View style={{ position: 'absolute', top: insets.top + 18, left: 24, backgroundColor: C.bg, paddingVertical: 6, paddingHorizontal: 10 }}>
            <Text style={{ fontFamily: F.bold, fontSize: 14, color: C.ink }}>FindMyHobby</Text>
          </View>
        </View>

        <View style={{ paddingHorizontal: GUTTER, marginTop: -40, flex: 1 }}>
          <Text style={{ fontFamily: F.bold, fontSize: 52, lineHeight: 50, letterSpacing: -1.8, color: C.ink }}>
            Your hour{'\n'}to <Text style={{ color: C.accent }}>play.</Text>
          </Text>
          <T style={{ fontSize: 15, marginTop: 14, marginBottom: 28 }}>
            Book chess, carrom, dance, painting and more by the hour. Show up, play, and join weekend tournaments.
          </T>

          {__DEV__ ? (
            <>
              <T v="kicker" style={{ marginBottom: 6 }}>Test sign-in (development only)</T>
              <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" autoComplete="email"
                keyboardType="email-address" placeholderTextColor={C.n500} returnKeyType="go" onSubmitEditing={devSignIn}
                style={{ height: 54, borderWidth: 2, borderColor: C.ink, paddingHorizontal: 14, fontFamily: F.semi, fontSize: 16, color: C.ink, backgroundColor: C.white }} />
              {!!error && <Note tone="error">{error}</Note>}
              <Btn label={busy ? 'Signing in…' : 'Continue'} right="→" disabled={busy || !email.includes('@')} onPress={devSignIn} style={{ marginTop: 12 }} />
            </>
          ) : (
            <Btn label="Continue with Google" right="→" disabled />
          )}
          <T v="small" style={{ marginTop: 14 }}>By continuing you agree to the club’s terms and privacy policy.</T>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
