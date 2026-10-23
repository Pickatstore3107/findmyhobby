import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fmtDay, fmtTime, rupees } from '@fmh/shared/time';
import { useApi } from '@/lib/api';
import { C, F, GUTTER } from '@/lib/theme';
import type { Catalog } from '@/lib/types';
import { T } from '@/components/ui';

export default function Compete() {
  const insets = useSafeAreaInsets();
  const catalog = useApi<Catalog>('/catalog');
  const list = catalog.data?.tournaments ?? [];
  const activity = (id: number) => catalog.data?.activities.find((a) => a.id === id)?.name ?? '';

  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: GUTTER, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={catalog.reload} tintColor={C.accent} />}>
      <T v="display">Compete</T>
      <T style={{ marginTop: 8, marginBottom: 20 }}>Optional. Weekend knockouts for anyone who wants a challenge. Casual slots stay casual.</T>

      {list.map((t) => {
        const left = t.maxPlayers - (t.players ?? 0);
        return (
          <Pressable key={t.id} onPress={() => router.push(`/tournament/${t.id}`)}
            style={({ pressed }) => ({ backgroundColor: C.accent, padding: 18, marginBottom: 14, minHeight: 200, justifyContent: 'space-between', transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <View>
              <T v="kicker" style={{ color: C.accent100 }}>{fmtDay(t.startsAt)} · Knockout · {activity(t.activityId)}</T>
              <Text style={{ fontFamily: F.bold, fontSize: 36, lineHeight: 36, letterSpacing: -1.2, color: C.white, marginTop: 8 }}>{t.title}</Text>
            </View>
            <View style={{ flexDirection: 'row', borderTopWidth: 2, borderColor: 'rgba(255,255,255,0.5)', marginTop: 18, paddingTop: 10 }}>
              {[['Entry', t.entryFee ? rupees(t.entryFee) : 'Free'], ['Starts', fmtTime(t.startsAt)],
                [t.status === 'open' ? 'Places' : 'Status', t.status === 'open' ? `${left} left` : t.status === 'live' ? 'Live now' : 'Draw soon']].map(([k, v]) => (
                <View key={k} style={{ flex: 1 }}>
                  <T v="kicker" style={{ color: C.accent100, fontSize: 10 }}>{k}</T>
                  <Text style={{ fontFamily: F.bold, fontSize: 17, color: C.white }}>{v}</Text>
                </View>
              ))}
            </View>
          </Pressable>
        );
      })}
      {!catalog.loading && !list.length && (
        <View style={{ borderWidth: 2, borderColor: C.ink, padding: 18 }}>
          <T v="title">No tournaments right now.</T>
          <T style={{ marginTop: 4 }}>New weekend knockouts appear here and on your Home screen as soon as the club opens registration.</T>
        </View>
      )}
      <T v="small" style={{ marginTop: 16 }}>Points, badges and leaderboards are coming soon.</T>
    </ScrollView>
  );
}
