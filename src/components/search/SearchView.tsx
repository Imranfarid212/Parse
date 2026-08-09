import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import type { ReceiptView, SearchQuery } from '@/../packages/contracts/src';
import { PrimaryButton, Segmented, type SegmentOption } from '@/components/menu/primitives';
import {
  filtersActive,
  ReceiptFilterSheet,
  type ReceiptFilters,
} from '@/components/receipt/ReceiptFilterSheet';
import { ReceiptEditorModal } from '@/components/receipt/receipt-editor-modal';
import { FanCarousel, type FanItem } from '@/components/search/FanCarousel';
import { SleuthDog } from '@/components/search/SleuthDog';
import { useAuth } from '@/lib/auth/auth-context';
import {
  restoreManagedReceipt,
  softDeleteManagedReceipt,
  updateManagedReceipt,
  type ManagedReceipt,
} from '@/lib/receipts/management';
import * as receiptStore from '@/lib/receipts/store';
import { useRealtimeReceipts } from '@/lib/receipts/use-realtime-receipts';
import { isCategory, type ReceiptFields } from '@/lib/receipts/types';
import { colors, radius, spacing, typography } from '@/theme/tokens';

const SEARCH_DEBOUNCE_MS = 300;
const UNDO_WINDOW_MS = 5_000;

/** Card / list is a choice between two views, so it reads as a segmented
 *  control here rather than the on/off switch it used to be. */
const VIEW_OPTIONS: SegmentOption<ReceiptView>[] = [
  { key: 'card', label: 'Card', icon: 'grid' },
  { key: 'list', label: 'List', icon: 'list' },
];

const formatTotal = (receipt: ManagedReceipt) => `${receipt.fields.currency} ${receipt.fields.total.toFixed(2)}`;

