/**
 * ScannedFace — the printed face of a scanned receipt, shown on ReceiptCard's
 * paper `bare` variant (no glass: a receipt photo is mostly bright paper, and
 * frost over it reads flat — HANDOFF rule 6).
 *
 * Renders the 6 contract fields: store, date, items, total, category,
 * handwritten notes. With `loading`, the same layout renders as a skeleton so
 * the wait reads as the receipt developing rather than a spinner.
 *
 * Sizes take the card's scale `s` (= width / 300), like the rest of the card.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily } from '@/theme/tokens';
import type { ReceiptFields } from '@/lib/receipts/types';

const money = (n: number) => n.toFixed(2);

/** "2026-07-04" → "4 Jul 2026". Null dates print as a dash for the user to fix. */
function prettyDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function Bar({ w, s }: { w: number | `${number}%`; s: number }) {
  return <View style={{ width: w, height: 9 * s, borderRadius: 5 * s, backgroundColor: colors.border }} />;
}

export function ScannedFace({ s, fields, loading = false }: { s: number; fields?: ReceiptFields | null; loading?: boolean }) {
  return (
    <View style={styles.root}>
      {/* Store + date */}
      {loading || !fields ? (
        <View style={{ alignItems: 'center', gap: 7 * s }}>
          <Bar w="62%" s={s} />
          <Bar w="34%" s={s} />
        </View>
      ) : (
        <>
          <Text
            numberOfLines={1}
            style={{ fontFamily: fontFamily.display, fontSize: 20 * s, color: colors.textPrimary, textAlign: 'center' }}
          >
            {fields.store || 'Unknown store'}
          </Text>
          <Text style={{ fontFamily: fontFamily.regular, fontSize: 11 * s, color: colors.textFaint, textAlign: 'center', marginTop: 3 * s }}>
            {prettyDate(fields.date)}
          </Text>
        </>
      )}

      <View style={[styles.dash, { marginTop: 12 * s }]} />

      {/* Items */}
      <View style={[styles.items, { marginTop: 10 * s, gap: 7 * s }]}>
        {loading || !fields
          ? [0, 1, 2].map((i) => <Bar key={i} w={i === 2 ? '55%' : '80%'} s={s} />)
          : fields.items.slice(0, 5).map((line, i) => (
              <Text
                key={`${line}-${i}`}
                numberOfLines={1}
                style={{ fontFamily: fontFamily.regular, fontSize: 11 * s, color: colors.textSecondary }}
              >
                {line}
              </Text>
            ))}
      </View>

      <View style={styles.spacer} />

      {/* Total */}
      <View style={[styles.dash, { marginBottom: 8 * s }]} />
      <View style={styles.totalRow}>
        <Text style={{ fontFamily: fontFamily.semibold, fontSize: 10 * s, letterSpacing: 1 * s, color: colors.textFaint }}>
          TOTAL
        </Text>
        <View style={styles.spacer} />
        {loading || !fields ? (
          <Bar w={64 * s} s={s} />
        ) : (
          <Text style={{ fontFamily: fontFamily.display, fontSize: 22 * s, color: colors.textPrimary }}>
            {money(fields.total)}
          </Text>
        )}
      </View>

      {/* Category + handwritten notes */}
      <View style={[styles.metaRow, { marginTop: 10 * s }]}>
        {loading || !fields ? (
          <Bar w={96 * s} s={s} />
        ) : (
          <View style={[styles.chip, { paddingHorizontal: 8 * s, paddingVertical: 4 * s, borderRadius: 999 }]}>
            <Text numberOfLines={1} style={{ fontFamily: fontFamily.semibold, fontSize: 9.5 * s, color: colors.ctaText }}>
              {fields.category}
            </Text>
          </View>
        )}
      </View>

      {!loading && fields?.handwritten_notes ? (
        <Text
          numberOfLines={2}
          style={{ marginTop: 8 * s, fontFamily: fontFamily.regular, fontSize: 10 * s, color: colors.textFaint, textAlign: 'center' }}
        >
          “{fields.handwritten_notes}”
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  dash: { borderBottomWidth: 1, borderStyle: 'dashed', borderColor: colors.border },
  items: { alignSelf: 'stretch' },
  spacer: { flex: 1 },
  totalRow: { flexDirection: 'row', alignItems: 'flex-end' },
  metaRow: { flexDirection: 'row', justifyContent: 'center' },
  chip: { backgroundColor: colors.accent, alignSelf: 'center' },
});
