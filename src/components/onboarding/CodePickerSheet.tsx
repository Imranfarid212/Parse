/**
 * CodePickerSheet — the searchable list behind onboarding's Country and
 * Currency fields.
 *
 * One component for both, because the two lists are the same shape (a code and
 * a name) and should not drift into two slightly different pickers. It is a
 * Modal rather than a route so onboarding keeps its scroll position and the
 * half-filled form behind it.
 *
 * Replaces two free-text inputs. Those let someone type `ZZ` or `DOLLAR` and
 * only told them on submit, via an Alert — and nothing connected the two, so a
 * country change left a stale currency sitting next to it.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { makeStyles, useColors } from '@/theme/appearance';
import { fontFamily, radius, spacing, typography } from '@/theme/tokens';

export type CodeItem = { code: string; name: string };

export function CodePickerSheet({
  visible,
  title,
  placeholder,
  items,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  placeholder: string;
  /** Already filtered by the caller's own search, given `query`. */
  items: (query: string) => readonly CodeItem[];
  selected: string | null;
  onSelect: (code: string) => void;
  onClose: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [query, setQuery] = useState('');

  const results = useMemo(() => items(query), [items, query]);

  const close = () => {
    setQuery('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Feather name="x" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.search}>
          <Feather name="search" size={17} color={colors.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={placeholder}
            placeholderTextColor={colors.textFaint}
            autoCorrect={false}
            autoCapitalize="none"
            style={styles.searchInput}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
              <Feather name="x-circle" size={17} color={colors.textFaint} />
            </Pressable>
          ) : null}
        </View>

        <FlatList
          data={results}
          keyExtractor={(item) => item.code}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>Nothing matches “{query.trim()}”.</Text>}
          renderItem={({ item }) => {
            const isSelected = item.code === selected;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${item.name}, ${item.code}`}
                onPress={() => {
                  onSelect(item.code);
                  close();
                }}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceSubtle }]}
              >
                <Text style={styles.code}>{item.code}</Text>
                <Text numberOfLines={1} style={styles.name}>{item.name}</Text>
                {isSelected ? <Feather name="check" size={18} color={colors.accent} /> : null}
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  sheet: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: { ...typography.heading, color: colors.textPrimary },
  search: {
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
  searchInput: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: 15,
    letterSpacing: -0.2,
    color: colors.textPrimary,
    padding: 0,
    includeFontPadding: false,
  },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  code: { ...typography.row, width: 42, color: colors.textSecondary },
  name: { ...typography.row, flex: 1, color: colors.textPrimary },
  empty: { ...typography.meta, color: colors.textSecondary, textAlign: 'center', paddingTop: spacing.xl },
}));
