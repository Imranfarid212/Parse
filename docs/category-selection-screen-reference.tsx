/**
 * Category selection screen reference.
 *
 * This is a standalone design/reference copy of src/app/onboarding.tsx.
 * It uses mock data and keeps the visual tokens/styles visible so new screens
 * can reuse the same background, typography, spacing, list rows, inputs, and CTA.
 *
 * This file is not imported by the app.
 */
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';

import { colors, fontFamily, radius, spacing, typography } from '@/theme/tokens';

type Category = {
  id: number;
  name: string;
  is_default: boolean;
  is_system: boolean;
};

const MOCK_CATEGORIES: Category[] = [
  { id: 1, name: 'Travel & Transit', is_default: true, is_system: false },
  { id: 2, name: 'Meals & Entertainment', is_default: true, is_system: false },
  { id: 3, name: 'Office Supplies', is_default: true, is_system: false },
  { id: 4, name: 'Software & IT', is_default: true, is_system: false },
  { id: 5, name: 'Vehicle Expenses', is_default: true, is_system: false },
  { id: 6, name: 'Advertising & Marketing', is_default: true, is_system: false },
  { id: 7, name: 'Professional Services', is_default: true, is_system: false },
  { id: 8, name: 'Utilities & Telecom', is_default: true, is_system: false },
  { id: 9, name: 'Inventory & Materials', is_default: true, is_system: false },
  { id: 10, name: 'Miscellaneous', is_default: true, is_system: true },
];

export function CategorySelectionScreenReference() {
  const systemCategory = useMemo(() => MOCK_CATEGORIES.find((category) => category.is_system), []);
  const defaultIds = useMemo(
    () => MOCK_CATEGORIES.filter((category) => category.is_default && !category.is_system).map((category) => category.id),
    [],
  );
  const [selectedIds, setSelectedIds] = useState<number[]>(defaultIds);
  const [country, setCountry] = useState('US');
  const [currency, setCurrency] = useState('USD');
  const [busy, setBusy] = useState(false);

  const toggle = (id: number) => {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]));
  };

  const move = (id: number, direction: -1 | 1) => {
    setSelectedIds((ids) => {
      const index = ids.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return ids;
      const next = [...ids];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const finish = () => {
    setBusy(true);
    setTimeout(() => setBusy(false), 900);
  };

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <StatusBar style="dark" />
      <Text style={styles.eyebrow}>SETUP</Text>
      <Text style={styles.title}>Choose your filing categories</Text>
      <Text style={styles.copy}>Miscellaneous is always kept as the fallback. Pick at least one more and arrange the rest.</Text>

      <View style={styles.localeRow}>
        <View style={styles.localeField}>
          <Text style={styles.label}>Country</Text>
          <TextInput value={country} onChangeText={setCountry} autoCapitalize="characters" maxLength={2} style={styles.input} />
        </View>
        <View style={styles.localeField}>
          <Text style={styles.label}>Currency</Text>
          <TextInput value={currency} onChangeText={setCurrency} autoCapitalize="characters" maxLength={3} style={styles.input} />
        </View>
      </View>

      <View style={styles.list}>
        {MOCK_CATEGORIES.filter((category) => !category.is_system).map((category) => {
          const selected = selectedIds.includes(category.id);
          const order = selectedIds.indexOf(category.id);

          return (
            <View key={category.id} style={styles.row}>
              <Pressable onPress={() => toggle(category.id)} style={[styles.check, selected && styles.checkSelected]}>
                {selected && <Feather name="check" size={16} color="#fff" />}
              </Pressable>
              <Text style={styles.rowLabel}>{category.name}</Text>
              {selected && (
                <View style={styles.reorder}>
                  <Pressable onPress={() => move(category.id, -1)} disabled={order <= 0} hitSlop={10}>
                    <Feather name="arrow-up" size={18} color={order <= 0 ? colors.textFaint : colors.textPrimary} />
                  </Pressable>
                  <Pressable onPress={() => move(category.id, 1)} disabled={order === selectedIds.length - 1} hitSlop={10}>
                    <Feather name="arrow-down" size={18} color={order === selectedIds.length - 1 ? colors.textFaint : colors.textPrimary} />
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}

        {systemCategory && (
          <View style={[styles.row, styles.locked]}>
            <View style={[styles.check, styles.checkSelected]}>
              <Feather name="lock" size={15} color="#fff" />
            </View>
            <Text style={styles.rowLabel}>{systemCategory.name}</Text>
            <Text style={styles.pinned}>Pinned</Text>
          </View>
        )}
      </View>

      <Pressable onPress={finish} disabled={busy} style={({ pressed }) => [styles.cta, (pressed || busy) && styles.pressed]}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Continue to camera</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: spacing.xxl, gap: spacing.md, backgroundColor: colors.background },
  eyebrow: { color: colors.textFaint, fontFamily: fontFamily.semibold, fontSize: 12 },
  title: { ...typography.display, fontSize: 34, lineHeight: 38, color: colors.textPrimary },
  copy: { ...typography.subtitle, color: colors.textSecondary },
  localeRow: { flexDirection: 'row', gap: spacing.md },
  localeField: { flex: 1, gap: spacing.xs },
  label: { color: colors.textSecondary, fontFamily: fontFamily.semibold, fontSize: 13 },
  input: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    paddingHorizontal: spacing.md,
    fontFamily: fontFamily.semibold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  list: { borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  locked: { backgroundColor: '#F7FAF8', borderBottomWidth: 0 },
  check: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  rowLabel: { flex: 1, color: colors.textPrimary, fontFamily: fontFamily.semibold, fontSize: 15 },
  reorder: { flexDirection: 'row', gap: spacing.sm },
  pinned: { color: colors.accent, fontFamily: fontFamily.semibold, fontSize: 12 },
  cta: {
    height: 54,
    borderRadius: radius.pill,
    backgroundColor: colors.ctaBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { ...typography.button, color: colors.ctaText },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
});
