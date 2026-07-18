/**
 * ScannedFace — the scanned receipt.
 *
 * One card, not two: a tinted header region (store + date) sits directly on the
 * white body (items / total / notes / category) with NO radius or gap at the
 * seam, so they read as a single sheet — rounded top, torn bottom. Grey-only
 * hierarchy (weights, tracking, tabular numerals) per the design tokens.
 *
 * The card shares one ring + one soft shadow (shadow on an outer wrapper, ring
 * on an inner overflow-hidden clip so the top corners round cleanly).
 * Sizes take the card's scale `s` (= width / 300).
 */
import React from 'react';
import { StyleSheet, Text, View, type BoxShadowValue } from 'react-native';

import { TornEdge } from '@/components/receipt/TornEdge';
import { fontFamily } from '@/theme/tokens';
import type { ReceiptFields } from '@/lib/receipts/types';

/** Spec greys (Tailwind scale) — kept local so the receipt matches the spec exactly. */
const GRAY = {
  900: '#111827',
  700: '#374151',
  500: '#6B7280',
  400: '#9CA3AF',
  200: '#E5E7EB',
  100: '#F3F4F6',
  50: '#F9FAFB',
  ring: 'rgba(17,24,39,0.06)', // gray-900/6
} as const;

/**
 * Header tint experiment: step 1 = off-white (#F9FAFB) → step 6 = silver
 * (#C0C4CB), evenly interpolated. Steps: 1 #F9FAFB · 2 #EEEFF1 · 3 #E2E4E8 ·
 * 4 #D7DADE · 5 #CCCFD5 · 6 #C0C4CB.
 */
const HEADER_TINT = '#ECEDEF'; // step 2.2
const HEADER_LIGHT = '#F1F2F4'; // the reflection band (subtle)

// A 45° gradient (bottom-left → top-right) that holds the base, brightens
// through a thick middle band, then returns to base — one diagonal light streak.
const HEADER_GRADIENT = [
  {
    type: 'linear-gradient' as const,
    direction: '45deg',
    colorStops: [
      { color: HEADER_TINT, positions: ['0%'] },
      { color: HEADER_TINT, positions: ['34%'] },
      { color: HEADER_LIGHT, positions: ['50%'] },
      { color: HEADER_TINT, positions: ['66%'] },
      { color: HEADER_TINT, positions: ['100%'] },
    ],
  },
];

/** Items shown before the rest collapse into a "+N more" row. */
const MAX_ITEMS = 4;

/** Wide, soft, diffuse card shadow (spec: 0 12px 40px rgba(0,0,0,0.06)). */
const softShadow = (s: number): BoxShadowValue[] => [
  { offsetX: 0, offsetY: 12 * s, blurRadius: 40 * s, color: 'rgba(0,0,0,0.06)' },
];

const money = (n: number) => n.toFixed(2);

/** Split a trailing price off an item string; no price → the line is the name. */
function parseItem(line: string): { name: string; price: string } {
  const m = line.match(/^(.*?)[\s]+\$?(\d[\d,]*\.\d{2})$/);
  if (!m) return { name: line.trim(), price: '' };
  return { name: m[1].trim(), price: m[2] };
}

function visibleItems(items: string[]): { shown: string[]; hidden: number } {
  if (items.length <= MAX_ITEMS) return { shown: items, hidden: 0 };
  return { shown: items.slice(0, MAX_ITEMS), hidden: items.length - MAX_ITEMS };
}

/** "2026-07-04" → "4 Jul 2026". Null dates print as a dash for the user to fix. */
function prettyDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function Bar({ w, s, h = 9 }: { w: number | `${number}%`; s: number; h?: number }) {
  return <View style={{ width: w, height: h * s, borderRadius: 5 * s, backgroundColor: GRAY[100] }} />;
}

function Eyebrow({ children, s }: { children: string; s: number }) {
  return (
    <Text style={{ fontFamily: fontFamily.display, fontSize: 10 * s, letterSpacing: 1.5 * s, color: GRAY[400] }}>
      {children}
    </Text>
  );
}

