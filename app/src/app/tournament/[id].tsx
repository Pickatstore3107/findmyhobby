import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fmtDay, fmtTime, rupees } from '@fmh/shared/time';
import { goBack } from '@/lib/nav';
import { api, message, useApi } from '@/lib/api';
import { C, F, GUTTER } from '@/lib/theme';
import type { Bracket, Match } from '@/lib/types';
import { Btn, Note, T } from '@/components/ui';

// Canvas geometry: each match is a box; round r is a column, and its matches sit centred between their two feeders.
const BOX_W = 168, BOX_H = 66, GAP_X = 56, ROW = BOX_H + 18;
const colX = (round: number) => 24 + (round - 1) * (BOX_W + GAP_X);
const rowY = (round: number, pos: number) => 24 + (pos + 0.5) * 2 ** (round - 1) * ROW - BOX_H / 2;

export default function TournamentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const data = useApi<Bracket>(`/tournaments/${id}`);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Live results: refresh every 15 seconds while the tournament is being played.
  const live = data.data?.tournament.status === 'live';
  useFocusEffect(useCallback(() => {
    if (!live) return;
    const t = setInterval(data.reload, 15000);
    return () => clearInterval(t);
  }, [live, data.reload]));

  const t = data.data?.tournament;
  if (!t) return <View style={{ flex: 1, backgroundColor: C.bg, padding: GUTTER, paddingTop: insets.top + 60 }}><T>{data.error ?? 'Loading…'}</T></View>;
  const players = data.data!.players;
  const joined = data.data!.joined;
  const left = t.maxPlayers - players.length;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); await data.reload(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ backgroundColor: C.accent, paddingTop: insets.top + 60, paddingHorizontal: GUTTER, paddingBottom: 18 }}>
        <T v="kicker" style={{ color: C.accent100 }}>{fmtDay(t.startsAt)} · {fmtTime(t.startsAt)} · Knockout</T>
        <Text style={{ fontFamily: F.bold, fontSize: 36, lineHeight: 36, letterSpacing: -1.2, color: C.white, marginTop: 8 }}>{t.title}</Text>
        <T style={{ color: C.white, marginTop: 8 }}>
          {t.entryFee ? `Entry ${rupees(t.entryFee)}, paid at the desk` : 'Free entry'} · {players.length}/{t.maxPlayers} players
        </T>
      </View>

      {(t.status === 'open' || t.status === 'closed') ? (
        <View style={{ padding: GUTTER, gap: 12, flex: 1 }}>
          {!!error && <Note tone="error">{error}</Note>}
          {t.status === 'open' && (joined
            ? <Btn kind="dark" label="✓ You're registered" right="Leave" disabled={busy} onPress={() => act(() => api(`/tournaments/${t.id}/register`, undefined, 'DELETE'))} />
            : <Btn label={left > 0 ? 'Register' : 'Tournament full'} right={left > 0 ? (t.entryFee ? rupees(t.entryFee) : 'Free') : undefined} disabled={busy || left <= 0}
                onPress={() => act(() => api(`/tournaments/${t.id}/register`, {}))} />)}
          <T>{t.status === 'open' ? `${left} place${left === 1 ? '' : 's'} left. The draw is made when registration closes; the bracket appears here.` : 'Registration is closed. The draw is coming soon.'}</T>
          <T v="kicker" style={{ marginTop: 12 }}>Players</T>
          <T style={{ color: C.ink }}>{players.map((p) => p.name).join(' · ') || 'Be the first to join.'}</T>
        </View>
      ) : <BracketCanvas data={data.data!} />}

      <Pressable onPress={() => goBack()} accessibilityLabel="Back"
        style={{ position: 'absolute', top: insets.top + 8, left: GUTTER, width: 40, height: 40, borderWidth: 2, borderColor: C.white, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: F.bold, fontSize: 20, color: C.white, marginTop: -2 }}>‹</Text>
      </Pressable>
    </View>
  );
}

