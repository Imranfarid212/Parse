import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import type { ReceiptView, SearchQuery } from '@/../packages/contracts/src';
import { searchQuerySchema } from '@/../packages/contracts/src';
import { GRAY, Toggle } from '@/components/menu/primitives';
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
import { colors, fontFamily, radius, spacing, typography } from '@/theme/tokens';

const SEARCH_DEBOUNCE_MS = 300;
const UNDO_WINDOW_MS = 5_000;

type DateFilterKey = 'date_from' | 'date_to';

type Filters = Omit<SearchQuery, 'text' | 'view'>;

const formatTotal = (receipt: ManagedReceipt) => `${receipt.fields.currency} ${receipt.fields.total.toFixed(2)}`;
const filtersActive = (filters: Filters) =>
  Boolean(filters.date_from || filters.date_to || filters.category_ids?.length || filters.amount_min !== undefined || filters.amount_max !== undefined);

const toLocalDate = (isoDate?: string) => {
  if (!isoDate) return undefined;
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day, 12);
};

const toIsoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const today = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
};

const formatFilterDate = (isoDate?: string) => {
  const date = toLocalDate(isoDate);
  return date?.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) ?? 'Any date';
};

export function SearchView({ onOpenPlan: _onOpenPlan }: { onOpenPlan?: () => void } = {}) {
  const auth = useAuth();
  const [text, setText] = useState('');
  const [debouncedText, setDebouncedText] = useState('');
  const [view, setView] = useState<ReceiptView>('card');
  const [filters, setFilters] = useState<Filters>({});
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
        <Pressable style={[styles.filterPill, filtersActive(filters) && styles.filterPillActive]} onPress={() => setFiltersOpen(true)} hitSlop={6}>
          <Feather name="sliders" size={14} color={filtersActive(filters) ? '#FFFFFF' : GRAY[500]} />
          <Text style={[styles.filterText, filtersActive(filters) && { color: '#FFFFFF' }]}>
            {filtersActive(filters) ? 'Filtered' : 'All Receipts'}
          </Text>
        </Pressable>

        <View style={styles.viewToggle}>
          <Feather name={view === 'card' ? 'grid' : 'list'} size={14} color={GRAY[500]} />
          <Text style={styles.viewLabel}>{view === 'card' ? 'Card view' : 'List view'}</Text>
          <Toggle value={view === 'card'} onValueChange={(enabled) => changeView(enabled ? 'card' : 'list')} />
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
            <Pressable style={styles.retryButton} onPress={() => void reload()}><Text style={styles.retryText}>Try again</Text></Pressable>
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

      <FilterModal
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
      <View style={styles.listIcon}><Ionicons name="receipt-outline" size={20} color={colors.textPrimary} /></View>
      <View style={styles.listText}>
        <Text selectable numberOfLines={1} style={styles.listLabel}>{receipt.fields.store}</Text>
        <Text selectable numberOfLines={1} style={styles.listMeta}>{[receipt.fields.date, receipt.fields.category].filter(Boolean).join(' • ')}</Text>
      </View>
      <Text selectable style={styles.listTotal}>{formatTotal(receipt)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${receipt.fields.store}`} onPress={() => onDelete(receipt)} hitSlop={10}>
        <Ionicons name="trash-outline" size={18} color="#B42318" />
      </Pressable>
    </Pressable>
  );
}

function FilterModal({ visible, value, categories, defaultCurrency, onClose, onApply }: {
  visible: boolean;
  value: Filters;
  categories: { id: number; name: string }[];
  defaultCurrency: string;
  onClose: () => void;
  onApply: (filters: Filters) => void;
}) {
  const [draft, setDraft] = useState<Filters>(value);
  const [minimum, setMinimum] = useState(value.amount_min?.toString() ?? '');
  const [maximum, setMaximum] = useState(value.amount_max?.toString() ?? '');
  const [activeDatePicker, setActiveDatePicker] = useState<DateFilterKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filterScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!visible) return;
    setDraft(value);
    setMinimum(value.amount_min?.toString() ?? '');
    setMaximum(value.amount_max?.toString() ?? '');
    setActiveDatePicker(null);
    setError(null);
  }, [value, visible]);

  const toggleCategory = (id: number) => {
    const selected = draft.category_ids ?? [];
    setDraft({ ...draft, category_ids: selected.includes(id) ? selected.filter((candidate) => candidate !== id) : [...selected, id] });
  };

  const apply = () => {
    const hasAmountRange = Boolean(minimum.trim() || maximum.trim());
    const next = {
      ...draft,
      amount_min: minimum.trim() ? Number(minimum) : undefined,
      amount_max: maximum.trim() ? Number(maximum) : undefined,
      amount_currency: hasAmountRange ? (draft.amount_currency || defaultCurrency) : undefined,
    };
    const parsed = searchQuerySchema.safeParse(next);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check these filters.');
      return;
    }
    onApply(parsed.data);
  };

  const selectedPickerDate = activeDatePicker === 'date_from'
    ? toLocalDate(draft.date_from) ?? toLocalDate(draft.date_to) ?? today()
    : toLocalDate(draft.date_to) ?? today();

  const selectDate = (date: Date) => {
    if (!activeDatePicker) return;
    setDraft((current) => ({ ...current, [activeDatePicker]: toIsoDate(date) }));
    setError(null);
    if (process.env.EXPO_OS === 'android') setActiveDatePicker(null);
  };

  const revealAmountFields = () => {
    requestAnimationFrame(() => filterScrollRef.current?.scrollToEnd({ animated: true }));
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'} style={styles.filterRoot}>
        <View style={styles.filterHeader}>
          <Pressable onPress={onClose}><Text style={styles.headerAction}>Cancel</Text></Pressable>
          <Text style={styles.filterTitle}>Filters</Text>
          <Pressable onPress={() => { setDraft({}); setMinimum(''); setMaximum(''); setActiveDatePicker(null); setError(null); }}>
            <Text style={styles.headerAction}>Reset</Text>
          </Pressable>
        </View>
        <ScrollView
          ref={filterScrollRef}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode={process.env.EXPO_OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.filterContent}
        >
          <FilterField label="Date range">
            <DateFilterButton
              label="From"
              value={draft.date_from}
              active={activeDatePicker === 'date_from'}
              onPress={() => setActiveDatePicker('date_from')}
              onClear={() => setDraft((current) => ({ ...current, date_from: undefined }))}
            />
            <DateFilterButton
              label="To"
              value={draft.date_to}
              active={activeDatePicker === 'date_to'}
              onPress={() => setActiveDatePicker('date_to')}
              onClear={() => setDraft((current) => ({ ...current, date_to: undefined }))}
            />
            {activeDatePicker && selectedPickerDate ? (
              <View style={styles.datePickerPanel}>
                <View style={styles.datePickerHeader}>
                  <Text style={styles.datePickerTitle}>Select {activeDatePicker === 'date_from' ? 'start' : 'end'} date</Text>
                  {process.env.EXPO_OS === 'ios' ? (
                    <Pressable accessibilityRole="button" onPress={() => setActiveDatePicker(null)} hitSlop={8}>
                      <Text style={styles.datePickerDone}>Done</Text>
                    </Pressable>
                  ) : null}
                </View>
                <DateTimePicker
                  testID={`${activeDatePicker}-picker`}
                  value={selectedPickerDate}
                  mode="date"
                  display={process.env.EXPO_OS === 'ios' ? 'inline' : 'default'}
                  presentation={process.env.EXPO_OS === 'android' ? 'dialog' : 'inline'}
                  minimumDate={activeDatePicker === 'date_to' ? toLocalDate(draft.date_from) : undefined}
                  maximumDate={activeDatePicker === 'date_from' ? toLocalDate(draft.date_to) ?? today() : today()}
                  accentColor={colors.accent}
                  onValueChange={(_event, date) => selectDate(date)}
                  onDismiss={() => setActiveDatePicker(null)}
                />
              </View>
            ) : null}
            <Text style={styles.currencyHint}>End date cannot be before the start date or later than today.</Text>
          </FilterField>
          <FilterField label="Categories">
            <View style={styles.chips}>{categories.map((category) => {
              const selected = draft.category_ids?.includes(category.id);
              return <Pressable key={category.id} onPress={() => toggleCategory(category.id)} style={[styles.chip, selected && styles.chipSelected]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{category.name}</Text></Pressable>;
            })}</View>
          </FilterField>
          <FilterField label="Amount range">
            <TextInput style={styles.filterInput} value={draft.amount_currency ?? defaultCurrency} onChangeText={(currency) => setDraft({ ...draft, amount_currency: currency.trim().toUpperCase() })} onFocus={revealAmountFields} maxLength={3} autoCapitalize="characters" placeholder="USD" placeholderTextColor={colors.textFaint} />
            <View style={styles.inlineFields}>
              <TextInput style={[styles.filterInput, { flex: 1 }]} value={minimum} onChangeText={setMinimum} onFocus={revealAmountFields} keyboardType="decimal-pad" placeholder="Minimum" placeholderTextColor={colors.textFaint} />
              <TextInput style={[styles.filterInput, { flex: 1 }]} value={maximum} onChangeText={setMaximum} onFocus={revealAmountFields} keyboardType="decimal-pad" placeholder="Maximum" placeholderTextColor={colors.textFaint} />
            </View>
            <Text style={styles.currencyHint}>Amounts are compared only within {draft.amount_currency || defaultCurrency}.</Text>
          </FilterField>
          {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
          <Pressable style={styles.applyButton} onPress={apply}><Text style={styles.applyText}>Apply filters</Text></Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={{ gap: spacing.sm }}><Text style={styles.filterLabel}>{label}</Text>{children}</View>;
}

function DateFilterButton({ label, value, active, onPress, onClear }: {
  label: string;
  value?: string;
  active: boolean;
  onPress: () => void;
  onClear: () => void;
}) {
  return (
    <View style={[styles.dateFilterRow, active && styles.dateFilterRowActive]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} date, ${formatFilterDate(value)}`}
        accessibilityHint="Opens a calendar"
        style={styles.dateFilterMain}
        onPress={onPress}
      >
        <View>
          <Text style={styles.dateFilterLabel}>{label}</Text>
          <Text style={[styles.dateFilterValue, !value && styles.dateFilterPlaceholder]}>{formatFilterDate(value)}</Text>
        </View>
        <Ionicons name="calendar-outline" size={20} color={colors.accent} />
      </Pressable>
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Clear ${label.toLowerCase()} date`}
          onPress={onClear}
          style={styles.dateFilterClear}
          hitSlop={6}
        >
          <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  filterPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: 'rgba(120,120,128,0.10)' },
  filterPillActive: { backgroundColor: colors.accent },
  filterText: { fontFamily: typography.button.fontFamily, fontSize: 13, color: colors.textPrimary },
  viewToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  viewLabel: { fontFamily: typography.subtitle.fontFamily, fontSize: 12, color: GRAY[500] },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 44, marginHorizontal: spacing.lg, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: GRAY[200], boxShadow: '0 1px 2px rgba(0,0,0,0.04)' },
  searchInput: { flex: 1, fontFamily: typography.subtitle.fontFamily, fontSize: 15, color: colors.textPrimary, padding: 0 },
  body: { flex: 1, marginTop: spacing.sm },
  fanWrap: { flex: 1, paddingTop: 30 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  emptyText: { fontFamily: typography.subtitle.fontFamily, fontSize: 15, color: GRAY[500], marginTop: -28 },
  errorText: { fontFamily: fontFamily.regular, fontSize: 13, color: '#B42318', textAlign: 'center' },
  retryButton: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.ctaBackground },
  retryText: { fontFamily: fontFamily.semibold, color: colors.ctaText },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  listIcon: { width: 32, alignItems: 'center' },
  listText: { flex: 1, minWidth: 0 },
  listLabel: { fontFamily: typography.subtitle.fontFamily, fontSize: 15, color: colors.textPrimary },
  listMeta: { marginTop: 2, fontFamily: typography.subtitle.fontFamily, fontSize: 12, color: colors.textSecondary },
  listTotal: { fontFamily: typography.button.fontFamily, fontSize: 14, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  snackbar: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.md, minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: '#1C1C1E', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 6px 18px rgba(0,0,0,0.24)' },
  snackbarText: { fontFamily: fontFamily.regular, fontSize: 14, color: '#FFFFFF' },
  undoText: { fontFamily: fontFamily.semibold, fontSize: 14, color: '#9ED5FF' },
  filterRoot: { flex: 1, backgroundColor: colors.background },
  filterHeader: { minHeight: 58, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  filterTitle: { fontFamily: fontFamily.semibold, fontSize: 18, color: colors.textPrimary },
  headerAction: { fontFamily: fontFamily.semibold, fontSize: 15, color: colors.accent },
  filterContent: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xl * 2 },
  filterLabel: { fontFamily: fontFamily.semibold, fontSize: 13, color: colors.textPrimary },
  filterInput: { minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, fontFamily: fontFamily.regular, color: colors.textPrimary, backgroundColor: '#FFFFFF' },
  dateFilterRow: { minHeight: 56, flexDirection: 'row', alignItems: 'stretch', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, borderCurve: 'continuous', backgroundColor: '#FFFFFF' },
  dateFilterRowActive: { borderColor: colors.accent },
  dateFilterMain: { flex: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  dateFilterLabel: { fontFamily: fontFamily.regular, fontSize: 11, color: colors.textSecondary },
  dateFilterValue: { marginTop: 2, fontFamily: fontFamily.semibold, fontSize: 15, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  dateFilterPlaceholder: { fontFamily: fontFamily.regular, color: colors.textSecondary },
  dateFilterClear: { width: 44, alignItems: 'center', justifyContent: 'center', borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  datePickerPanel: { overflow: 'hidden', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, borderCurve: 'continuous', backgroundColor: '#FFFFFF' },
  datePickerHeader: { minHeight: 44, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  datePickerTitle: { fontFamily: fontFamily.semibold, fontSize: 13, color: colors.textPrimary },
  datePickerDone: { fontFamily: fontFamily.semibold, fontSize: 14, color: colors.accent },
  inlineFields: { flexDirection: 'row', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontFamily: fontFamily.regular, fontSize: 12, color: colors.textSecondary },
  chipTextSelected: { fontFamily: fontFamily.semibold, color: '#FFFFFF' },
  currencyHint: { fontFamily: fontFamily.regular, fontSize: 12, color: colors.textSecondary },
  applyButton: { minHeight: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ctaBackground },
  applyText: { fontFamily: fontFamily.semibold, fontSize: 15, color: colors.ctaText },
});
