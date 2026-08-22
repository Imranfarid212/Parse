/**
 * Menu primitives — the shared building blocks for the Export / Search / Plan /
 * Settings screens.
 *
 * These used to carry their own Tailwind grey scale, which is how the menu
 * drifted away from the rest of the app: four screens imported `GRAY` and none
 * of them ever touched `theme/tokens`. Everything here now reads from tokens,
 * so the menu and the onboarding/receipt screens move together.
 *
 * Two rules the whole menu follows:
 *   - selection is `colors.accent` (forest) — a chosen chip, plan, or format
 *   - a primary action is `colors.ctaBackground` (dark pill)
 * They are never swapped.
 */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';

import { makeStyles, useColors } from '@/theme/appearance';
import { radius, spacing, typography } from '@/theme/tokens';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/** Uppercase section marker. Matches the "SETUP" eyebrow on onboarding. */
export function Eyebrow({ children, style }: { children: string; style?: TextStyle }) {
  const styles = useStyles();
  return <Text style={[styles.eyebrow, style]}>{children}</Text>;
}

/** Rounded card with a hairline border + soft shadow; rows stack inside. */
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const styles = useStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Hairline divider, inset past the icon chip so it aligns with the label. */
export function Divider({ inset = 60 }: { inset?: number }) {
  const colors = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: inset }} />;
}

/** Round icon chip that leads a row. */
export function IconChip({
  icon,
  color,
  bg,
}: {
  icon: FeatherName;
  color?: string;
  bg?: string;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={[styles.iconChip, { backgroundColor: bg ?? colors.surfaceSubtle }]}>
      <Feather name={icon} size={16} color={color ?? colors.textSecondary} />
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
  labelColor,
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
  const styles = useStyles();
  const colors = useColors();

  const body = (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <IconChip icon={icon} color={iconColor} bg={iconBg} />
        <Text style={[styles.rowLabel, { color: labelColor ?? colors.textPrimary }]}>{label}</Text>
      </View>
      <View style={styles.rowRight}>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        {right ?? (onPress ? <Feather name="chevron-right" size={16} color={colors.textFaint} /> : null)}
      </View>
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      style={({ pressed }) => pressed && { backgroundColor: colors.surfaceSubtle }}
    >
      {body}
    </Pressable>
  );
}

/** Pill toggle: grey when off, `activeColor` (default forest) when on. */
export function Toggle({
  value,
  onValueChange,
  activeColor,
  label,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  activeColor?: string;
  label?: string;
}) {
  const styles = useStyles();
  const colors = useColors();
  const p = useDerivedValue(() => withTiming(value ? 1 : 0, { duration: 200 }));

  // Both branches must be plain strings: Reanimated's normalizeColor returns
  // null for anything that is not a string or a number, which is what left this
  // track with no background at all while the tokens were native colour objects.
  const onColor = activeColor ?? colors.accent;
  const offColor = colors.borderStrong;
  const track = useAnimatedStyle(() => ({
    backgroundColor: p.value > 0.5 ? onColor : offColor,
  }));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: p.value * 20 }] }));

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
    >
      <Animated.View style={[styles.track, track]}>
        <Animated.View style={[styles.knob, knob]} />
      </Animated.View>
    </Pressable>
  );
}

/**
 * The one primary action button — the dark pill from onboarding's "Continue to
 * camera". Export's Generate, Plan's Subscribe and the filter sheet's Apply are
 * all the same control, so they are all this.
 */
export function PrimaryButton({
  label,
  icon,
  busy = false,
  busyLabel,
  onPress,
  style,
}: {
  label: string;
  icon?: FeatherName;
  busy?: boolean;
  busyLabel?: string;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy }}
      style={({ pressed }) => [styles.primaryBtn, (pressed || busy) && styles.primaryBtnPressed, style]}
    >
      <View style={styles.primaryInner}>
        {busy ? (
          <ActivityIndicator size="small" color={colors.ctaText} />
        ) : icon ? (
          <Feather name={icon} size={18} color={colors.ctaText} />
        ) : null}
        <Text style={styles.primaryText}>{busy ? (busyLabel ?? label) : label}</Text>
      </View>
    </Pressable>
  );
}

export type SegmentOption<T extends string> = { key: T; label: string; icon?: FeatherName; activeColor?: string };

/**
 * Segmented control with a sliding white indicator. Export's PDF/Excel and
 * Plan's Pro/Max were two near-identical hand-rolled copies; this is both.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  compact = false,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (next: T) => void;
  compact?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [trackW, setTrackW] = React.useState(0);
  const index = Math.max(0, options.findIndex((option) => option.key === value));
  const segW = trackW > 0 ? (trackW - SEG_PAD * 2) / options.length : 0;
  const p = useDerivedValue(() => withTiming(index, { duration: 220 }));
  const indicator = useAnimatedStyle(() => ({ width: segW, transform: [{ translateX: p.value * segW }] }));

  return (
    <View style={styles.segTrack} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
      {segW > 0 && <Animated.View style={[styles.segIndicator, indicator]} />}
      {options.map((option) => {
        const on = option.key === value;
        return (
          <Pressable
            key={option.key}
            style={[styles.segBtn, compact && styles.segBtnCompact]}
            onPress={() => onChange(option.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={option.label}
          >
            {option.icon ? (
              <Feather
                name={option.icon}
                size={16}
                color={on ? (option.activeColor ?? colors.accent) : colors.textFaint}
              />
            ) : null}
            <Text style={[styles.segLabel, { color: on ? colors.textPrimary : colors.textSecondary }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Pill chip. Selected chips are forest, matching onboarding's green checks. */
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected ? styles.chipOn : styles.chipOff]}
    >
      <Text style={[styles.chipText, { color: selected ? colors.ctaText : colors.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

const SEG_PAD = 4;

const useStyles = makeStyles((colors, elevation) => ({
  eyebrow: {
    ...typography.eyebrow,
    color: colors.textFaint,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    boxShadow: elevation.card,
  },
  iconChip: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  row: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexShrink: 1 },
  rowLabel: { ...typography.row },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowValue: { ...typography.meta, color: colors.textSecondary },

  track: { width: 44, height: 24, borderRadius: radius.pill, padding: 2, justifyContent: 'center' },
  knob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surface,
    boxShadow: elevation.raised,
  },

  primaryBtn: {
    height: 54,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.ctaBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnPressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  primaryInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  primaryText: { ...typography.button, color: colors.ctaText },

  segTrack: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.border,
    padding: SEG_PAD,
  },
  segIndicator: {
    position: 'absolute',
    top: SEG_PAD,
    bottom: SEG_PAD,
    left: SEG_PAD,
    borderRadius: radius.sm + 4,
    borderCurve: 'continuous',
    // In light, `surfaceRaised` is white and `raisedBorder` transparent, so
    // this is the same white pill it always was, separated by its shadow. In
    // dark the shadow is invisible against the track, so the fill lifts and
    // the border becomes the thing that actually marks which segment is on.
    backgroundColor: colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.raisedBorder,
    boxShadow: elevation.raised,
  },
  segBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
  },
  segBtnCompact: { paddingVertical: 8 },
  segLabel: { ...typography.label },

  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill },
  chipOn: { backgroundColor: colors.accent },
  chipOff: { backgroundColor: colors.surfaceSubtle, borderWidth: 1, borderColor: colors.border },
  chipText: { ...typography.label },
}));
