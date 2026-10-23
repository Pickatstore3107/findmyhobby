import { useState, type ReactNode } from 'react';
import { Pressable, Text, View, type PressableProps, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { C, EASE, F } from '@/lib/theme';

const ease = Easing.bezier(...EASE);

const VARIANTS = {
  display: { fontFamily: F.bold, fontSize: 44, lineHeight: 44, letterSpacing: -1.5, color: C.ink },
  h2: { fontFamily: F.bold, fontSize: 20, lineHeight: 24, color: C.ink },
  title: { fontFamily: F.bold, fontSize: 16, lineHeight: 20, color: C.ink },
  body: { fontFamily: F.regular, fontSize: 14, lineHeight: 21, color: C.n700 },
  small: { fontFamily: F.regular, fontSize: 12, lineHeight: 16, color: C.n600 },
  kicker: { fontFamily: F.semi, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: C.n600 },
  num: { fontFamily: F.bold, fontSize: 17, color: C.ink, fontVariant: ['tabular-nums'] },
} satisfies Record<string, TextStyle>;

export function T({ v = 'body', style, ...p }: TextProps & { v?: keyof typeof VARIANTS }) {
  return <Text {...p} style={[VARIANTS[v], style]} />;
}

type BtnProps = PressableProps & { label: string; right?: ReactNode; kind?: 'primary' | 'dark' | 'ghost' | 'light'; style?: StyleProp<ViewStyle>; small?: boolean };

/** Flush-left label, optional right-hand detail (price/arrow), square corners, gentle press scale. */
export function Btn({ label, right, kind = 'primary', style, small, disabled, onPress, ...p }: BtnProps) {
  const bg = { primary: C.accent, dark: C.ink, ghost: 'transparent', light: C.white }[kind];
  const fg = kind === 'ghost' ? C.ink : kind === 'light' ? C.accent700 : C.white;
  return (
    <Pressable {...p} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
      onPress={(e) => { Haptics.selectionAsync().catch(() => {}); onPress?.(e); }}
      style={({ pressed }) => [{
        height: small ? 40 : 54, paddingHorizontal: 16, backgroundColor: bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        borderWidth: 2, borderColor: kind === 'ghost' ? C.ink : bg, opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.98 : 1 }],
      }, style]}>
      <Text style={{ fontFamily: F.bold, fontSize: small ? 13 : 15, color: fg }}>{label}</Text>
      {typeof right === 'string' ? <Text style={{ fontFamily: F.bold, fontSize: small ? 13 : 15, color: fg }}>{right}</Text> : right}
    </Pressable>
  );
}

/** Outlined segmented control with one red block sliding under the chosen option. */
export function Segmented<V extends string>({ options, value, onChange }: { options: { value: V; label: string; disabled?: boolean }[]; value: V; onChange: (v: V) => void }) {
  const [w, setW] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const cell = w / options.length;
  const slider = useAnimatedStyle(() => ({ transform: [{ translateX: withTiming(index * cell, { duration: 420, easing: ease }) }] }), [index, cell]);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width - 4)} style={{ flexDirection: 'row', borderWidth: 2, borderColor: C.ink, height: 44 }}>
      {w > 0 && <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, width: cell, backgroundColor: C.accent }, slider]} />}
      {options.map((o, i) => (
        <Pressable key={o.value} disabled={o.disabled} onPress={() => { Haptics.selectionAsync().catch(() => {}); onChange(o.value); }}
          accessibilityRole="radio" accessibilityState={{ selected: o.value === value, disabled: o.disabled }}
          style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 10, borderLeftWidth: i ? 2 : 0, borderColor: C.ink, opacity: o.disabled ? 0.4 : 1 }}>
          <Text numberOfLines={1} style={{ fontFamily: F.bold, fontSize: 13, color: o.value === value ? C.white : C.ink }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const Rule = ({ thick, style }: { thick?: boolean; style?: StyleProp<ViewStyle> }) =>
  <View style={[{ height: thick ? 2 : 1, backgroundColor: thick ? C.ink : C.divider }, style]} />;

export const Note = ({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'ok' }) => (
  <View style={{ borderLeftWidth: 4, borderColor: tone === 'error' ? C.accent : tone === 'ok' ? '#1D6B3A' : C.ink, backgroundColor: C.white, padding: 12, marginVertical: 8 }}>
    <T style={{ color: tone === 'error' ? C.accent700 : C.ink }}>{children}</T>
  </View>
);