export function SearchView({ onOpenPlan: _onOpenPlan }: { onOpenPlan?: () => void } = {}) {
  const auth = useAuth();
  const [text, setText] = useState('');
  const [debouncedText, setDebouncedText] = useState('');
  const [view, setView] = useState<ReceiptView>('card');
  const [filters, setFilters] = useState<ReceiptFilters>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedReceipt | null>(null);
  const [deleted, setDeleted] = useState<ManagedReceipt | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDeletesRef = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedText(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    void receiptStore.getReceiptViewPreference().then(setView);
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  const query = useMemo<SearchQuery>(
    () => ({ ...filters, text: debouncedText || undefined, view }),
    [debouncedText, filters, view],
  );
  const { receipts, setReceipts, loading, error, reload } = useRealtimeReceipts(query);
  const fanItems = useMemo<FanItem[]>(
    () => receipts.map((receipt) => ({
      id: receipt.id,
      total: formatTotal(receipt),
      details: {
        merchant: receipt.fields.store,
        date: receipt.fields.date,
        category: receipt.fields.category,
        currency: receipt.fields.currency,
        items: receipt.fields.items.map((item) => ({ name: item.name, amount: item.amount })),
      },
    })),
    [receipts],
  );

  const changeView = (next: ReceiptView) => {
    setView(next);
    void receiptStore.setReceiptViewPreference(next);
  };

  const saveReceipt = async (fields: ReceiptFields) => {
    if (!editing) return;
    const previous = editing;
    const optimistic = { ...editing, fields, updatedAt: new Date().toISOString() };
    setReceipts((current) => current.map((receipt) => (receipt.id === editing.id ? optimistic : receipt)));
    setEditing(optimistic);
    try {
      await updateManagedReceipt(previous, fields, auth.categories);
    } catch (cause) {
      setReceipts((current) => current.map((receipt) => (receipt.id === previous.id ? previous : receipt)));
      setEditing(previous);
      throw cause;
    }
  };

  const deleteReceipt = (receipt: ManagedReceipt) => {
    Alert.alert('Delete receipt?', 'This receipt will be removed from Search and Recents.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setReceipts((current) => current.filter((candidate) => candidate.id !== receipt.id));
          setDeleted(receipt);
          if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
          undoTimerRef.current = setTimeout(() => setDeleted(null), UNDO_WINDOW_MS);
          const request = softDeleteManagedReceipt(receipt);
          pendingDeletesRef.current.set(receipt.id, request);
          void request
            .catch((cause) => {
              if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
              setDeleted(null);
              setReceipts((current) => current.some((candidate) => candidate.id === receipt.id)
                ? current
                : [receipt, ...current].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
              Alert.alert('Could not delete receipt', cause instanceof Error ? cause.message : 'Please try again.');
            })
            .finally(() => setTimeout(() => pendingDeletesRef.current.delete(receipt.id), UNDO_WINDOW_MS + 1_000));
        },
      },
    ]);
  };

  const undoDelete = async () => {
    if (!deleted) return;
    const receipt = deleted;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setDeleted(null);
    setReceipts((current) => [receipt, ...current].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    const pendingDelete = pendingDeletesRef.current.get(receipt.id);
    if (pendingDelete) {
      try {
        await pendingDelete;
      } catch {
        // The delete rollback already restored the optimistic row.
        return;
      }
    }
    try {
      await restoreManagedReceipt(receipt);
      await reload();
    } catch (cause) {
      setReceipts((current) => current.filter((candidate) => candidate.id !== receipt.id));
      Alert.alert('Could not restore receipt', cause instanceof Error ? cause.message : 'Please try again.');
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        <Pressable
          style={[styles.filterPill, filtersActive(filters) && styles.filterPillActive]}
          onPress={() => setFiltersOpen(true)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={filtersActive(filters) ? 'Filters active, edit filters' : 'Edit filters'}
        >
          <Feather name="sliders" size={14} color={filtersActive(filters) ? colors.ctaText : colors.textSecondary} />
          <Text style={[styles.filterText, filtersActive(filters) && { color: colors.ctaText }]}>
            {filtersActive(filters) ? 'Filtered' : 'All Receipts'}
          </Text>
        </Pressable>

        <View style={styles.viewToggle}>
          <Segmented value={view} options={VIEW_OPTIONS} onChange={changeView} compact />
        </View>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Merchant, note, or line item description"
          placeholderTextColor={colors.textSecondary}
          style={styles.searchInput}
          returnKeyType="search"
        />
        {text ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setText('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.body}>
        {loading && receipts.length === 0 ? (
          <View style={styles.center}><ActivityIndicator color={colors.textPrimary} /></View>
        ) : error && receipts.length === 0 ? (
          <View style={styles.center}>
            <Text selectable style={styles.errorText}>{error}</Text>
            <PrimaryButton label="Try again" onPress={() => void reload()} />
          </View>
        ) : receipts.length === 0 ? (
          <Animated.View entering={FadeIn.duration(250)} style={styles.center}>
            <SleuthDog size={220} fadeColor={colors.background} />
            <Text style={styles.emptyText}>No receipts found</Text>
          </Animated.View>
        ) : view === 'card' ? (
          <View style={styles.fanWrap}>
            <FanCarousel
              items={fanItems}
              onOpenItem={(id) => {
                const receipt = receipts.find((candidate) => candidate.id === id);
                if (receipt) setEditing(receipt);
              }}
              onDeleteItem={(id) => {
                const receipt = receipts.find((candidate) => candidate.id === id);
                if (receipt) deleteReceipt(receipt);
              }}
            />
          </View>
        ) : (
          <FlatList
            data={receipts}
            keyExtractor={(receipt) => receipt.id}
            renderItem={({ item }) => <ManagedReceiptRow receipt={item} onEdit={setEditing} onDelete={deleteReceipt} />}
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
          />
        )}
      </View>

      {deleted ? (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(180)} style={styles.snackbar}>
          <Text style={styles.snackbarText}>Receipt deleted</Text>
          <Pressable onPress={() => void undoDelete()} hitSlop={10}><Text style={styles.undoText}>Undo</Text></Pressable>
        </Animated.View>
      ) : null}

      <ReceiptFilterSheet
        visible={filtersOpen}
        value={filters}
        categories={auth.categories.filter((category) => auth.selectedCategoryIds.includes(category.id) || category.is_system)}
        defaultCurrency={auth.profile?.default_currency ?? 'USD'}
        onClose={() => setFiltersOpen(false)}
        onApply={(next) => { setFilters(next); setFiltersOpen(false); }}
      />
      <ReceiptEditorModal
        receipt={editing}
        onClose={() => setEditing(null)}
        onSave={saveReceipt}
        categoryOptions={auth.categories
          .filter((category) => auth.selectedCategoryIds.includes(category.id) || category.is_system)
          .map((category) => category.name)
          .filter(isCategory)}
      />
    </View>
  );
}

type ReceiptItemProps = { receipt: ManagedReceipt; onEdit: (receipt: ManagedReceipt) => void; onDelete: (receipt: ManagedReceipt) => void };

function ManagedReceiptRow({ receipt, onEdit, onDelete }: ReceiptItemProps) {
  return (
    <Pressable style={styles.listRow} onPress={() => onEdit(receipt)}>
      <View style={styles.listIcon}><Ionicons name="receipt-outline" size={18} color={colors.textSecondary} /></View>
      <View style={styles.listText}>
        <Text selectable numberOfLines={1} style={styles.listLabel}>{receipt.fields.store}</Text>
        <Text selectable numberOfLines={1} style={styles.listMeta}>{[receipt.fields.date, receipt.fields.category].filter(Boolean).join(' • ')}</Text>
      </View>
      <Text selectable style={styles.listTotal}>{formatTotal(receipt)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${receipt.fields.store}`} onPress={() => onDelete(receipt)} hitSlop={10}>
        <Ionicons name="trash-outline" size={18} color={colors.danger} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterPillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterText: { ...typography.label, color: colors.textPrimary },
  viewToggle: { width: 156 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 48,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, ...typography.row, color: colors.textPrimary, padding: 0 },
  body: { flex: 1, marginTop: spacing.sm },
  fanWrap: { flex: 1, paddingTop: 30 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  emptyText: { ...typography.row, color: colors.textSecondary, marginTop: -28 },
  errorText: { ...typography.meta, color: colors.danger, textAlign: 'center' },
  listRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  listIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listText: { flex: 1, minWidth: 0 },
  listLabel: { ...typography.row, color: colors.textPrimary },
  listMeta: { marginTop: 2, ...typography.meta, fontSize: 12, color: colors.textSecondary },
  listTotal: { ...typography.row, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  snackbar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.ctaBackground,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    boxShadow: '0 6px 18px rgba(12,13,16,0.24)',
  },
  snackbarText: { ...typography.meta, fontSize: 14, color: colors.ctaText },
  undoText: { ...typography.button, fontSize: 14, color: colors.ctaText },
});
