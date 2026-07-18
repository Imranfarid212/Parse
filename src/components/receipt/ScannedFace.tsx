/**
 * ScannedFace — the printed face of a scanned receipt, shown on ReceiptCard's
 * paper `bare` variant (no glass: a receipt photo is mostly bright paper, and
 * frost over it reads flat — HANDOFF rule 6).
 *
 * Renders the 6 contract fields: store, date, items, total, category,
 * handwritten notes. With `loading`, the same layout renders as a skeleton so
 * the wait reads as the receipt developing rather than a spinner.
 *
 * Long receipts don't get their own card. The card is a confirmation surface —
 * "right store, right total?" — not a document viewer, so it stays one fixed
 * size and one typography whether you scanned a coffee or a grocery run. The
 * item area caps at MAX_ROWS: at or under, every item lists; over, the last
 * row becomes a count. That costs one row, only when it's needed, and the card
 * never claims to have captured less than it did. The full list is in the edit
 * sheet, which owns the screen and can scroll without fighting the swipe.
 *
 * Sizes take the card's scale `s` (= width / 300), like the rest of the card.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { HeaderAurora } from '@/components/receipt/HeaderAurora';
import { colors, fontFamily } from '@/theme/tokens';
import type { ReceiptFields } from '@/lib/receipts/types';

// Padding of ReceiptCard's bare-with-children body — the header bleeds by these
// to reach the card edges (kept in sync with ui/ReceiptCard.tsx).
const CARD_PAD_X = 18;
const CARD_PAD_TOP = 16;

/** Rows the item area can hold. The last is spent on the count only if needed. */
const MAX_ROWS = 6;

const money = (n: number) => n.toFixed(2);

/** Items to print, plus how many are left over. */
function visibleItems(items: string[]): { shown: string[]; hidden: number } {
  if (items.length <= MAX_ROWS) return { shown: items, hidden: 0 };
  return { shown: items.slice(0, MAX_ROWS - 1), hidden: items.length - (MAX_ROWS - 1) };
}

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
  const { shown, hidden } = visibleItems(fields?.items ?? []);
  const [header, setHeader] = useState({ w: 0, h: 0 });

  const bleedX = CARD_PAD_X * s;
  const bleedTop = CARD_PAD_TOP * s;

  return (
    <View style={styles.root}>
      {/* Header — store + date over the pastel aurora mesh (Figma 22:4).
          Bleeds by the card's padding so the mesh reaches the paper edges. */}
      <View
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setHeader((p) => (p.w === width && p.h === height ? p : { w: width, h: height }));
        }}
        style={{
          marginTop: -bleedTop,
          marginHorizontal: -bleedX,
          paddingTop: bleedTop + 14 * s,
          paddingBottom: 12 * s,
          paddingHorizontal: bleedX,
          borderTopLeftRadius: 8 * s,
          borderTopRightRadius: 8 * s,
          overflow: 'hidden',
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <HeaderAurora width={header.w} height={header.h} />
        </View>

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
      </View>

      {/* Items */}
      <View style={[styles.items, { marginTop: 12 * s, gap: 7 * s }]}>
        {loading || !fields ? (
          [0, 1, 2].map((i) => <Bar key={i} w={i === 2 ? '55%' : '80%'} s={s} />)
        ) : (
          <>
            {shown.map((line, i) => (
              <Text
                key={`${line}-${i}`}
                numberOfLines={1}
                style={{ fontFamily: fontFamily.regular, fontSize: 11 * s, color: colors.textSecondary }}
              >
                {line}
              </Text>
            ))}
            {hidden > 0 && (
              <Text style={{ fontFamily: fontFamily.semibold, fontSize: 11 * s, color: colors.textFaint }}>
                +{hidden} more
              </Text>
            )}
          </>
        )}
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
