import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import QRCode from 'react-native-qrcode-svg';
import * as Haptics from 'expo-haptics';
import { fmtDay, fmtRange, fmtTime, rupees } from '@fmh/shared/time';
import { goBack } from '@/lib/nav';
import { api, message, useApi, useNow } from '@/lib/api';
import { mascot } from '@/lib/mascots';
import { openPayment } from '@/lib/pay';
import { C, F, GUTTER } from '@/lib/theme';
import type { Catalog, MyBooking } from '@/lib/types';
import { Btn, Note, T } from '@/components/ui';

export default function Ticket() {
  const { ref } = useLocalSearchParams<{ ref: string }>();
  const mine = useApi<MyBooking[]>('/bookings');
  const catalog = useApi<Catalog>('/catalog');
  const b = mine.data?.find((x) => x.ref === ref);
  const [utr, setUtr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const now = useNow(1000); // ticks every second for the payment countdown
  const left = b?.holdUntil ? Math.max(0, Math.round((+new Date(b.holdUntil) - now) / 1000)) : 0;

  // While an online payment is in progress, ask our server every 3 seconds; it hears from Razorpay directly.
  const waitingOnline = b?.status === 'pending' && b.method === 'gateway';
  const { reload } = mine;
  useEffect(() => {
    if (!waitingOnline) return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [waitingOnline, reload]);
  // A little buzz the moment the payment goes through.
  const lastStatus = useRef(b?.status);
  useEffect(() => {
    if (lastStatus.current === 'pending' && b?.status === 'confirmed') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    lastStatus.current = b?.status;
  }, [b?.status]);

  if (!b) return <View style={{ flex: 1, backgroundColor: C.bg, padding: GUTTER }}><T>{mine.loading ? 'Loading…' : 'Booking not found.'}</T></View>;

  const awaitingPayment = b.status === 'pending' && !!b.holdUntil && left > 0; // UPI: must pay within 10 minutes
  const verifying = b.method === 'upi' && b.status === 'pending' && !b.holdUntil; // UTR sent, the club is checking it
  const cancellable = ['pending', 'confirmed'].includes(b.status) && +new Date(b.startsAt) - now > 2 * 3600e3;
  const upi = catalog.data?.payment;
  const activity = { id: b.activityId, name: b.activity };

  const openUpi = () => {
    if (!upi?.upiId) return;
    const q = new URLSearchParams({ pa: upi.upiId, pn: upi.payeeName, am: (b.amount / 100).toFixed(2), cu: 'INR', tn: `FindMyHobby ${b.ref}` });
    Linking.openURL(`upi://pay?${q}`).catch(() => setError('No UPI app found on this phone. Pay to the UPI ID shown, then enter the reference.'));
  };

  const sendUtr = async () => {
    setBusy(true); setError('');
    try { await api(`/bookings/${b.ref}/utr`, { utr }); await mine.reload(); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  };

  const cancel = () => {
    const go = async () => {
      try { await api(`/bookings/${b.ref}/cancel`, {}); await mine.reload(); goBack(); }
      catch (e) { setError(message(e)); }
    };
    if (Platform.OS === 'web') return go();
    Alert.alert('Cancel this slot?', b.status === 'confirmed' ? 'Your seats will be released. Paid bookings are refunded by the club.' : 'Your seats will be released.',
      [{ text: 'Keep it', style: 'cancel' }, { text: 'Cancel slot', style: 'destructive', onPress: go }]);
  };

  const [kicker, title] =
    awaitingPayment ? [`Pay to confirm · ${b.ref}`, `Almost there.\nPay ${rupees(b.amount)}.`]
    : verifying ? [`Verifying payment · ${b.ref}`, `Payment sent.\nWe’re checking it.`]
    : b.status === 'confirmed' ? [b.method === 'gateway' ? `Payment successful · ${b.ref}` : `Booking confirmed · ${b.ref}`, `You’re in.\nSee you at ${fmtTime(b.startsAt)}.`]
    : b.status === 'checked_in' ? [`Checked in · ${b.ref}`, 'Enjoy your\nhour!']
    : b.status === 'pending' ? [`Payment time ran out · ${b.ref}`, 'Seat\nreleased.']
    : [`${b.status.replace('_', ' ')} · ${b.ref}`, 'This booking\nis closed.'];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: GUTTER, paddingTop: 28, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <T v="kicker" style={{ color: C.accent, flex: 1 }}>{kicker}</T>
        <Pressable onPress={() => goBack()} hitSlop={12}><Text style={{ fontFamily: F.bold, fontSize: 15, color: C.accent700 }}>Done</Text></Pressable>
      </View>
      <Text style={{ fontFamily: F.bold, fontSize: 44, lineHeight: 44, letterSpacing: -1.5, color: C.ink, marginTop: 10, marginBottom: 20 }}>{title}</Text>

      {b.status === 'confirmed' && b.method === 'gateway' && (
        <View style={{ backgroundColor: '#1D6B3A', padding: 16, marginBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={{ fontFamily: F.bold, fontSize: 30, color: C.white }}>✓</Text>
          <Text style={{ fontFamily: F.bold, fontSize: 16, color: C.white, flex: 1 }}>{rupees(b.amount)} paid to FindMyHobby Club. Your seats are confirmed.</Text>
        </View>
      )}
      {awaitingPayment && b.method === 'gateway' && (
        <View style={{ borderWidth: 2, borderColor: C.ink, backgroundColor: C.white, padding: 16, marginBottom: 20, gap: 10 }}>
          <T v="title">Pay within <Text style={{ color: C.accent700 }}>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</Text> to keep your seats</T>
          <Btn label="Pay securely" right={rupees(b.amount)} onPress={() => openPayment(b.ref)} />
          <T v="small">UPI apps, cards and net banking, handled by Razorpay. This screen updates by itself once you have paid.</T>
        </View>
      )}
      {awaitingPayment && b.method === 'upi' && (
        <View style={{ borderWidth: 2, borderColor: C.ink, backgroundColor: C.white, padding: 16, marginBottom: 20, gap: 10 }}>
          <T v="title">1. Pay {rupees(b.amount)} by UPI <Text style={{ color: C.accent700 }}>· {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} left</Text></T>
          {upi?.upiId ? <>
            <Btn label="Open UPI app" right="→" onPress={openUpi} small />
            <T v="small">Or pay to UPI ID <Text style={{ fontFamily: F.bold, color: C.ink }}>{upi.upiId}</Text> ({upi.payeeName})</T>
          </> : <Note tone="error">The club hasn’t set up UPI payments yet. Please cancel and book with “At venue”.</Note>}
          <T v="title" style={{ marginTop: 6 }}>2. Enter the 12-digit UPI reference (UTR)</T>
          <T v="small">You’ll find it in your UPI app under the payment details.</T>
          <TextInput value={utr} onChangeText={(v) => setUtr(v.replace(/\D/g, '').slice(0, 12))} keyboardType="number-pad" placeholder="e.g. 412345678901"
            placeholderTextColor={C.n500} style={{ height: 50, borderWidth: 2, borderColor: C.ink, paddingHorizontal: 12, fontFamily: F.bold, fontSize: 18, letterSpacing: 1, color: C.ink }} />
          <Btn label={busy ? 'Sending…' : 'Submit payment reference'} disabled={busy || utr.length !== 12} onPress={sendUtr} small kind="dark" />
        </View>
      )}
      {verifying && <Note>We received your UPI reference. Your booking is confirmed once the club checks it, usually within a few minutes.</Note>}
      {!!error && <Note tone="error">{error}</Note>}

      {/* The ticket */}
      <View style={{ backgroundColor: C.white, borderWidth: 2, borderColor: C.ink }}>
        <View style={{ height: 96, backgroundColor: C.illus, padding: 14, borderBottomWidth: 2, borderStyle: 'dashed', borderColor: C.ink, overflow: 'hidden' }}>
          <Text style={{ fontFamily: F.bold, fontSize: 22, color: C.ink, width: '65%' }}>{b.activity}</Text>
          <T v="small" style={{ color: C.n800 }}>FindMyHobby Club · {b.zone}</T>
          <Image source={mascot(activity)} style={{ position: 'absolute', right: 0, bottom: 0, width: 80, height: 92 }} contentFit="cover" />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {[['Day', fmtDay(b.startsAt)], ['Slot', fmtRange(b.startsAt, b.endsAt)], ['Seats', String(b.seats)],
            ['Amount', rupees(b.amount)]]
            .map(([k, v], i) => (
              <View key={k} style={{ width: '50%', padding: 14, borderColor: C.divider, borderBottomWidth: i < 2 ? 1 : 0, borderLeftWidth: i % 2 ? 1 : 0 }}>
                <T v="kicker" style={{ fontSize: 10 }}>{k}</T>
                <Text style={{ fontFamily: F.bold, fontSize: 16, color: C.ink, marginTop: 2 }}>{v}</Text>
              </View>
            ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 14, padding: 14, borderTopWidth: 1, borderColor: C.divider, alignItems: 'center',
          opacity: ['confirmed', 'checked_in', 'pending'].includes(b.status) ? 1 : 0.25 }}>
          <QRCode value={b.ref} size={138} color={C.ink} backgroundColor={C.white} quietZone={0} />
          <View style={{ flex: 1, gap: 6 }}>
            <T v="title">Show this at the front desk</T>
            <T v="small">Check-in opens 15 minutes before your slot.</T>
            <T v="small" style={{ fontFamily: F.bold, color: C.ink, fontSize: 16, letterSpacing: 1 }}>{b.ref}</T>
            {b.hostName && <T v="small">With {b.hostName}</T>}
          </View>
        </View>
      </View>

      {cancellable && <Btn kind="ghost" label="Cancel slot" onPress={cancel} style={{ marginTop: 16 }} small />}
      {['pending', 'confirmed'].includes(b.status) && !cancellable && <T v="small" style={{ marginTop: 12 }}>Free cancellation closes 2 hours before the slot.</T>}
    </ScrollView>
  );
}

