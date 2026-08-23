/**
 * CurrencyScreen — pick the fallback currency.
 *
 * This is not a display preference. It is the value the extraction prompt tells
 * the model to assume when a receipt does not state a currency of its own, and
 * the value a receipt is stored with when the model returns nothing usable. A
 * user filing UK receipts under a USD default gets silently wrong totals in
 * every export, so the screen says what it is for rather than leaving the user
 * to infer it.
 *
 * Current selection first, then everything else, with a search box — a flat
 * 160-row alphabetical list would make the one currency the user actually holds
 * the hardest thing on the screen to find.
 *
 * Selecting saves immediately. Unlike categories there is nothing to compose
 * here: one tap is the whole intent, and a Save button would only add a step
 * where the tap already said everything.
 */
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Eyebrow } from '@/components/menu/primitives';
import { useAuth } from '@/lib/auth/auth-context';
import { currencyName, searchCurrencies, type Currency } from '@/lib/currencies';
import { makeStyles, useColors } from '@/theme/appearance';
import { radius, spacing, typography } from '@/theme/tokens';

function Row({
  currency,
  selected,
  saving,
  onPress,
}: {
  currency: Currency;
  selected: boolean;
  saving: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${currency.name}, ${currency.code}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceSubtle }]}
    >
      <Text style={styles.code}>{currency.code}</Text>
      <Text style={styles.name} numberOfLines={1}>{currency.name}</Text>
      {saving ? (
        <ActivityIndicator color={colors.textSecondary} />
      ) : selected ? (
        <Feather name="check" size={18} color={colors.accent} />
      ) : null}
    </Pressable>
  );
}

export function CurrencyScreen() {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedCode = auth.profile?.default_currency ?? auth.bootstrapLocale.defaultCurrency;
  const results = useMemo(() => searchCurrencies(query), [query]);

  // The current pick is shown in its own block above the list, so it is also
  // dropped from the list to avoid it appearing twice while searching.
  const searching = query.trim().length > 0;
  const listData = useMemo(
    () => (searching ? results : results.filter((currency) => currency.code !== selectedCode)),
    [results, searching, selectedCode],
  );

  const choose = async (code: string) => {
    if (saving) return;
    if (code === selectedCode) return;
    setSaving(code);
    setError(null);
    try {
      await auth.updateDefaultCurrency(code);
    } catch (caught) {
      // Inline rather than an Alert: the list stays visible, so the user can
      // simply tap again once they are back online.
      setError(caught instanceof Error ? caught.message : 'Could not save that currency.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.searchWrap}>
        <Feather name="search" size={16} color={colors.textFaint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search currency or code"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search currencies"
          style={styles.searchInput}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
            <Feather name="x" size={16} color={colors.textFaint} />
          </Pressable>
        )}
      </View>

      <FlatList
        data={listData}
        keyExtractor={(currency) => currency.code}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <Text style={styles.copy}>
              Used when a receipt does not show its own currency.
            </Text>

            {/* Hidden while searching: the point of the search box is to reach
                one row, and a pinned block above the results just pushes it
                down the screen. */}
            {!searching && (
              <View style={styles.section}>
                <Eyebrow style={{ marginLeft: spacing.md }}>Selected</Eyebrow>
                <View style={styles.card}>
                  <Row
                    currency={{ code: selectedCode, name: currencyName(selectedCode) ?? 'Current currency' }}
                    selected
                    saving={saving === selectedCode}
                    onPress={() => {}}
                  />
                </View>
              </View>
            )}

            {error && <Text style={styles.error}>{error}</Text>}

            <Eyebrow style={{ marginLeft: spacing.md, marginTop: spacing.md, marginBottom: spacing.sm }}>
              {searching ? 'Results' : 'All currencies'}
            </Eyebrow>
          </View>
        }
        renderItem={({ item, index }) => (
          <View style={[styles.card, styles.cardRow, index === 0 && styles.cardFirst]}>
            <Row
              currency={item}
              selected={item.code === selectedCode}
              saving={saving === item.code}
              onPress={() => void choose(item.code)}
            />
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>No currency matches “{query.trim()}”.</Text>
        }
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, paddingHorizontal: spacing.lg },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  searchInput: { flex: 1, ...typography.label, fontSize: 15, color: colors.textPrimary, padding: 0 },
  listContent: { paddingBottom: spacing.xl },
  copy: { ...typography.meta, color: colors.textSecondary, lineHeight: 19, marginBottom: spacing.md },
  section: { gap: spacing.sm },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg },
  // Rows in the long list join into one continuous card rather than floating as
  // separate tiles, which at this length reads as noise.
  cardRow: { borderRadius: 0, borderTopWidth: 0 },
  cardFirst: { borderTopWidth: 1, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  code: { ...typography.label, fontSize: 14, color: colors.textPrimary, width: 46 },
  name: { flex: 1, ...typography.meta, color: colors.textSecondary },
  error: { ...typography.meta, color: colors.danger, marginTop: spacing.sm, marginLeft: spacing.md },
  empty: { ...typography.meta, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.xl },
}));
