import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fmtDay, fmtRange, rupees } from '@fmh/shared/time';
import { useApi, useNow } from '@/lib/api';
import { mascot, PANDA } from '@/lib/mascots';
import { C, F, GUTTER } from '@/lib/theme';
import type { MyBooking } from '@/lib/types';
import { Btn, Rule, T } from '@/components/ui';

const LABEL: Record<MyBooking['status'], string> = {
  pending: 'Payment pending', confirmed: 'Confirmed', checked_in: 'Attended', cancelled: 'Cancelled', no_show: 'Missed', expired: 'Not paid',
};

export default function Bookings() {
  const insets = useSafeAreaInsets();
  const mine = useApi<MyBooking[]>('/bookings');
  const now = useNow();
  const upcoming = (mine.data ?? []).filter((b) => ['pending', 'confirmed'].includes(b.status) && +new Date(b.endsAt) > now).reverse();
  const past = (mine.data ?? []).filter((b) => !upcoming.includes(b));

  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: GUTTER, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={mine.reload} tintColor={C.accent} />}>
      <T v="display">Bookings</T>

      <T v="kicker" style={{ marginTop: 24, marginBottom: 8 }}>Upcoming</T>
      {upcoming.map((b) => (
        <Pressable key={b.ref} onPress={() => router.push(`/ticket/${b.ref}`)}
          style={({ pressed }) => ({ flexDirection: 'row', backgroundColor: C.white, borderWidth: 2, borderColor: C.ink, marginBottom: 10, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <View style={{ flex: 1, padding: 14, gap: 2 }}>
            <T v="kicker" style={{ color: b.status === 'pending' ? C.accent700 : C.n600 }}>{fmtDay(b.startsAt)} · {LABEL[b.status]}</T>
            <Text style={{ fontFamily: F.bold, fontSize: 20, color: C.ink }}>{b.activity}</Text>
            <T>{fmtRange(b.startsAt, b.endsAt)} · {b.seats} seat{b.seats > 1 ? 's' : ''} · {b.zone}</T>
            <T v="small" style={{ color: C.accent700, fontFamily: F.bold, marginTop: 6 }}>Show ticket →</T>
          </View>
          <View style={{ width: 96, backgroundColor: C.illus, borderLeftWidth: 2, borderColor: C.ink, overflow: 'hidden' }}>
            <Image source={mascot({ id: b.activityId, name: b.activity })} style={{ position: 'absolute', bottom: 0, left: 0, width: 96, height: 110 }} contentFit="cover" />
          </View>
        </Pressable>
      ))}
      {!mine.loading && !upcoming.length && (
        <View style={{ backgroundColor: C.illus, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 10 }}>
            <T v="title">No slots booked. Your next hour is a tap away.</T>
            <Btn small label="Find a slot" right="→" onPress={() => router.navigate('/')} />
          </View>
          <Image source={PANDA} style={{ width: 90, height: 94 }} contentFit="cover" />
        </View>
      )}

      {past.length > 0 && <>
        <T v="kicker" style={{ marginTop: 28, marginBottom: 8 }}>Past</T>
        <Rule thick />
        {past.map((b) => (
          <Pressable key={b.ref} onPress={() => router.push(`/ticket/${b.ref}`)}
            style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderColor: C.divider }}>
            <View><T v="title">{b.activity}</T><T v="small">{fmtDay(b.startsAt)} · {fmtRange(b.startsAt, b.endsAt)}</T></View>
            <View style={{ alignItems: 'flex-end' }}>
              <T v="small" style={{ fontFamily: F.bold, color: b.status === 'checked_in' ? C.accent700 : C.n500 }}>{LABEL[b.status]}</T>
              <T v="small">{rupees(b.amount)}</T>
            </View>
          </Pressable>
        ))}
      </>}
    </ScrollView>
  );
}
