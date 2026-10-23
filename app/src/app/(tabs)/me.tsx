import { useState } from 'react';
import { Alert, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, message, useApi, useNow } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { C, F, GUTTER } from '@/lib/theme';
import type { MyBooking } from '@/lib/types';
import { Btn, Note, T } from '@/components/ui';

export default function Me() {
  const { me, refresh, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const mine = useApi<MyBooking[]>('/bookings');
  const [name, setName] = useState(me?.name ?? '');
  const [phone, setPhone] = useState(me?.phone ?? '');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const now = useNow();
  if (!me) return null;

  const played = (mine.data ?? []).filter((b) => b.status === 'checked_in').length;
  const upcoming = (mine.data ?? []).filter((b) => ['pending', 'confirmed'].includes(b.status) && +new Date(b.endsAt) > now).length;
  const changed = name.trim() !== me.name || phone !== (me.phone ?? '');

  const save = async () => {
    try {
      await api('/me', { name: name.trim(), ...(phone && { phone }) }, 'PATCH');
      await refresh(); setNote({ ok: true, text: 'Saved.' });
    } catch (e) { setNote({ ok: false, text: e && (e as any).code === 'INVALID_INPUT' ? 'Enter a valid 10-digit Indian mobile number.' : message(e) }); }
  };

  const confirmThen = (title: string, body: string, action: string, fn: () => void) =>
    Platform.OS === 'web' ? fn() : Alert.alert(title, body, [{ text: 'Not now', style: 'cancel' }, { text: action, style: 'destructive', onPress: fn }]);

  const deleteAccount = () => confirmThen('Delete your account?', 'Your name, email and phone are erased. This cannot be undone.', 'Delete', async () => {
    try { await api('/me', undefined, 'DELETE'); await signOut(); } catch (e) { setNote({ ok: false, text: message(e) }); }
  });

  const field = { height: 50, borderWidth: 2, borderColor: C.ink, paddingHorizontal: 12, fontFamily: F.semi, fontSize: 16, color: C.ink, backgroundColor: C.white } as const;

  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: GUTTER, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <T v="kicker">Member</T>
          <T v="display" style={{ marginTop: 6 }}>{me.name}</T>
        </View>
        <View style={{ width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: C.ink, backgroundColor: C.illus, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.bold, fontSize: 34, color: C.ink }}>{me.name.slice(0, 1).toUpperCase()}</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', borderTopWidth: 2, borderBottomWidth: 2, borderColor: C.ink, marginTop: 24 }}>
        {[['Slots played', played], ['Upcoming', upcoming]].map(([k, v], i) => (
          <View key={k} style={{ flex: 1, paddingVertical: 14, paddingLeft: i ? 14 : 0, borderLeftWidth: i ? 1 : 0, borderColor: C.divider }}>
            <T v="kicker" style={{ fontSize: 10 }}>{k}</T>
            <Text style={{ fontFamily: F.bold, fontSize: 30, color: i ? C.accent : C.ink }}>{v}</Text>
          </View>
        ))}
      </View>

      <T v="h2" style={{ marginTop: 28, marginBottom: 10 }}>Your details</T>
      <T v="kicker" style={{ marginBottom: 6 }}>Name</T>
      <TextInput value={name} onChangeText={setName} maxLength={100} style={field} />
      <T v="kicker" style={{ marginTop: 14, marginBottom: 6 }}>Mobile number (needed for tournaments)</T>
      <TextInput value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))} keyboardType="phone-pad" placeholder="10-digit number" placeholderTextColor={C.n500} style={field} />
      <T v="small" style={{ marginTop: 6 }}>Signed in as {me.email}</T>
      {note && <Note tone={note.ok ? 'ok' : 'error'}>{note.text}</Note>}
      <Btn label="Save" disabled={!changed || !name.trim()} onPress={save} style={{ marginTop: 14 }} small kind="dark" />

      <View style={{ marginTop: 36, gap: 10 }}>
        <Btn kind="ghost" label="Sign out" onPress={() => confirmThen('Sign out?', '', 'Sign out', signOut)} small />
        <Btn kind="ghost" label="Delete my account" onPress={deleteAccount} small style={{ borderColor: C.accent700 }} />
      </View>
    </ScrollView>
  );
}
