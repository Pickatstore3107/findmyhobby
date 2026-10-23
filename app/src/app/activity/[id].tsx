import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import * as Crypto from 'expo-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fmtRange, istDate, istDay, rupees } from '@fmh/shared/time';
import { goBack } from '@/lib/nav';
import { api, message, useApi } from '@/lib/api';
import { mascot } from '@/lib/mascots';
import { openPayment } from '@/lib/pay';
import { C, F, GUTTER } from '@/lib/theme';
import type { Catalog, MyBooking, Slot } from '@/lib/types';
import { Btn, Note, Segmented, T } from '@/components/ui';

const DAYS = 4; // members can book today plus the next 3 days

export default function ActivityScreen() {
  const { id, slot: preselect } = useLocalSearchParams<{ id: string; slot?: string }>();
  const insets = useSafeAreaInsets();
  const catalog = useApi<Catalog>('/catalog');
  const slots = useApi<Slot[]>(`/slots?activityId=${id}`);
  const mine = useApi<MyBooking[]>('/bookings');

  const activity = catalog.data?.activities.find((a) => a.id === Number(id));
  const online = !!catalog.data?.payment.online;
  const category = catalog.data?.categories.find((c) => c.id === activity?.categoryId);
  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => istDay(i)), []);
  const preselected = slots.data?.find((s) => s.id === Number(preselect));
  const [day, setDay] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(preselect ? Number(preselect) : null);
  const [seats, setSeats] = useState(1);
  const [choice, setPay] = useState<'upi' | 'venue' | 'gateway' | null>(null);
  const pay = choice ?? (online ? 'gateway' : 'upi'); // online payment is the default whenever the club has it switched on
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestKey = useRef(Crypto.randomUUID()); // one key per booking attempt, so a retry can never double-book

  const activeDay = day ?? (preselected ? istDate(preselected.startsAt) : istDate(slots.data?.[0]?.startsAt ?? new Date()));
  const daySlots = (slots.data ?? []).filter((s) => istDate(s.startsAt) === activeDay);
  const slot = slots.data?.find((s) => s.id === selected);
  const bookedHere = (s: Slot) => (mine.data ?? []).find((b) => b.activityId === s.activityId && b.startsAt === s.startsAt && ['pending', 'confirmed', 'checked_in'].includes(b.status));
  const myBooking = slot && bookedHere(slot);
  const maxSeats = Math.min(3, slot?.seatsLeft ?? 1);

  const pick = (s: Slot) => { setSelected(s.id); setSeats(1); setError(''); requestKey.current = Crypto.randomUUID(); };

  const book = async () => {
    if (!slot) return;
    setBusy(true); setError('');
    try {
      const b = await api<{ ref: string }>('/bookings', { slotId: slot.id, seats, method: pay, idempotencyKey: requestKey.current });
      requestKey.current = Crypto.randomUUID();
      slots.reload(); mine.reload();
      router.push(`/ticket/${b.ref}`);
      if (pay === 'gateway') await openPayment(b.ref);
    } catch (e) { setError(message(e)); slots.reload(); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 220 }}>
        <View style={{ backgroundColor: C.illus, minHeight: 280, paddingTop: insets.top + 64, paddingHorizontal: GUTTER, paddingBottom: 20, overflow: 'hidden' }}>
          <T v="kicker" style={{ color: C.accent800 }}>{category ? `${category.emoji} ${category.name}` : ' '}</T>
          <Text style={{ fontFamily: F.bold, fontSize: 42, lineHeight: 42, letterSpacing: -1.4, color: C.ink, marginTop: 6, width: '62%' }}>{activity?.name ?? ''}</Text>
          <T style={{ color: C.n800, marginTop: 8, width: '60%' }}>FindMyHobby Club{slot ? ` · ${slot.zone}` : ''}</T>
          {activity && <Image source={mascot(activity)} style={{ position: 'absolute', right: -10, bottom: 0, width: 170, height: 204 }} contentFit="cover" />}
        </View>

        {/* Day strip: today + 3 days, with the ink block on the chosen day. */}
        <View style={{ flexDirection: 'row', borderTopWidth: 2, borderBottomWidth: 2, borderColor: C.ink }}>
          {days.map((d, i) => {
            const key = istDate(d), on = key === activeDay;
            const count = (slots.data ?? []).filter((s) => istDate(s.startsAt) === key).length;
            return (
              <Pressable key={key} onPress={() => { setDay(key); setSelected(null); }} accessibilityRole="tab" accessibilityState={{ selected: on }}
                style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 10, backgroundColor: on ? C.ink : 'transparent', borderLeftWidth: i ? 1 : 0, borderColor: C.divider }}>
                <T v="kicker" style={{ fontSize: 10, color: on ? C.n400 : C.n600 }}>{i === 0 ? 'Today' : d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' })}</T>
                <Text style={{ fontFamily: F.bold, fontSize: 19, color: on ? C.white : C.ink }}>{d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric' })}</Text>
                <T v="small" style={{ fontSize: 10, color: on ? C.n400 : C.n500 }}>{count ? `${count} slot${count > 1 ? 's' : ''}` : '—'}</T>
              </Pressable>
            );
          })}
        </View>

        <View style={{ paddingHorizontal: GUTTER, paddingTop: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <T v="h2">Slots</T><T v="small">Up to 3 seats per booking</T>
        </View>
        <View style={{ marginTop: 10, borderTopWidth: 2, borderColor: C.ink, marginHorizontal: GUTTER }}>
          {daySlots.map((s) => {
            const on = s.id === selected, mineHere = bookedHere(s), full = s.seatsLeft === 0;
            const fg = on ? C.white : C.ink, sub = on ? C.accent100 : C.n600;
            return (
              <Pressable key={s.id} onPress={() => pick(s)} accessibilityRole="radio" accessibilityState={{ selected: on }}
                style={{ backgroundColor: on ? C.accent : 'transparent', paddingVertical: 14, paddingHorizontal: on ? 12 : 0, marginHorizontal: on ? -12 : 0, borderBottomWidth: 1, borderColor: C.divider, gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontFamily: F.bold, fontSize: 20, color: fg }}>{fmtRange(s.startsAt, s.endsAt)}</Text>
                  <Text style={{ fontFamily: F.bold, fontSize: 17, color: fg }}>{rupees(s.price)}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    <Capacity taken={s.capacity - s.seatsLeft} capacity={s.capacity} color={fg} />
                    <T v="small" style={{ color: mineHere ? (on ? C.white : C.accent700) : full ? C.accent700 : s.seatsLeft <= 2 ? (on ? C.white : C.accent700) : sub }}>
                      {mineHere ? 'Your slot · booked' : full ? 'Full' : `${s.seatsLeft} spot${s.seatsLeft > 1 ? 's' : ''} left`}
                    </T>
                  </View>
                  {s.hostName && <T v="small" style={{ color: sub }}>with {s.hostName}</T>}
                </View>
              </Pressable>
            );
          })}
          {!slots.loading && !daySlots.length && <T style={{ paddingVertical: 16 }}>No slots on this day. Try another day.</T>}
        </View>
      </ScrollView>

      <Pressable onPress={() => goBack()} accessibilityLabel="Back"
        style={({ pressed }) => ({ position: 'absolute', top: insets.top + 8, left: GUTTER, width: 40, height: 40, borderWidth: 2, borderColor: C.ink, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.9 : 1 }] })}>
        <Text style={{ fontFamily: F.bold, fontSize: 20, color: C.ink, marginTop: -2 }}>‹</Text>
      </Pressable>

      {/* Bottom booking bar */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.bg, borderTopWidth: 2, borderColor: C.ink, padding: GUTTER, paddingBottom: insets.bottom + 12, gap: 10 }}>
        {!!error && <Note tone="error">{error}</Note>}
        {slot && !myBooking && slot.seatsLeft > 0 && (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flexDirection: 'row', borderWidth: 2, borderColor: C.ink, height: 44, alignItems: 'center' }}>
              <Stepper label="−" disabled={seats <= 1} onPress={() => setSeats(seats - 1)} />
              <Text style={{ fontFamily: F.bold, fontSize: 14, color: C.ink, width: 64, textAlign: 'center' }}>{seats} seat{seats > 1 ? 's' : ''}</Text>
              <Stepper label="+" disabled={seats >= maxSeats} onPress={() => setSeats(seats + 1)} />
            </View>
            <View style={{ flex: 1 }}>
              <Segmented value={pay} onChange={setPay} options={[online ? { value: 'gateway', label: 'Pay online' } : { value: 'upi', label: 'UPI' }, { value: 'venue', label: 'At venue' }]} />
            </View>
          </View>
        )}
        {myBooking ? <Btn kind="dark" label="Booked · View ticket" right="→" onPress={() => router.push(`/ticket/${myBooking.ref}`)} />
          : slot?.seatsLeft === 0 ? <Btn label="This slot is full" disabled />
          : slot ? <Btn label={busy ? 'Confirming your slot…' : `Book ${fmtRange(slot.startsAt, slot.endsAt)}`} right={rupees(slot.price * seats)} disabled={busy} onPress={book} />
          : <Btn label="Pick a slot" disabled />}
      </View>
    </View>
  );
}

function Stepper({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityLabel={label === '+' ? 'More seats' : 'Fewer seats'}
      style={{ width: 40, height: '100%', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.3 : 1 }}>
      <Text style={{ fontFamily: F.bold, fontSize: 20, color: C.ink }}>{label}</Text>
    </Pressable>
  );
}

/** Small squares for small classes (filled = taken); a bar for big ones, where 30 squares would not fit. */
function Capacity({ taken, capacity, color }: { taken: number; capacity: number; color: string }) {
  if (capacity <= 12) return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {Array.from({ length: capacity }, (_, i) => <View key={i} style={{ width: 10, height: 10, borderWidth: 1.5, borderColor: color, backgroundColor: i < taken ? color : 'transparent' }} />)}
    </View>
  );
  return <View style={{ width: 70, height: 6, borderWidth: 1.5, borderColor: color }}><View style={{ width: `${(taken / capacity) * 100}%`, height: '100%', backgroundColor: color }} /></View>;
}
