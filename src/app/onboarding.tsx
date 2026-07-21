import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';

import { useAuth } from '@/lib/auth/auth-context';
import { colors, fontFamily, radius, spacing, typography } from '@/theme/tokens';

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'Please try again.';
}

export default function CategoryOnboardingScreen() {
  const router = useRouter();
  const auth = useAuth();
  const systemCategory = useMemo(() => auth.categories.find((category) => category.is_system), [auth.categories]);
  const defaultIds = useMemo(
    () => auth.categories.filter((category) => category.is_default && !category.is_system).map((category) => category.id),
    [auth.categories],
  );
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [country, setCountry] = useState(auth.profile?.country ?? auth.bootstrapLocale.country ?? '');
  const [currency, setCurrency] = useState(auth.profile?.default_currency ?? auth.bootstrapLocale.defaultCurrency);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!auth.loading && !auth.session) router.replace('/');
  }, [auth.loading, auth.session, router]);

  useEffect(() => {
    if (selectedIds.length > 0 || defaultIds.length === 0) return;
    setSelectedIds(defaultIds);
  }, [defaultIds, selectedIds.length]);

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

  const finish = async () => {
    if (selectedIds.length < 1) {
      Alert.alert('Pick one more', 'Choose at least one category besides Miscellaneous.');
      return;
    }

    try {
      setBusy(true);
      await auth.completeOnboarding(selectedIds, country, currency.toUpperCase());
      router.replace('/camera');
    } catch (error) {
      console.warn('Onboarding not saved', error);
      Alert.alert('Onboarding not saved', getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (auth.loading || auth.categories.length === 0) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      testID="category-onboarding-screen"
    >
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
        {auth.categories
          .filter((category) => !category.is_system)
          .map((category) => {
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
          <View style={[styles.row, styles.locked]} testID="miscellaneous-locked-category">
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
  row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  locked: { backgroundColor: '#F7FAF8', borderBottomWidth: 0 },
  check: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
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
