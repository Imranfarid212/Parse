/**
 * SearchView — the Search tab content. A header row (a "filter" pill on the
 * left, a Card/List view toggle on the right), a search bar, then the results:
 * the fan carousel ("Card view") or a plain list ("List view"). When a query
 * matches nothing, the sleuth-dog empty state shows instead. Rule: when results
 * exceed 7, the system forces List view and disables the toggle (the card fan
 * only supports up to 7).
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';

import { GRAY, Toggle } from '@/components/menu/primitives';
import { FanCarousel, type FanItem } from '@/components/search/FanCarousel';
import { SleuthDog } from '@/components/search/SleuthDog';
import { colors, radius, spacing, typography } from '@/theme/tokens';

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

export function SearchView() {
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'card' | 'list'>('card');

  // A trimmed query filters the dummy set (by total). Empty query shows all.
  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return DUMMY;
    return DUMMY.filter((r) => r.total.includes(q));
  }, [query]);

  const empty = results.length === 0;
  const forceList = results.length > MAX_FAN;
  const effectiveMode = forceList ? 'list' : mode;

  return (
    <View style={styles.root}>
      {/* Header row: filter pill + view toggle */}
      <View style={[styles.headerRow, { width: width - spacing.lg * 2 }]}>
        <Pressable style={styles.filterPill} hitSlop={6}>
          <Text style={styles.filterText}>All Receipts</Text>
          <Feather name="chevron-down" size={14} color={GRAY[500]} />
        </Pressable>

        <View style={styles.viewToggle}>
          <Feather
            name={effectiveMode === 'card' ? 'grid' : 'list'}
            size={14}
            color={GRAY[500]}
          />
          <Text style={styles.viewLabel}>{effectiveMode === 'card' ? 'Card view' : 'List view'}</Text>
          <Toggle
            value={effectiveMode === 'card'}
            onValueChange={(v) => !forceList && setMode(v ? 'card' : 'list')}
          />
        </View>
      </View>

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
        {empty ? (
          <Animated.View entering={FadeIn.duration(300)} style={styles.emptyWrap}>
            <SleuthDog size={240} fadeColor={colors.background} />
            <Text style={styles.emptyText}>No results found</Text>
          </Animated.View>
        ) : effectiveMode === 'card' ? (
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(120,120,128,0.10)',
  },
  filterText: { fontFamily: typography.button.fontFamily, fontSize: 13, color: colors.textPrimary },
  viewToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  viewLabel: { fontFamily: typography.subtitle.fontFamily, fontSize: 12, color: GRAY[500] },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: GRAY[200],
    boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 2, color: 'rgba(0,0,0,0.04)' }],
  },
  searchInput: { flex: 1, fontFamily: typography.subtitle.fontFamily, fontSize: 15, color: colors.textPrimary, padding: 0 },

  body: { flex: 1, alignSelf: 'stretch', justifyContent: 'center' },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: -40 },
  emptyText: { fontFamily: typography.subtitle.fontFamily, fontSize: 15, color: GRAY[500], marginTop: -24 },

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
});