/** Pan and pinch-zoom canvas, like a workflow editor: drag to move, pinch to zoom, "Fit" to reset. */
function BracketCanvas({ data }: { data: Bracket }) {
  const insets = useSafeAreaInsets();
  const rounds = Math.max(...data.matches.map((m) => m.round));
  const name = (pid: number | null) => data.players.find((p) => p.id === pid)?.name;
  const label = (r: number) => ['Final', 'Semi-finals', 'Quarter-finals', 'Round of 16', 'Round of 32'][rounds - r] ?? `Round ${r}`;
  const width = colX(rounds) + BOX_W + 24;
  const height = rowY(1, data.matches.filter((m) => m.round === 1).length - 1) + BOX_H + 48;
  const champion = name(data.matches.find((m) => m.round === rounds)?.winnerId ?? null);

  const scale = useSharedValue(1), savedScale = useSharedValue(1);
  const x = useSharedValue(0), y = useSharedValue(0), savedX = useSharedValue(0), savedY = useSharedValue(0);
  const pan = Gesture.Pan().onUpdate((e) => { x.value = savedX.value + e.translationX; y.value = savedY.value + e.translationY; })
    .onEnd(() => { savedX.value = x.value; savedY.value = y.value; });
  const pinch = Gesture.Pinch().onUpdate((e) => { scale.value = Math.min(2.5, Math.max(0.35, savedScale.value * e.scale)); })
    .onEnd(() => { savedScale.value = scale.value; });
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }] }));
  const fit = () => {
    x.set(withTiming(0)); y.set(withTiming(0)); scale.set(withTiming(1));
    savedX.set(0); savedY.set(0); savedScale.set(1);
  };

  // Elbow connector from a match to the one its winner moves into; red when the winner has already advanced.
  const connector = (m: Match) => {
    if (m.round === rounds) return null;
    const x1 = colX(m.round) + BOX_W, y1 = rowY(m.round, m.position) + BOX_H / 2;
    const x2 = colX(m.round + 1), y2 = rowY(m.round + 1, Math.floor(m.position / 2)) + BOX_H / 2, mid = x1 + GAP_X / 2;
    return <Path key={`c${m.id}`} d={`M${x1} ${y1} H${mid} V${y2} H${x2}`} stroke={m.winnerId ? C.accent : C.n400} strokeWidth={2} fill="none" />;
  };

  return (
    <View style={{ flex: 1, overflow: 'hidden', backgroundColor: C.bg }}>
      {champion && <View style={{ backgroundColor: C.ink, padding: 12, paddingHorizontal: GUTTER }}>
        <Text style={{ fontFamily: F.bold, color: C.white, fontSize: 16 }}>🏆 Champion: {champion}</Text>
      </View>}
      <GestureDetector gesture={Gesture.Simultaneous(pan, pinch)}>
        <View style={{ flex: 1 }}>
          {/* Dotted canvas background, like a workflow editor */}
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
            {Array.from({ length: 400 }, (_, i) => <Path key={i} d={`M${(i % 20) * 24 + 12} ${Math.floor(i / 20) * 24 + 12}h1`} stroke={C.n400} strokeWidth={2} />)}
          </Svg>
          <Animated.View style={[{ width, height, transformOrigin: 'top left' }, style]}>
            <Svg width={width} height={height} style={{ position: 'absolute' }}>{data.matches.map(connector)}</Svg>
            {Array.from({ length: rounds }, (_, i) => (
              <Text key={i} style={{ position: 'absolute', left: colX(i + 1), top: 2, fontFamily: F.semi, fontSize: 10, letterSpacing: 1.2, color: C.n600 }}>{label(i + 1).toUpperCase()}</Text>
            ))}
            {data.matches.map((m) => (
              <View key={m.id} style={{ position: 'absolute', left: colX(m.round), top: rowY(m.round, m.position) + 10, width: BOX_W, height: BOX_H, backgroundColor: C.white, borderWidth: 2, borderColor: C.ink }}>
                {[m.player1Id, m.player2Id].map((p, i) => {
                  const won = !!p && m.winnerId === p, lost = !!p && !!m.winnerId && !won;
                  const bye = m.round === 1 && i === 1 && !p;
                  return (
                    <View key={i} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 9,
                      backgroundColor: won ? C.ink : 'transparent', borderTopWidth: i ? 1 : 0, borderColor: C.divider, opacity: lost ? 0.35 : 1 }}>
                      <Text numberOfLines={1} style={{ fontFamily: won ? F.bold : F.semi, fontSize: 13, color: won ? C.white : p ? C.ink : C.n500, flex: 1,
                        textDecorationLine: lost ? 'line-through' : 'none' }}>{name(p) ?? (bye ? 'Bye' : 'TBD')}</Text>
                      {won && <Text style={{ color: C.accent, fontFamily: F.bold }}>●</Text>}
                    </View>
                  );
                })}
              </View>
            ))}
          </Animated.View>
        </View>
      </GestureDetector>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 2, borderColor: C.ink,
        backgroundColor: C.bg, paddingHorizontal: GUTTER, paddingTop: 10, paddingBottom: insets.bottom + 10 }}>
        <T v="small">Drag to move · pinch to zoom</T>
        <Btn small kind="ghost" label="Fit" onPress={fit} style={{ width: 72 }} />
      </View>
    </View>
  );
}
