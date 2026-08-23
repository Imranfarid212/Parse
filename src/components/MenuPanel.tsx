/**
 * MenuPanel — the menu content that lives to the RIGHT of the camera in a
 * horizontal strip (CameraScreen slides the strip so this pushes the camera
 * out of the way). Bottom holds a 4-tab toggle built on REAL native iOS glass
 * via expo-glass-effect's GlassView (UIGlassEffect / Liquid Glass), with an
 * expo-blur fallback on platforms without it.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { ExportScreen } from '@/components/menu/ExportScreen';
import { PlanScreen } from '@/components/menu/PlanScreen';
import { SettingsScreen, type SettingsSubScreen } from '@/components/menu/SettingsScreen';
import { SearchView } from '@/components/search/SearchView';
import { SPRING_SETTLE } from '@/theme/motion';
import { fontFamily, radius, spacing, typography } from '@/theme/tokens';
import { makeStyles, useAppAppearance, useColors } from '@/theme/appearance';

const GLASS = isLiquidGlassAvailable();
const PAD = 5;
const TAB_H = 46;

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const TABS: { label: string; icon: IconName }[] = [
  { label: 'Export', icon: 'download-outline' },
  { label: 'Search', icon: 'search-outline' },
  { label: 'Plan', icon: 'sparkles-outline' },
  { label: 'Settings', icon: 'settings-outline' },
];

/** Header title shown per tab, where it differs from the nav label. */
const HEADER_TITLE: Record<string, string> = { Plan: 'Subscription' };

function GlassTabs({ active, onChange, width, isDark }: { active: number; onChange: (i: number) => void; width: number; isDark: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const tabW = (width - PAD * 2) / TABS.length;
  const pos = useSharedValue(active);

  useEffect(() => {
    pos.value = withSpring(active, SPRING_SETTLE);
  }, [active, pos]);

  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: PAD + pos.value * tabW }] }));

  return (
    <View style={[styles.tabsWrap, { width, height: TAB_H + PAD * 2 }]}>
      {GLASS ? (
        <GlassView style={StyleSheet.absoluteFill} glassEffectStyle="regular" colorScheme={isDark ? 'dark' : 'light'} />
      ) : (
        <BlurView intensity={40} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      )}

      <Animated.View style={[styles.indicator, { width: tabW, height: TAB_H, top: PAD }, indicator]}>
        {GLASS ? (
          <GlassView style={StyleSheet.absoluteFill} glassEffectStyle="clear" isInteractive colorScheme={isDark ? 'dark' : 'light'} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.indicatorSolid]} />
        )}
      </Animated.View>

      <View style={[styles.tabsRow, { paddingHorizontal: PAD }]}>
        {TABS.map((t, i) => {
          const on = i === active;
          return (
            <Pressable key={t.label} onPress={() => onChange(i)} style={{ width: tabW, height: TAB_H, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
              <Ionicons name={t.icon} size={20} color={on ? colors.textPrimary : colors.textSecondary} />
              <Text style={[styles.tabLabel, on && styles.tabLabelActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function MenuPanel({ onClose, initialTab = 0 }: { onClose: () => void; initialTab?: number }) {
  const { isDark } = useAppAppearance();
  const styles = useStyles();
  const colors = useColors();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState(initialTab);
  /**
   * Set while a tab is showing something other than itself (Settings ->
   * Billing / About Us / Delete Account). The header is owned here, so a
   * sub-screen has to report itself up for the title and the X to be right.
   */
  const [subScreen, setSubScreen] = useState<SettingsSubScreen | null>(null);
  // Stable identity: SettingsScreen reports through an effect, and a callback
  // that changed every render would make that effect loop.
  const handleSubScreen = useCallback((next: SettingsSubScreen | null) => setSubScreen(next), []);

  const changeTab = useCallback((index: number) => {
    setSubScreen(null);
    setActive(index);
  }, []);

  // A sub-screen names the header. Otherwise the tab does.
  const title = subScreen?.title ?? HEADER_TITLE[TABS[active].label] ?? TABS[active].label;

  return (
    <View style={[styles.panel, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {/* One level at a time. Deep in a sub-screen the X pops back to the tab
            that launched it; from a tab it closes the menu. Dropping the user
            straight out to the camera from two levels in loses their place for
            no reason — and it is the same control either way, so it never
            leaves them without an exit. */}
        <Pressable
          onPress={subScreen ? subScreen.onBack : onClose}
          hitSlop={12}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel={subScreen ? `Back to ${TABS[active].label}` : 'Close menu'}
        >
          <Ionicons name="close" size={24} color={colors.textPrimary} />
        </Pressable>
      </View>

      <View style={styles.content}>
        {active === 0 ? (
          <ExportScreen />
        ) : active === 1 ? (
          <SearchView onOpenPlan={() => changeTab(2)} />
        ) : active === 2 ? (
          <PlanScreen />
        ) : (
          <SettingsScreen onSubScreen={handleSubScreen} />
        )}
      </View>

      <View style={[styles.toggleArea, { paddingBottom: insets.bottom + spacing.md }]}>
        <GlassTabs active={active} onChange={changeTab} width={width - spacing.lg * 2} isDark={isDark} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors, elevation, isDark) => ({
  panel: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    minHeight: 56,
  },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.heading, color: colors.textPrimary },
  content: { flex: 1 },

  toggleArea: { paddingHorizontal: spacing.lg },
  tabsWrap: { borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.surfaceSubtle, justifyContent: 'center' },
  tabsRow: { flexDirection: 'row' },
  indicator: { position: 'absolute', left: 0, borderRadius: radius.pill, overflow: 'hidden' },
  // A fixed-alpha wash over the blur, not a semantic colour: near-opaque white
  // reads as a raised pill on light, but on dark the same value would be a
  // glaring slab, so dark gets a faint lift instead.
  indicatorSolid: {
    backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.95)',
    borderRadius: radius.pill,
  },
  tabLabel: { fontFamily: fontFamily.medium, fontSize: 11, color: colors.textSecondary },
  tabLabelActive: { color: colors.textPrimary, fontFamily: fontFamily.semibold },
}));
