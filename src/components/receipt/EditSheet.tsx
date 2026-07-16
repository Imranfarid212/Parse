/**
 * EditSheet — swipe-down destination. Edits the 6 contract fields, then hands
 * the result back to the review card.
 *
 * Retake lives here (only reachable after swipe-down, per spec). In One-click
 * the receipt is already stored by the time you can reach it, so retaking
 * *destroys a saved row* — hence `destructive`, which says so out loud rather
 * than quietly dropping data.
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { CATEGORIES, type Category, type ReceiptFields } from '@/lib/receipts/types';
import { colors, fontFamily, radius, spacing } from '@/theme/tokens';

export function EditSheet({
  fields,
  destructiveRetake,
  onChange,
  onDone,
  onRetake,
}: {
  fields: ReceiptFields;
  /** True in One-click: the row is already saved, so retake deletes it. */
  destructiveRetake: boolean;
  onChange: (f: ReceiptFields) => void;
  onDone: () => void;
  onRetake: () => void;
}) {
  const [totalText, setTotalText] = useState(fields.total.toFixed(2));

  const set = <K extends keyof ReceiptFields>(k: K, v: ReceiptFields[K]) => onChange({ ...fields, [k]: v });

  return (
    <View style={styles.sheet}>
      <View style={styles.grabber} />

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: spacing.lg }}>
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
          <TextInput
            style={[styles.input, styles.multiline]}
            value={fields.items.join('\n')}
            onChangeText={(v) => set('items', v.split('\n'))}
            multiline
            placeholder="One item per line"
            placeholderTextColor={colors.textFaint}
          />
        </Field>

        <Field label="Category">
          <View style={styles.chips}>
            {CATEGORIES.map((c) => {
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
            multiline
            placeholder="Anything written on the receipt"
            placeholderTextColor={colors.textFaint}
          />
        </Field>

        <View style={styles.actions}>
          <Pressable onPress={onRetake} style={styles.retake} hitSlop={8}>
            <Feather name="rotate-ccw" size={15} color="#B42318" />
            <Text style={styles.retakeText}>{destructiveRetake ? 'Retake (deletes this)' : 'Retake'}</Text>
          </Pressable>

          <Pressable onPress={onDone} style={styles.done}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
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
});
