import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { fmtDay, fmtRange, fmtTime, istDate, rupees } from '@fmh/shared/time';
import { useApi, useNow } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { mascot } from '@/lib/mascots';
import { C, F, GUTTER } from '@/lib/theme';
import type { Catalog, MyBooking, Slot, Tournament } from '@/lib/types';
import { Rule, T } from '@/components/ui';

export default function Home() {
  const { me } = useAuth();
  const insets = useSafeAreaInsets();
  const tile = (useWindowDimensions().width - 4) / 3; // 3 columns with two 2px gaps
  const catalog = useApi<Catalog>('/catalog');
  const slots = useApi<Slot[]>('/slots');
  const mine = useApi<MyBooking[]>('/bookings');
  const [category, setCategory] = useState<number | null>(null);
  const reloadAll = () => { catalog.reload(); slots.reload(); mine.reload(); };

  const now = useNow();
  const upNext = (mine.data ?? []).filter((b) => ['confirmed', 'pending'].includes(b.status) && +new Date(b.endsAt) > now)
    .sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt))[0];
  // Cheapest upcoming price per activity, so tiles say "from ₹99".
  const fromPrice = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of slots.data ?? []) m.set(s.activityId, Math.min(m.get(s.activityId) ?? Infinity, s.price));
    return m;
  }, [slots.data]);
  const activities = (catalog.data?.activities ?? []).filter((a) => !category || a.categoryId === category);
  const nextDay = slots.data?.[0] && istDate(slots.data[0].startsAt);
  const soon = (slots.data ?? []).filter((s) => istDate(s.startsAt) === nextDay).slice(0, 8);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={reloadAll} tintColor={C.accent} />}>
      <View style={{ paddingHorizontal: GUTTER, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Svg width={16} height={16} viewBox="0 0 24 24"><Path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" stroke={C.accent} strokeWidth={2.4} fill="none" /><Circle cx={12} cy={9.5} r={2.5} stroke={C.accent} strokeWidth={2.4} fill="none" /></Svg>
          <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.ink }}>FindMyHobby Club</Text>
        </View>
        <Pressable onPress={() => router.navigate('/me')} accessibilityLabel="Your profile"
          style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: C.ink, backgroundColor: C.illus, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.bold, fontSize: 15, color: C.ink }}>{me?.name.slice(0, 1).toUpperCase()}</Text>
        </Pressable>
      </View>

      {/* Live or open tournaments sit at the very top, so nobody misses them. */}
      {catalog.data?.tournaments.map((t) => <TournamentBanner key={t.id} t={t} />)}

      <Text style={{ paddingHorizontal: GUTTER, marginTop: 18, fontFamily: F.bold, fontSize: 40, lineHeight: 40, letterSpacing: -1.3, color: C.ink }}>
        Hi {me?.name.split(' ')[0]},{'\n'}what’s your <Text style={{ color: C.accent }}>hour</Text> today?
      </Text>

      {upNext && (
        <Pressable onPress={() => router.push(`/ticket/${upNext.ref}`)}
          style={({ pressed }) => ({ marginHorizontal: GUTTER, marginTop: 20, backgroundColor: C.ink, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <View style={{ flex: 1 }}>
            <T v="kicker" style={{ color: C.accent400 }}>Up next · {fmtDay(upNext.startsAt)}</T>
            <Text style={{ fontFamily: F.bold, fontSize: 18, color: C.white, marginTop: 6 }}>{upNext.activity} · {fmtRange(upNext.startsAt, upNext.endsAt)}</Text>
            <T style={{ color: C.n400, marginTop: 2 }}>{upNext.category} · {upNext.seats} seat{upNext.seats > 1 ? 's' : ''}{upNext.status === 'pending' ? ' · payment pending' : ''}</T>
          </View>
          <View style={{ backgroundColor: C.accent, paddingVertical: 8, paddingHorizontal: 12 }}><Text style={{ fontFamily: F.bold, color: C.white, fontSize: 13 }}>Show QR</Text></View>
        </Pressable>
      )}

      <View style={{ paddingHorizontal: GUTTER, marginTop: 28, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <T v="h2">What do you want to do?</T>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: GUTTER, gap: 8, paddingBottom: 12 }}>
        {[{ id: null, name: 'All', emoji: '' }, ...(catalog.data?.categories ?? [])].map((c) => {
          const on = category === c.id;
          return (
            <Pressable key={String(c.id)} onPress={() => setCategory(c.id)} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={{ borderWidth: 2, borderColor: C.ink, backgroundColor: on ? C.ink : 'transparent', paddingVertical: 8, paddingHorizontal: 12 }}>
              <Text style={{ fontFamily: F.bold, fontSize: 13, color: on ? C.white : C.ink }}>{c.emoji ? `${c.emoji} ` : ''}{c.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Full-bleed 3-column grid; the 2px gaps show the ink rule colour through. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, backgroundColor: C.divider, borderTopWidth: 2, borderBottomWidth: 2, borderColor: C.ink }}>
        {activities.map((a) => (
          <Pressable key={a.id} onPress={() => router.push(`/activity/${a.id}`)} accessibilityLabel={`${a.name}, from ${rupees(fromPrice.get(a.id) ?? a.defaultPrice)}`}
            style={({ pressed }) => ({ width: tile, height: 150, backgroundColor: C.illus, padding: 10, overflow: 'hidden', transform: [{ scale: pressed ? 0.96 : 1 }] })}>
            <Text numberOfLines={2} style={{ fontFamily: F.bold, fontSize: 14, color: C.ink, width: '80%' }}>{a.name}</Text>
            <Image source={mascot(a)} style={{ position: 'absolute', right: -6, bottom: 0, width: 92, height: 106 }} contentFit="cover" />
            <Text style={{ position: 'absolute', left: 10, bottom: 10, fontFamily: F.regular, fontSize: 11, color: C.n800 }}>
              {fromPrice.has(a.id) ? `from ${rupees(fromPrice.get(a.id)!)}` : 'No slots yet'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={{ paddingHorizontal: GUTTER, marginTop: 28 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <T v="h2">{nextDay === istDate(new Date()) ? 'Today’s slots' : 'Next slots'}</T>
          {soon[0] && <T v="small">{fmtDay(soon[0].startsAt)}</T>}
        </View>
        <Rule thick />
        {soon.map((s) => (
          <Pressable key={s.id} onPress={() => router.push({ pathname: '/activity/[id]', params: { id: s.activityId, slot: s.id } })}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderColor: C.divider, opacity: pressed ? 0.7 : 1 })}>
            <View style={{ width: 70 }}>
              <Text style={{ fontFamily: F.bold, fontSize: 17, color: C.ink }}>{fmtTime(s.startsAt).replace(/ (AM|PM)$/, '')}</Text>
              <T v="small">{fmtTime(s.startsAt).slice(-2)}</T>
            </View>
            <View style={{ flex: 1 }}>
              <T v="title">{s.activity}</T>
              <T v="small" style={{ color: s.seatsLeft <= 2 ? C.accent700 : C.n600 }}>{s.seatsLeft ? `${s.seatsLeft} spot${s.seatsLeft > 1 ? 's' : ''} left` : 'Full'} · {s.category}</T>
            </View>
            <T v="num" style={{ marginRight: 10 }}>{rupees(s.price)}</T>
            <Text style={{ fontFamily: F.bold, color: C.n500, fontSize: 16 }}>›</Text>
          </Pressable>
        ))}
        {!slots.loading && !soon.length && <T style={{ marginTop: 12 }}>No slots published yet. Check back soon.</T>}
      </View>

      <View style={{ marginHorizontal: GUTTER, marginTop: 28, backgroundColor: C.duo, flexDirection: 'row', minHeight: 150 }}>
        <View style={{ flex: 1, padding: 16, justifyContent: 'center' }}>
          <T v="title" style={{ fontSize: 18 }}>Bring your friends.</T>
          <T style={{ marginTop: 4 }}>Book up to 3 seats in one go.</T>
        </View>
        <Image source={require('../../../assets/img/duo.webp')} style={{ width: 140 }} contentFit="cover" />
      </View>
    </ScrollView>
  );
}

function TournamentBanner({ t }: { t: Tournament }) {
  const left = t.maxPlayers - (t.players ?? 0);
  const kicker = t.status === 'live' ? 'Live now · Knockout' : t.status === 'open' ? 'Competition · Knockout · Registration open' : 'Competition · Draw coming soon';
  return (
    <Pressable onPress={() => router.push(`/tournament/${t.id}`)} accessibilityRole="button"
      style={({ pressed }) => ({ marginHorizontal: GUTTER, marginTop: 16, backgroundColor: C.accent, padding: 18, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <T v="kicker" style={{ color: C.accent100 }}>{kicker}</T>
      <Text style={{ fontFamily: F.bold, fontSize: 30, lineHeight: 30, letterSpacing: -1, color: C.white, marginTop: 8 }}>{t.title}</Text>
      <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.white, marginTop: 10 }}>
        {fmtDay(t.startsAt)} · {fmtTime(t.startsAt)} · {t.entryFee ? `Entry ${rupees(t.entryFee)}` : 'Free entry'}
        {t.status === 'open' ? ` · ${left} place${left === 1 ? '' : 's'} left` : t.status === 'live' ? ' · See the bracket →' : ''}
      </Text>
    </Pressable>
  );
}
