import { Tabs } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { C, EASE, F } from '@/lib/theme';

// Lucide-style icons (home, trophy, ticket, user) drawn with a 2.2 stroke, as in the design.
const ICONS: Record<string, (color: string) => React.ReactNode> = {
  index: (c) => <><Path d="M3 10.5 12 3l9 7.5V21H3z" stroke={c} strokeWidth={2.2} fill="none" strokeLinejoin="round" /><Path d="M9 21v-6h6v6" stroke={c} strokeWidth={2.2} fill="none" /></>,
  compete: (c) => <><Path d="M7 4h10v5a5 5 0 0 1-10 0z M7 6H4v2a3 3 0 0 0 3 3 M17 6h3v2a3 3 0 0 1-3 3 M12 14v4 M8 21h8 M9 18h6" stroke={c} strokeWidth={2.2} fill="none" strokeLinejoin="round" /></>,
  bookings: (c) => <><Path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z" stroke={c} strokeWidth={2.2} fill="none" strokeLinejoin="round" /><Rect x={12} y={8} width={0.5} height={8} stroke={c} strokeWidth={1.5} strokeDasharray="2 2" /></>,
  me: (c) => <><Circle cx={12} cy={8} r={4} stroke={c} strokeWidth={2.2} fill="none" /><Path d="M4 21a8 8 0 0 1 16 0" stroke={c} strokeWidth={2.2} fill="none" /></>,
};
const LABELS: Record<string, string> = { index: 'Play', compete: 'Compete', bookings: 'Bookings', me: 'Me' };

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: C.bg } }} tabBar={(p) => <TabBar {...p} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="compete" />
      <Tabs.Screen name="bookings" />
      <Tabs.Screen name="me" />
    </Tabs>
  );
}

function TabBar({ state, navigateToTab }: { state: { index: number; routes: { key: string; name: string }[] }; navigateToTab: (routeKey: string) => void }) {
  const insets = useSafeAreaInsets();
  const [w, setW] = useState(0);
  const cell = w / state.routes.length;
  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: withTiming(state.index * cell, { duration: 450, easing: Easing.bezier(...EASE) }) }] }), [state.index, cell]);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', borderTopWidth: 2, borderColor: C.ink, backgroundColor: C.bg, paddingBottom: Math.max(insets.bottom, 12) }}>
      {w > 0 && <Animated.View style={[{ position: 'absolute', top: -2, height: 3, width: cell, backgroundColor: C.accent }, indicator]} />}
      {state.routes.map((r, i) => {
        const active = state.index === i, color = active ? C.accent : C.n500;
        return (
          <Pressable key={r.key} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={LABELS[r.name]}
            onPress={() => !active && navigateToTab(r.key)}
            style={({ pressed }) => ({ flex: 1, paddingTop: 10, paddingLeft: 18, gap: 4, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
            <Svg width={22} height={22} viewBox="0 0 24 24">{ICONS[r.name](color)}</Svg>
            <Text style={{ fontFamily: F.bold, fontSize: 11, color }}>{LABELS[r.name]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
