/**
 * CategoryChecklist — the printed face of the FIRST onboarding receipt. Styled
 * as a real receipt (brand line, torn dividers, a "PROGRESS" barcode footer)
 * wrapping an "Expense categories" checklist of the buckets Parse files under.
 *
 * Purely illustrative: the first two rows read as done and the third as the
 * current step, so the receipt looks like an onboarding in progress. All sizes
 * take the receipt's scale `s` (= card width / 300) so the face tracks the card.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Barcode } from '@/components/ui/Barcode';
import { colors, fontFamily } from '@/theme/tokens';

// Miscellaneous kept last as the catch-all bucket.
const ITEMS = [
  'Travel & Gas',
  'Meals and Entertainment',
  'Office & Software',
  'Professional Fees',
  'Marketing Expenses',
  'Miscellaneous',
];
const DONE = 2; // rows shown complete; DONE is the current (active) row
const SEGMENTS = 18;

function Bullet({ index, state, s }: { index: number; state: 'done' | 'active' | 'todo'; s: number }) {
  const d = 22 * s;
  const base = { width: d, height: d, borderRadius: d / 2, alignItems: 'center', justifyContent: 'center' } as const;

  if (state === 'done') {
    return (
      <View style={[base, { backgroundColor: colors.accent }]}>
        <Feather name="check" size={13 * s} color="#fff" />
      </View>
    );
  }

  const active = state === 'active';
  return (
    <View
      style={[
        base,
        active
          ? { backgroundColor: colors.accent }
          : { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
      ]}
    >
      <Text style={{ fontFamily: fontFamily.semibold, fontSize: 11 * s, color: active ? colors.ctaText : colors.textFaint }}>
        {index + 1}
      </Text>
    </View>
  );
}

export function CategoryChecklist({ s }: { s: number }) {
  const filled = Math.round((DONE / ITEMS.length) * SEGMENTS);

  return (
    <View style={styles.root}>
      {/* Brand line */}
      <Text style={[styles.brand, { fontSize: 12.1 * s, letterSpacing: 2.5 * s }]}>✦  CHOOSE ONCE  ✦</Text>
      <View style={[styles.dash, { marginTop: 12 * s }]} />

      {/* Header: title + count */}
      <View style={[styles.headerRow, { marginTop: 12 * s }]}>
        <Feather name="chevron-up" size={16 * s} color={colors.textPrimary} />
        <Text style={{ marginLeft: 6 * s, fontFamily: fontFamily.display, fontSize: 14.5 * s, color: colors.textPrimary }}>
          Expense categories
        </Text>
        <View style={styles.spacer} />
        <Text style={{ fontFamily: fontFamily.regular, fontSize: 12 * s, color: colors.textFaint }}>
          {DONE}/{ITEMS.length}
        </Text>
      </View>

      {/* Segmented progress bar */}
      <View style={[styles.segments, { marginTop: 10 * s }]}>
        {Array.from({ length: SEGMENTS }).map((_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 10 * s,
              marginRight: i < SEGMENTS - 1 ? 2 * s : 0,
              borderRadius: 1.5 * s,
              backgroundColor: i < filled ? colors.accent : colors.border,
            }}
          />
        ))}
      </View>
      <View style={[styles.dash, { marginTop: 12 * s }]} />

      {/* The rows fill the middle of the receipt. */}
      <View style={styles.list}>
        {ITEMS.map((label, i) => {
          const state = i < DONE ? 'done' : i === DONE ? 'active' : 'todo';
          return (
            <View
              key={label}
              style={[styles.row, { height: 44 * s }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
            >
              <Bullet index={i} state={state} s={s} />
              <Text
                numberOfLines={1}
                style={{
                  flex: 1,
                  marginLeft: 10 * s,
                  fontFamily: state === 'done' ? fontFamily.regular : fontFamily.semibold,
                  fontSize: 13 * s,
                  color: state === 'done' ? colors.textFaint : colors.textPrimary,
                  transform: i === ITEMS.length - 1 ? [{ translateY: 4 }] : undefined,
                }}
              >
                {label}
              </Text>
              {state !== 'done' && <Feather name="chevron-right" size={14 * s} color={colors.textFaint} />}
            </View>
          );
        })}
      </View>

      {/* Watermark barcode footer */}
      <View style={[styles.dash, { marginTop: 14 * s, marginBottom: 14 * s }]} />
      <Barcode s={s} height={26} subtle />
      <Text style={[styles.footerCaption, { marginTop: 8 * s, fontSize: 8 * s, letterSpacing: 1.5 * s }]}>
        PARSE · GO PAPERLESS · 2026
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  brand: { textAlign: 'center', color: colors.textFaint, fontFamily: fontFamily.semibold },
  dash: { borderBottomWidth: 1, borderStyle: 'dashed', borderColor: colors.border },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  spacer: { flex: 1 },
  segments: { flexDirection: 'row', alignItems: 'center' },
  list: { flex: 1, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  footerCaption: { textAlign: 'center', color: colors.textFaint, fontFamily: fontFamily.regular },
});
