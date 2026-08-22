/**
 * EditSheet — swipe-down destination. Edits the 6 contract fields, then hands
 * the result back to the review card.
 *
 * Retake lives here (only reachable after swipe-down, per spec). In One-click
 * the receipt is already stored by the time you can reach it, so retaking
 * *destroys a saved row* — hence `destructive`, which says so out loud rather
 * than quietly dropping data.
 */
import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { CATEGORIES, type Category, type ReceiptFields, type ReceiptLineItem } from '@/lib/receipts/types';
import { makeStyles, useColors } from '@/theme/appearance';
import { fontFamily, radius, spacing } from '@/theme/tokens';

export function EditSheet({
  fields,
  destructiveRetake,
  onChange,
  onDone,
  onRetake,
  showRetake = true,
  saving = false,
  error,
  categoryOptions = CATEGORIES,
}: {
  fields: ReceiptFields;
  /** True in One-click: the row is already saved, so retake deletes it. */
  destructiveRetake: boolean;
  onChange: (f: ReceiptFields) => void;
  onDone: () => void;
  onRetake?: () => void;
  showRetake?: boolean;
  saving?: boolean;
  error?: string | null;
  categoryOptions?: readonly Category[];
}) {
  const styles = useStyles();
  const colors = useColors();
  const [totalText, setTotalText] = useState(fields.total.toFixed(2));
  const scrollRef = useRef<ScrollView>(null);

  const set = <K extends keyof ReceiptFields>(k: K, v: ReceiptFields[K]) => onChange({ ...fields, [k]: v });

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.sheet}>
      <View style={styles.grabber} />

      <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: spacing.xl * 2 }}>
        <Field label="Store">
          <TextInput
            style={styles.input}
            value={fields.store}
            onChangeText={(v) => set('store', v)}
            placeholder="Merchant name"
            placeholderTextColor={colors.textFaint}
          />
        </Field>

        <Field label="Date">
          <TextInput
            style={styles.input}
            value={fields.date ?? ''}
            onChangeText={(v) => set('date', v || null)}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
          />
        </Field>

        <Field label="Total">
          <TextInput
            style={styles.input}
            value={totalText}
            onChangeText={(v) => {
              setTotalText(v);
              const n = Number(v.replace(/[^0-9.]/g, ''));
              if (Number.isFinite(n)) set('total', n);
            }}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={colors.textFaint}
          />
        </Field>

        <Field label="Items">
          <View style={styles.itemList}>
            {fields.items.map((item, index) => (
              <EditableItemRow
                key={`item-${index}`}
                item={item}
                onChange={(patch) => updateItem(fields.items, index, patch, set)}
                onRemove={() => set('items', fields.items.filter((_, row) => row !== index))}
              />
            ))}
            <Pressable onPress={() => set('items', [...fields.items, { name: '', qty: 1, amount: 0 }])} style={styles.addItem}>
              <Feather name="plus" size={16} color={colors.textPrimary} />
              <Text style={styles.addItemText}>Add item</Text>
            </Pressable>
          </View>
        </Field>

        <Field label="Category">
          <View style={styles.chips}>
            {categoryOptions.map((c) => {
              const on = c === fields.category;
              return (
                <Pressable key={c} onPress={() => set('category', c as Category)} style={[styles.chip, on && styles.chipOn]}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{c}</Text>
                </Pressable>
              );
            })}
          </View>
        </Field>

        <Field label="Handwritten notes">
          <TextInput
            style={[styles.input, styles.multiline]}
            value={fields.handwritten_notes}
            onChangeText={(v) => set('handwritten_notes', v)}
            onFocus={() => requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))}
            multiline
            placeholder="Anything written on the receipt"
            placeholderTextColor={colors.textFaint}
          />
        </Field>

        <View style={styles.actions}>
          {showRetake && onRetake ? (
            <Pressable onPress={onRetake} style={styles.retake} hitSlop={8} disabled={saving}>
              <Feather name="rotate-ccw" size={15} color="#B42318" />
              <Text style={styles.retakeText}>{destructiveRetake ? 'Retake (deletes this)' : 'Retake'}</Text>
            </Pressable>
          ) : <View style={{ flex: 1 }} />}

          <Pressable onPress={onDone} style={[styles.done, saving && { opacity: 0.55 }]} disabled={saving}>
            <Text style={styles.doneText}>{saving ? 'Saving…' : 'Done'}</Text>
          </Pressable>
        </View>
        {error ? <Text selectable style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function positiveNumber(value: string, fallback: number) {
  const number = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function EditableItemRow({ item, onChange, onRemove }: { item: ReceiptLineItem; onChange: (patch: Partial<ReceiptLineItem>) => void; onRemove: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const [qtyText, setQtyText] = useState(String(item.qty));
  const [amountText, setAmountText] = useState(item.amount.toFixed(2));
  const commitQty = () => {
    const qty = positiveNumber(qtyText, item.qty);
    setQtyText(String(qty));
    onChange({ qty });
  };
  const commitAmount = () => {
    const amount = nonnegativeNumber(amountText, item.amount);
    setAmountText(amount.toFixed(2));
    onChange({ amount });
  };

  return (
    <View style={styles.itemEditorRow}>
      <TextInput
        style={[styles.input, styles.itemNameInput]}
        value={item.name}
        onChangeText={(name) => onChange({ name })}
        placeholder="Item"
        placeholderTextColor={colors.textFaint}
      />
      <TextInput
        style={[styles.input, styles.itemNumberInput]}
        value={qtyText}
        onChangeText={(value) => { setQtyText(value); const qty = Number(value); if (Number.isFinite(qty) && qty > 0) onChange({ qty }); }}
        onBlur={commitQty}
        keyboardType="decimal-pad"
        placeholder="Qty"
        placeholderTextColor={colors.textFaint}
      />
      <TextInput
        style={[styles.input, styles.itemAmountInput]}
        value={amountText}
        onChangeText={(value) => { setAmountText(value); const amount = Number(value); if (Number.isFinite(amount) && amount >= 0) onChange({ amount }); }}
        onBlur={commitAmount}
        keyboardType="decimal-pad"
        placeholder="Amount"
        placeholderTextColor={colors.textFaint}
      />
      <Pressable onPress={onRemove} hitSlop={8} style={styles.removeItem}>
        <Feather name="x" size={17} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

function nonnegativeNumber(value: string, fallback: number) {
  const number = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function updateItem(
  items: ReceiptLineItem[],
  index: number,
  patch: Partial<ReceiptLineItem>,
  set: <K extends keyof ReceiptFields>(key: K, value: ReceiptFields[K]) => void,
) {
  set('items', items.map((item, row) => (row === index ? { ...item, ...patch } : item)));
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    flex: 1,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  label: {
    fontFamily: fontFamily.semibold,
    fontSize: 11,
    letterSpacing: 0.6,
    color: colors.textFaint,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  input: {
    fontFamily: fontFamily.regular,
    fontSize: 15,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  itemList: { gap: 8 },
  itemEditorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemNameInput: { flex: 1, minWidth: 0 },
  itemNumberInput: { width: 54, textAlign: 'right' },
  itemAmountInput: { width: 74, textAlign: 'right' },
  removeItem: { width: 24, height: 38, alignItems: 'center', justifyContent: 'center' },
  addItem: { minHeight: 38, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  addItemText: { fontFamily: fontFamily.semibold, fontSize: 14, color: colors.textPrimary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontFamily: fontFamily.regular, fontSize: 12, color: colors.textSecondary },
  chipTextOn: { fontFamily: fontFamily.semibold, color: '#fff' },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  retake: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingRight: 12 },
  retakeText: { fontFamily: fontFamily.semibold, fontSize: 14, color: '#B42318' },
  done: {
    marginLeft: 'auto',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md - 2,
    backgroundColor: colors.ctaBackground,
    borderRadius: radius.pill,
  },
  doneText: { fontFamily: fontFamily.semibold, fontSize: 15, color: colors.ctaText },
  error: { marginTop: spacing.sm, fontFamily: fontFamily.regular, fontSize: 13, color: '#B42318', textAlign: 'right' },
}));
