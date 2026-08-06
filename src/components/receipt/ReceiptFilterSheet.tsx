/**
 * The one filter sheet.
 *
 * Search and Export ask the same question — which receipts do you mean — and
 * they now ask it with the same component and validate the answer against the
 * same contract. Two copies would drift, and the field they would drift on is
 * the dangerous one: an amount filter without a currency is meaningless (D13),
 * and an export is exactly where a silently-defaulted currency would look
 * authoritative. `searchQuerySchema` refuses it here, once, for both callers.
 *
 * Extracted from SearchView in B7; the behaviour is unchanged.
 */
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DateTimePicker } from '@expo/ui/community/datetime-picker';

import type { SearchQuery } from '@/../packages/contracts/src';
import { searchQuerySchema } from '@/../packages/contracts/src';
import { colors, fontFamily, radius, spacing } from '@/theme/tokens';

export type ReceiptFilters = Omit<SearchQuery, 'text' | 'view'>;

type DateFilterKey = 'date_from' | 'date_to';

export const filtersActive = (filters: ReceiptFilters) =>
  Boolean(
    filters.date_from ||
      filters.date_to ||
      filters.category_ids?.length ||
      filters.amount_min !== undefined ||
      filters.amount_max !== undefined,
  );

export const toLocalDate = (isoDate?: string) => {
  if (!isoDate) return undefined;
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day, 12);
};

export const toIsoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const today = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
};

export const formatFilterDate = (isoDate?: string) => {
  const date = toLocalDate(isoDate);
  return date?.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) ?? 'Any date';
};

/**
 * A one-line summary of a filter set.
 *
 * Used both for "what will be exported" on the Export card and for "what this
 * was" on a past export. The second use is why it has to cover every filter: a
 * finished export outlives its files, and the summary is then the only record of
 * what the file contained.
 */
export function describeFilters(
  filters: ReceiptFilters & { text?: string },
  categories: { id: number; name: string }[],
): string {
  const parts: string[] = [];
  if (filters.text) parts.push(`"${filters.text}"`);
  if (filters.date_from || filters.date_to) {
    parts.push(`${formatFilterDate(filters.date_from)} – ${formatFilterDate(filters.date_to)}`);
  }
  if (filters.category_ids?.length) {
    const names = filters.category_ids
      .map((id) => categories.find((category) => category.id === id)?.name)
      .filter((name): name is string => Boolean(name));
    parts.push(names.length <= 2 ? names.join(', ') : `${names.length} categories`);
  }
  if (filters.amount_min !== undefined || filters.amount_max !== undefined) {
    const currency = filters.amount_currency ?? '';
    const min = filters.amount_min !== undefined ? filters.amount_min.toFixed(2) : 'any';
    const max = filters.amount_max !== undefined ? filters.amount_max.toFixed(2) : 'any';
    parts.push(`${min}–${max} ${currency}`.trim());
  }
  return parts.length > 0 ? parts.join(' · ') : 'All receipts';
}

export function ReceiptFilterSheet({
  visible,
  value,
  categories,
  defaultCurrency,
  onClose,
  onApply,
  applyLabel = 'Apply filters',
}: {
  visible: boolean;
  value: ReceiptFilters;
  categories: { id: number; name: string }[];
  defaultCurrency: string;
  onClose: () => void;
  onApply: (filters: ReceiptFilters) => void;
  applyLabel?: string;
}) {
  const [draft, setDraft] = useState<ReceiptFilters>(value);
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
    setDraft({
      ...draft,
      category_ids: selected.includes(id) ? selected.filter((candidate) => candidate !== id) : [...selected, id],
    });
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
              return (
                <Pressable key={category.id} onPress={() => toggleCategory(category.id)} style={[styles.chip, selected && styles.chipSelected]}>
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{category.name}</Text>
                </Pressable>
              );
            })}</View>
          </FilterField>
          <FilterField label="Amount range">
            <TextInput
              style={styles.filterInput}
              value={draft.amount_currency ?? defaultCurrency}
              onChangeText={(currency) => setDraft({ ...draft, amount_currency: currency.trim().toUpperCase() })}
              onFocus={revealAmountFields}
              maxLength={3}
              autoCapitalize="characters"
              placeholder="USD"
              placeholderTextColor={colors.textFaint}
            />
            <View style={styles.inlineFields}>
              <TextInput style={[styles.filterInput, { flex: 1 }]} value={minimum} onChangeText={setMinimum} onFocus={revealAmountFields} keyboardType="decimal-pad" placeholder="Minimum" placeholderTextColor={colors.textFaint} />
              <TextInput style={[styles.filterInput, { flex: 1 }]} value={maximum} onChangeText={setMaximum} onFocus={revealAmountFields} keyboardType="decimal-pad" placeholder="Maximum" placeholderTextColor={colors.textFaint} />
            </View>
            <Text style={styles.currencyHint}>Amounts are compared only within {draft.amount_currency || defaultCurrency}.</Text>
          </FilterField>
          {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
          <Pressable style={styles.applyButton} onPress={apply}><Text style={styles.applyText}>{applyLabel}</Text></Pressable>
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
  errorText: { fontFamily: fontFamily.regular, fontSize: 13, color: '#B42318', textAlign: 'center' },
  applyButton: { minHeight: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ctaBackground },
  applyText: { fontFamily: fontFamily.semibold, fontSize: 15, color: colors.ctaText },
});
