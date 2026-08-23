/**
 * CategoriesScreen — re-pick the filing categories after onboarding.
 *
 * The Settings row that opens this used to do nothing. Onboarding is the only
 * place the choice could be made, which meant a user who picked three
 * categories in a hurry was stuck with three, and one who picked all nine had
 * no way to quieten the list down.
 *
 * Same nine categories as onboarding, same row language (check circle, label,
 * pinned Miscellaneous) — see docs/category-selection-screen-reference.tsx —
 * but rebuilt on the menu primitives so it sits inside Settings rather than
 * looking like an onboarding page that wandered in.
 *
 * Two deliberate differences from onboarding:
 *
 *   No reorder arrows. Onboarding has them, but `complete_onboarding` assigns
 *   sort_order from `(is_system, id)` and ignores the array order it is given,
 *   so those arrows do not survive a round trip. Shipping the same control here
 *   would be shipping a button that does nothing.
 *
 *   Explicit Save rather than save-on-toggle. The write goes through
 *   `complete_onboarding` and then `refreshProfile`, which re-reads the
 *   profile, re-claims the device and re-runs attestation — far too heavy to
 *   fire on every tap, and a half-finished selection is not worth persisting.
 */
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Card, Eyebrow } from '@/components/menu/primitives';
import { useAuth } from '@/lib/auth/auth-context';
import { makeStyles, useColors } from '@/theme/appearance';
import { fontFamily, radius, spacing, typography } from '@/theme/tokens';

/**
 * Split in two so the picker below can seed its draft from `useState` and be
 * right: it is only ever mounted once the categories are actually loaded. A
 * single component would have to seed before that — capturing an empty
 * selection on a cold start and then showing every category switched off, with
 * Save armed to wipe the user's real choice.
 */
export function CategoriesScreen() {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();

  if (auth.categories.length === 0) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    );
  }
  return <CategoryPicker />;
}

function CategoryPicker() {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const [busy, setBusy] = useState(false);

  const selectable = useMemo(
    () => auth.categories.filter((category) => !category.is_system),
    [auth.categories],
  );
  const systemCategory = useMemo(
    () => auth.categories.find((category) => category.is_system),
    [auth.categories],
  );

  /**
   * Seeded from the saved selection, then owned locally until Save.
   *
   * A Set rather than the array `selectedCategoryIds` is: order carries no
   * meaning here (see the sort_order note above), and membership is the only
   * question every row asks.
   */
  const [draft, setDraft] = useState<Set<number>>(() => new Set(auth.selectedCategoryIds));

  const toggle = (id: number) => {
    setDraft((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const chosen = selectable.filter((category) => draft.has(category.id));
  const savedSelectable = auth.selectedCategoryIds.filter((id) =>
    selectable.some((category) => category.id === id),
  );
  const dirty =
    chosen.length !== savedSelectable.length ||
    chosen.some((category) => !savedSelectable.includes(category.id));

  const save = async () => {
    if (busy || !dirty) return;
    // The RPC raises on an empty non-system selection. Catching it here turns a
    // Postgres error string into a sentence, and costs nothing.
    if (chosen.length < 1) {
      Alert.alert('Keep at least one', 'Pick at least one category besides Miscellaneous.');
      return;
    }
    setBusy(true);
    try {
      await auth.updateCategories(chosen.map((category) => category.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Please try again.';
      Alert.alert('Categories not saved', message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.copy}>
        These are the categories you can file a receipt under. Turn on the ones you use and turn off
        the ones you do not — receipts you have already filed keep their category either way.
      </Text>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Eyebrow style={{ marginLeft: spacing.sm }}>Categories</Eyebrow>
          <Text style={styles.count}>
            {chosen.length} of {selectable.length}
          </Text>
        </View>

        <Card>
          {selectable.map((category, index) => {
            const selected = draft.has(category.id);
            return (
              <Pressable
                key={category.id}
                onPress={() => toggle(category.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={category.name}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 && styles.rowDivided,
                  pressed && { backgroundColor: colors.surfaceSubtle },
                ]}
              >
                <View style={[styles.check, selected && styles.checkOn]}>
                  {selected && <Feather name="check" size={15} color={colors.ctaText} />}
                </View>
                <Text style={[styles.rowLabel, selected && styles.rowLabelOn]}>{category.name}</Text>
              </Pressable>
            );
          })}
        </Card>
      </View>

      {/* Miscellaneous is the fallback every unmatched receipt lands in, so the
          server keeps it whatever is sent. Shown as locked rather than hidden:
          a user who cannot find it in the list assumes it is gone. */}
      {systemCategory && (
        <View style={styles.section}>
          <Eyebrow style={{ marginLeft: spacing.sm }}>Always on</Eyebrow>
          <Card>
            <View style={styles.row}>
              <View style={[styles.check, styles.checkOn]}>
                <Feather name="lock" size={14} color={colors.ctaText} />
              </View>
              <Text style={[styles.rowLabel, styles.rowLabelOn]}>{systemCategory.name}</Text>
              <Text style={styles.pinned}>Pinned</Text>
            </View>
          </Card>
        </View>
      )}

      <Pressable
        onPress={() => void save()}
        disabled={!dirty || busy}
        accessibilityRole="button"
        accessibilityLabel="Save categories"
        accessibilityState={{ disabled: !dirty || busy }}
        style={({ pressed }) => [styles.cta, (!dirty || busy) && styles.ctaOff, pressed && { opacity: 0.85 }]}
      >
        {busy ? (
          <ActivityIndicator color={colors.ctaText} />
        ) : (
          <Text style={styles.ctaText}>{dirty ? 'Save changes' : 'Saved'}</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  loading: { paddingVertical: spacing.xl * 2, alignItems: 'center' },
  copy: { ...typography.meta, color: colors.textSecondary, lineHeight: 19 },
  section: { gap: spacing.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { ...typography.eyebrow, color: colors.textFaint, marginRight: spacing.sm },
  row: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  rowLabel: { flex: 1, ...typography.label, fontSize: 15, color: colors.textSecondary },
  rowLabelOn: { color: colors.textPrimary, fontFamily: fontFamily.semibold },
  pinned: { ...typography.eyebrow, color: colors.accent },
  cta: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ctaBackground,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    minHeight: 50,
  },
  // Kept visible rather than removed so the screen does not reflow the moment
  // a selection changes; it simply stops being pressable.
  ctaOff: { opacity: 0.4 },
  ctaText: { ...typography.label, fontSize: 15, color: colors.ctaText },
}));
