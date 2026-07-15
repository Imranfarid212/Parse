/**
 * SearchView — the Search tab content: a search bar, then either the fan
 * carousel ("Card view") or a plain list ("List view"), chosen by a small
 * glass toggle at the bottom. Rule: when results exceed 7, the system forces
 * List view and disables the toggle (card fan only supports up to 7).
 */
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { FanCarousel, type FanItem } from '@/components/search/FanCarousel';
import { colors, radius, spacing, typography } from '@/theme/tokens';

const GLASS = isLiquidGlassAvailable();
const MAX_FAN = 7;

// 7 dummy receipts for testing the carousel.
const DUMMY: FanItem[] = [
  { id: 0, total: '45.60' },
  { id: 1, total: '12.30' },
  { id: 2, total: '89.00' },
  { id: 3, total: '7.85' },
  { id: 4, total: '142.80' },
  { id: 5, total: '23.40' },
  { id: 6, total: '58.10' },
];

function CardListToggle({ mode, onChange, disabled }: { mode: 'card' | 'list'; onChange: (m: 'card' | 'list') => void; disabled: boolean }) {
  const OPTIONS: { key: 'card' | 'list'; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
    { key: 'card', label: 'Card view', icon: 'albums-outline' },
    { key: 'list', label: 'List view', icon: 'list-outline' },
  ];
  const width = 220;
  const pad = 4;
  const segW = (width - pad * 2) / 2;
  const activeIndex = mode === 'card' ? 0 : 1;
  const pos = useSharedValue(activeIndex);

  useEffect(() => {
    pos.value = withSpring(activeIndex, { damping: 18, stiffness: 200 });
  }, [activeIndex, pos]);

  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: pad + pos.value * segW }] }));

  return (
    <View style={[styles.toggle, { width, opacity: disabled ? 0.5 : 1 }]}>
      {GLASS ? (
        <GlassView style={StyleSheet.absoluteFill} glassEffectStyle="regular" colorScheme="light" />
      ) : (
        <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFill} />
      )}
      <Animated.View style={[styles.indicator, { width: segW, height: 38, top: pad }, indicator]}>
        {GLASS ? (
          <GlassView style={StyleSheet.absoluteFill} glassEffectStyle="clear" isInteractive colorScheme="light" />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.indicatorSolid]} />
        )}
      </Animated.View>
      <View style={styles.segRow}>
        {OPTIONS.map((o) => {
          const on = o.key === mode;
          return (
            <Pressable
              key={o.key}
              disabled={disabled}
              onPress={() => onChange(o.key)}
              style={{ width: segW, height: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <Ionicons name={o.icon} size={16} color={on ? '#111' : colors.textSecondary} />
              <Text style={[styles.segLabel, on && styles.segLabelActive]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function SearchView() {
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'card' | 'list'>('card');

  const results = DUMMY; // TODO: real search results
  const forceList = results.length > MAX_FAN;
  const effectiveMode = forceList ? 'list' : mode;

  return (
    <View style={styles.root}>
      {/* Search bar */}
      <View style={[styles.searchBar, { width: width - spacing.lg * 2 }]}>
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search receipts"
          placeholderTextColor={colors.textSecondary}
          style={styles.searchInput}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      {/* Body */}
      <View style={styles.body}>
        {effectiveMode === 'card' ? (
          <FanCarousel items={results} />
        ) : (
          <ScrollView style={{ alignSelf: 'stretch' }} contentContainerStyle={{ paddingHorizontal: spacing.lg }}>
            {results.map((r, i) => (
              <View key={r.id} style={styles.listRow}>
                <View style={styles.listIcon}>
                  <Ionicons name="receipt-outline" size={20} color={colors.textPrimary} />
                </View>
                <Text style={styles.listLabel}>Receipt #{i + 1}</Text>
                <Text style={styles.listTotal}>${r.total}</Text>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Card / List toggle */}
      <View style={styles.toggleArea}>
        <CardListToggle mode={effectiveMode} onChange={setMode} disabled={forceList} />
        {forceList && <Text style={styles.forcedHint}>List view — more than {MAX_FAN} results</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(120,120,128,0.10)',
    marginTop: spacing.sm,
  },
  searchInput: { flex: 1, fontFamily: typography.subtitle.fontFamily, fontSize: 15, color: colors.textPrimary, padding: 0 },

  body: { flex: 1, alignSelf: 'stretch', justifyContent: 'center' },

  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  listIcon: { width: 32, alignItems: 'center' },
  listLabel: { flex: 1, fontFamily: typography.subtitle.fontFamily, fontSize: 15, color: colors.textPrimary },
  listTotal: { fontFamily: typography.button.fontFamily, fontSize: 15, color: colors.textPrimary },

  toggleArea: { alignItems: 'center', paddingVertical: spacing.md, gap: 6 },
  toggle: { height: 46, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: 'rgba(120,120,128,0.10)', justifyContent: 'center' },
  segRow: { flexDirection: 'row', paddingHorizontal: 4 },
  indicator: { position: 'absolute', left: 0, borderRadius: radius.pill, overflow: 'hidden' },
  indicatorSolid: { backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: radius.pill },
  segLabel: { fontFamily: typography.subtitle.fontFamily, fontSize: 13, color: colors.textSecondary },
  segLabelActive: { color: '#111', fontFamily: typography.button.fontFamily },
  forcedHint: { fontSize: 11, color: colors.textSecondary },
});
