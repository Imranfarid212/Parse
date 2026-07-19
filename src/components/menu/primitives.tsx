/**
 * Menu primitives — the shared building blocks for the Export / Search /
 * Settings screens, ported from the finance-app reference into RN.
 *
 * Same design tokens as the receipt card: grey-only hierarchy, white cards with
 * a 1px ring + soft shadow, rounded-20, tracked uppercase eyebrows.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';

import { fontFamily } from '@/theme/tokens';

/** Spec greys (Tailwind scale). */
export const GRAY = {
  900: '#111827',
  700: '#374151',
  600: '#4B5563',
  500: '#6B7280',
  400: '#9CA3AF',
  200: '#E5E7EB',
  100: '#F3F4F6',
  50: '#F9FAFB',
  ring: 'rgba(17,24,39,0.05)',
} as const;

type FeatherName = React.ComponentProps<typeof Feather>['name'];

export function Eyebrow({ children, style }: { children: string; style?: TextStyle }) {
  return <Text style={[styles.eyebrow, style]}>{children}</Text>;
}

/** White rounded card with a 1px ring + soft shadow; rows stack inside. */
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Hairline divider, inset past the icon like the reference. */
export function Divider({ inset = 56 }: { inset?: number }) {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: GRAY[100], marginLeft: inset }} />;
}

/** Round icon chip that leads a row. */
export function IconChip({ icon, color = GRAY[500], bg = GRAY[50] }: { icon: FeatherName; color?: string; bg?: string }) {
  return (
    <View style={[styles.iconChip, { backgroundColor: bg }]}>
      <Feather name={icon} size={16} color={color} />
    </View>
  );
}

/**
 * A settings/list row: leading icon chip + label, and either a value+chevron or
 * a custom right element (e.g. a Toggle). Pressable when `onPress` is given.
 */
export function Row({
  icon,
  iconColor,
  iconBg,
  label,
  labelColor = GRAY[900],
  value,
  right,
  onPress,
}: {
  icon: FeatherName;
  iconColor?: string;
  iconBg?: string;
  label: string;
  labelColor?: string;
  value?: string;
  right?: React.ReactNode;
  onPress?: () => void;
}) {
  const body = (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <IconChip icon={icon} color={iconColor} bg={iconBg} />
        <Text style={[styles.rowLabel, { color: labelColor }]}>{label}</Text>
      </View>
      <View style={styles.rowRight}>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        {right ?? (onPress ? <Feather name="chevron-right" size={16} color={GRAY[400]} /> : null)}
      </View>
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { backgroundColor: GRAY[50] }}>
      {body}
    </Pressable>
  );
}

/** Custom pill toggle: grey when off, dark (gray-900) when on. */
export function Toggle({ value, onValueChange }: { value: boolean; onValueChange: (v: boolean) => void }) {
  const p = useDerivedValue(() => withTiming(value ? 1 : 0, { duration: 200 }));

  const track = useAnimatedStyle(() => ({
    backgroundColor: p.value > 0.5 ? GRAY[900] : GRAY[200],
  }));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: p.value * 20 }] }));

  return (
    <Pressable onPress={() => onValueChange(!value)} hitSlop={8}>
      <Animated.View style={[styles.track, track]}>
        <Animated.View style={[styles.knob, knob]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    fontFamily: fontFamily.display,
    fontSize: 10,
    letterSpacing: 1.5,
    color: GRAY[400],
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: GRAY.ring,
    overflow: 'hidden',
    boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 30, color: 'rgba(0,0,0,0.04)' }],
  },
  iconChip: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  rowLabel: { fontFamily: fontFamily.semibold, fontSize: 14 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowValue: { fontFamily: fontFamily.regular, fontSize: 13, color: GRAY[500] },
  track: { width: 44, height: 24, borderRadius: 999, padding: 2, justifyContent: 'center' },
  knob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 4, color: 'rgba(0,0,0,0.15)' }],
  },
});