export function ScannedFace({ width, fields, loading = false }: { width: number; fields?: ReceiptFields | null; loading?: boolean }) {
  const s = width / 300;
  const r = 20 * s;
  const { shown, hidden } = visibleItems(fields?.items ?? []);
  const busy = loading || !fields;

  return (
    <View style={{ width }}>
      {/* Shadow on the outer wrapper; ring + rounded top on the clip. */}
      <View style={{ borderTopLeftRadius: r, borderTopRightRadius: r, boxShadow: softShadow(s) }}>
        <View style={[styles.clip, { borderTopLeftRadius: r, borderTopRightRadius: r }]}>
          {/* Header region — tinted, no radius at the seam. */}
          <View style={{ backgroundColor: HEADER_TINT, experimental_backgroundImage: HEADER_GRADIENT, paddingVertical: 14 * s, paddingHorizontal: 18 * s, alignItems: 'center' }}>
            {busy ? (
              <View style={{ alignItems: 'center', gap: 7 * s }}>
                <Bar w="60%" s={s} h={12} />
                <Bar w="34%" s={s} />
              </View>
            ) : (
              <>
                <Text
                  numberOfLines={1}
                  style={{ fontFamily: fontFamily.display, fontSize: 22 * s, color: GRAY[900], letterSpacing: 0.6 * s }}
                >
                  {fields.store || 'Unknown store'}
                </Text>
                <Text
                  style={{ fontFamily: fontFamily.semibold, fontSize: 12 * s, color: GRAY[500], marginTop: 3 * s, letterSpacing: 1 * s }}
                >
                  {prettyDate(fields.date)}
                </Text>
              </>
            )}
          </View>

          {/* Body region — white, flush under the header. */}
          <View style={{ backgroundColor: '#FFFFFF', paddingHorizontal: 18 * s, paddingTop: 16 * s, paddingBottom: 14 * s }}>
            {/* Items */}
            <Eyebrow s={s}>ITEMS</Eyebrow>
            <View style={{ marginTop: 8 * s, gap: 7 * s }}>
              {busy ? (
                [0, 1, 2].map((i) => (
                  <View key={i} style={styles.itemRow}>
                    <Bar w={i === 2 ? '45%' : '62%'} s={s} />
                    <Bar w={40 * s} s={s} />
                  </View>
                ))
              ) : (
                <>
                  {shown.map((line, i) => {
                    const { name, price } = parseItem(line);
                    return (
                      <View key={`${line}-${i}`} style={styles.itemRow}>
                        <Text numberOfLines={1} style={{ flex: 1, fontFamily: fontFamily.regular, fontSize: 15 * s, color: GRAY[900] }}>
                          {name}
                        </Text>
                        {price ? (
                          <Text style={{ fontFamily: fontFamily.semibold, fontSize: 15 * s, color: GRAY[900], letterSpacing: 1 * s }}>
                            ${price}
                          </Text>
                        ) : null}
                      </View>
                    );
                  })}
                  {hidden > 0 && (
                    <Text style={{ fontFamily: fontFamily.semibold, fontSize: 13 * s, color: GRAY[400] }}>+{hidden} more</Text>
                  )}
                </>
              )}
            </View>

            {/* Total — dashed financial divider */}
            <View style={[styles.dashed, { marginTop: 12 * s, borderTopColor: GRAY[200] }]} />
            <View style={[styles.totalRow, { marginTop: 12 * s }]}>
              <Text style={{ fontFamily: fontFamily.display, fontSize: 15 * s, color: GRAY[900], letterSpacing: 0.8 * s }}>Total</Text>
              {busy ? (
                <Bar w={80 * s} s={s} h={12} />
              ) : (
                <Text style={{ fontFamily: fontFamily.display, fontSize: 17 * s, color: GRAY[900], letterSpacing: 0.6 * s }}>
                  ${money(fields.total)}
                </Text>
              )}
            </View>

            {/* Notes */}
            {!busy && fields.handwritten_notes ? (
              <View style={{ marginTop: 14 * s, gap: 8 * s }}>
                <Eyebrow s={s}>NOTES</Eyebrow>
                <Text style={{ fontFamily: fontFamily.regular, fontSize: 13 * s, color: GRAY[500], lineHeight: 18 * s }}>
                  {fields.handwritten_notes}
                </Text>
              </View>
            ) : null}

            {/* Category — low-contrast tag */}
            <View style={{ marginTop: 14 * s, alignItems: 'center' }}>
              {busy ? (
                <Bar w={96 * s} s={s} h={12} />
              ) : (
                <View style={[styles.tag, { paddingHorizontal: 12 * s, paddingVertical: 6 * s, borderRadius: 999, borderColor: GRAY[200] }]}>
                  <Text numberOfLines={1} style={{ fontFamily: fontFamily.semibold, fontSize: 11.5 * s, color: GRAY[700] }}>
                    {fields.category}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
      </View>

      {/* Torn bottom edge — white teeth flush under the body. */}
      <View style={{ marginTop: -1 }}>
        <TornEdge width={width} s={s} color="#FFFFFF" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 1px ring on the whole card; bottom open so the teeth attach seamlessly.
  clip: { overflow: 'hidden', borderWidth: 1, borderBottomWidth: 0, borderColor: GRAY.ring },
  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dashed: { borderTopWidth: 1, borderStyle: 'dashed' },
  tag: { alignSelf: 'center', backgroundColor: GRAY[50], borderWidth: 1 },
});
