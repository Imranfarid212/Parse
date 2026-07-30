/**
 * SearchView — the Search tab content. A header row (a "filter" pill on the
 * left, a Card/List view toggle on the right), a search bar, then the results:
 * the fan carousel ("Card view") or a plain list ("List view"). When a query
 * matches nothing, the empty state shows instead. Rule: when results
 * exceed 7, the system forces List view and disables the toggle (the card fan
 * shows the latest 5 when there are more receipts.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';

import { GRAY, Toggle } from '@/components/menu/primitives';
import { FanCarousel, type FanItem } from '@/components/search/FanCarousel';
import { SleuthDog } from '@/components/search/SleuthDog';
import { listRecent } from '@/lib/receipts/store';
import type { ReceiptRow } from '@/lib/receipts/types';
import { colors, radius, spacing, typography } from '@/theme/tokens';

const MAX_FAN = 5;

const formatTotal = (row: ReceiptRow) => {
  const fields = row.fields;
  if (!fields) return '...';
  const amount = Number.isFinite(fields.total) ? fields.total.toFixed(2) : '0.00';
  return `${fields.currency || 'USD'} ${amount}`;
};

const receiptTitle = (row: ReceiptRow) => {
  const store = row.fields?.store?.trim();
  if (store) return store;
  if (row.status === 'llm_failed_retryable' || row.status === 'pending_extract') return 'Processing receipt';
  return 'Receipt';
};

const receiptMeta = (row: ReceiptRow) => {
  const parts = [row.fields?.date, row.fields?.category].filter(Boolean);
  return parts.length > 0 ? parts.join(' • ') : row.status.replace(/_/g, ' ');
};

const duplicateBadgeLabel = (row: ReceiptRow, similarDedupeKeys: Set<string>) => {
  const key = similarGroupKey(row);
  if (!row.duplicateOf && (!key || !similarDedupeKeys.has(key))) return null;
  return row.duplicateMatchStrength === 'strong' ? 'Duplicate receipt' : 'Similar receipt';
};

const similarGroupKey = (row: ReceiptRow) => {
  if (row.dedupeKey) return row.dedupeKey;
  const fields = row.fields;
  if (!fields?.date || !fields.currency || !Number.isFinite(fields.total) || fields.total <= 0) return null;
  return [fields.date, fields.currency.toUpperCase(), String(Math.round(fields.total * 100))].join('|');
};

const normalizeMerchant = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(pvt|private|ltd|limited|inc|llc|store|market)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const softSimilarGroupKey = (row: ReceiptRow) => {
  const fields = row.fields;
  if (!fields?.store || !fields.currency || !Number.isFinite(fields.total) || fields.total <= 0) return null;
  const merchant = normalizeMerchant(fields.store);
  if (!merchant) return null;
  return [merchant, fields.currency.toUpperCase(), String(Math.round(fields.total * 100))].join('|');
};

const searchableText = (row: ReceiptRow) =>
  [
    row.fields?.store,
    row.fields?.date,
    row.fields?.currency,
    row.fields?.total,
    row.fields?.category,
    row.fields?.handwritten_notes,
    ...(row.fields?.items ?? []),
    row.status,
  ]
    .filter((value) => value !== null && value !== undefined)
    .join(' ')
    .toLowerCase();

export function SearchView() {
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'card' | 'list'>('card');
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    listRecent(50)
      .then((recent) => {
        if (alive) setRows(recent);
      })
      .catch((error) => {
        console.warn('[recents] failed to load local receipts', error);
        if (alive) setRows([]);
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => searchableText(row).includes(q));
  }, [query, rows]);

  const fanItems = useMemo<FanItem[]>(
    () => results.slice(0, MAX_FAN).map((row) => ({ id: row.id, total: formatTotal(row) })),
    [results],
  );
  const similarDedupeKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = similarGroupKey(row);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  }, [rows]);
  const softSimilarKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = softSimilarGroupKey(row);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  }, [rows]);

  const empty = results.length === 0;

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
            name={mode === 'card' ? 'grid' : 'list'}
            size={14}
            color={GRAY[500]}
          />
          <Text style={styles.viewLabel}>{mode === 'card' ? 'Card view' : 'List view'}</Text>
          <Toggle
            value={mode === 'card'}
            onValueChange={(v) => setMode(v ? 'card' : 'list')}
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
            <Text style={styles.emptyText}>{loaded ? 'No receipts found' : 'Loading receipts'}</Text>
          </Animated.View>
        ) : mode === 'card' ? (
          <FanCarousel items={fanItems} />
        ) : (
          <ScrollView style={{ alignSelf: 'stretch' }} contentContainerStyle={{ paddingHorizontal: spacing.lg }}>
            {results.map((row) => (
              <ReceiptListRow key={row.id} row={row} similarDedupeKeys={similarDedupeKeys} softSimilarKeys={softSimilarKeys} />
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function ReceiptListRow({
  row,
  similarDedupeKeys,
  softSimilarKeys,
}: {
  row: ReceiptRow;
  similarDedupeKeys: Set<string>;
  softSimilarKeys: Set<string>;
}) {
  const badge = duplicateBadgeLabel(row, similarDedupeKeys) ?? (softSimilarKeys.has(softSimilarGroupKey(row) ?? '') ? 'Similar receipt' : null);
  return (
    <View style={styles.listRow}>
      <View style={styles.listIcon}>
        <Ionicons name="receipt-outline" size={20} color={colors.textPrimary} />
      </View>
      <View style={styles.listText}>
        <View style={styles.titleRow}>
          <Text style={styles.listLabel} numberOfLines={2}>{receiptTitle(row)}</Text>
          {badge && (
            <View style={styles.duplicateBadge}>
              <Text style={styles.duplicateText}>{badge}</Text>
            </View>
          )}
        </View>
        <Text style={styles.listMeta} numberOfLines={1}>{receiptMeta(row)}</Text>
      </View>
      <Text style={styles.listTotal}>{formatTotal(row)}</Text>
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
  listText: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  listLabel: { flex: 1, minWidth: 0, fontFamily: typography.subtitle.fontFamily, fontSize: 15, color: colors.textPrimary },
  listMeta: { marginTop: 2, fontFamily: typography.subtitle.fontFamily, fontSize: 12, color: colors.textSecondary },
  duplicateBadge: {
    flexShrink: 0,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  duplicateText: { fontFamily: typography.button.fontFamily, fontSize: 10, color: '#92400E' },
  listTotal: { fontFamily: typography.button.fontFamily, fontSize: 15, color: colors.textPrimary },
});
