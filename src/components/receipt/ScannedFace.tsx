/**
 * ScannedFace — the post-capture receipt card.
 *
 * This keeps the shared silver receipt template from the onboarding/receipt
 * redesign and treats extraction data as component content: header fields in
 * the silver band, receipt details in the white body, shared footer/torn edge
 * untouched.
 */
import React from 'react';
import { StyleSheet, Text, View, type BoxShadowValue } from 'react-native';

import { TornEdge } from '@/components/receipt/TornEdge';
import { BandFill, DashedLine, headerKeylinePath, ReceiptFooter, SEAM } from '@/components/ui/receiptTheme';
import type { ReceiptFields } from '@/lib/receipts/types';
import { fontFamily } from '@/theme/tokens';

const RING = 'rgba(17,24,39,0.06)';
const INK = '#111827';
const MUTED = '#6B7280';
const FAINT = '#E5E7EB';
const PAPER = '#FFFFFF';
const TAG = '#F9FAFB';

const HEADER_U = 72;
const BODY_MIN_U = 176;
const FOOTER_U = 88.4;
const TEETH_U = 8;
const MAX_ITEMS = 4;

export function scannedFaceHeight(width: number) {
  return (HEADER_U + BODY_MIN_U + FOOTER_U + TEETH_U) * (width / 340);
}

const softShadow = (s: number): BoxShadowValue[] => [
  { offsetX: 0, offsetY: 12 * s, blurRadius: 40 * s, color: 'rgba(0,0,0,0.06)' },
];

const FALLBACK_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
};

function money(n: number, currency: string) {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(n);
  } catch {
    return `${FALLBACK_SYMBOLS[code] ?? `${code} `}${n.toFixed(2)}`;
  }
}

function prettyDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}

function Placeholder({ width, height, s }: { width: number | `${number}%`; height: number; s: number }) {
  return <View style={{ width, height: height * s, borderRadius: 5 * s, backgroundColor: FAINT }} />;
}

export function ScannedFace({ width, fields, loading = false }: { width: number; fields?: ReceiptFields | null; loading?: boolean }) {
  const s = width / 340;
  const r = 18 * s;
  const bandW = width;
  const headerH = HEADER_U * s;
  const bodyMinH = BODY_MIN_U * s;
  const footerH = FOOTER_U * s;
  const keyline = headerKeylinePath(bandW, headerH, r);
  const final = Boolean(fields && !loading);
  const currency = fields?.currency ?? 'USD';
  const items = fields?.items ?? [];
  const shown = items.slice(0, MAX_ITEMS);
  const hidden = Math.max(0, items.length - shown.length);

  return (
    <View style={{ width }}>
      <View style={{ borderTopLeftRadius: r, borderTopRightRadius: r, boxShadow: softShadow(s) }}>
        <View style={[styles.clip, { borderTopLeftRadius: r, borderTopRightRadius: r }]}>
          <View style={{ height: headerH, paddingHorizontal: 24 * s, paddingBottom: 12 * s, justifyContent: 'flex-end', overflow: 'hidden' }}>
            <BandFill w={bandW} h={headerH} keyline={keyline} />
            <View style={[styles.headerContent, { left: 24 * s, right: 24 * s, bottom: 24 * s }]}>
              {fields ? (
                <>
                  <Text numberOfLines={1} style={[styles.store, { fontSize: 19 * s }]}>
                    {fields.store || 'Unknown store'}
                  </Text>
                  <Text style={[styles.date, { fontSize: 11 * s, marginTop: 3 * s }]}>{prettyDate(fields.date)}</Text>
                </>
              ) : (
                <View style={{ gap: 7 * s }}>
                  <Placeholder width="62%" height={11} s={s} />
                  <Placeholder width="38%" height={8} s={s} />
                </View>
              )}
            </View>
            <DashedLine s={s} />
          </View>

          <View style={{ height: 1, backgroundColor: SEAM }} />

          <View style={{ minHeight: bodyMinH, backgroundColor: PAPER, paddingHorizontal: 20 * s, paddingTop: 16 * s, paddingBottom: 14 * s }}>
            <Text style={[styles.eyebrow, { fontSize: 10 * s }]}>ITEMS</Text>
            <View style={{ marginTop: 8 * s, gap: 7 * s }}>
              {!final ? (
                <>
                  <View style={styles.itemRow}>
                    <Placeholder width="64%" height={9} s={s} />
                    <Placeholder width={42 * s} height={9} s={s} />
                  </View>
                  <View style={styles.itemRow}>
                    <Placeholder width="55%" height={9} s={s} />
                    <Placeholder width={38 * s} height={9} s={s} />
                  </View>
                  <View style={styles.itemRow}>
                    <Placeholder width="46%" height={9} s={s} />
                    <Placeholder width={44 * s} height={9} s={s} />
                  </View>
                </>
              ) : (
                <>
                  {shown.map((item, i) => {
                    return (
                      <View key={`${item.name}-${i}`} style={styles.itemRow}>
                        <Text numberOfLines={1} style={[styles.itemName, { fontSize: 14 * s }]}>
                          {item.qty !== 1 ? `${item.qty} × ` : ''}{item.name}
                        </Text>
                        <Text style={[styles.itemPrice, { fontSize: 14 * s }]}>{money(item.amount, currency)}</Text>
                      </View>
                    );
                  })}
                  {hidden > 0 ? <Text style={[styles.more, { fontSize: 12 * s }]}>+{hidden} more</Text> : null}
                </>
              )}
            </View>

            <View style={[styles.dashed, { marginTop: 12 * s }]} />
            <View style={[styles.totalRow, { marginTop: 12 * s }]}>
              <Text style={[styles.totalLabel, { fontSize: 15 * s }]}>Total</Text>
              {final && fields ? (
                <Text style={[styles.total, { fontSize: 17 * s }]}>{money(fields.total, currency)}</Text>
              ) : (
                <Placeholder width={82 * s} height={12} s={s} />
              )}
            </View>

            {final && fields?.handwritten_notes ? (
              <View style={{ marginTop: 14 * s, gap: 8 * s }}>
                <Text style={[styles.eyebrow, { fontSize: 10 * s }]}>NOTES</Text>
                <Text style={[styles.notes, { fontSize: 13 * s, lineHeight: 18 * s }]}>{fields.handwritten_notes}</Text>
              </View>
            ) : null}

            <View style={{ marginTop: 14 * s, alignItems: 'center' }}>
              {final && fields ? (
                <View style={[styles.tag, { paddingHorizontal: 12 * s, paddingVertical: 6 * s }]}>
                  <Text numberOfLines={1} style={[styles.tagText, { fontSize: 11.5 * s }]}>
                    {fields.category}
                  </Text>
                </View>
              ) : (
                <Placeholder width={96 * s} height={12} s={s} />
              )}
            </View>
          </View>

          <ReceiptFooter s={s} bandW={bandW} footerH={footerH} />
        </View>

        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderTopLeftRadius: r,
            borderTopRightRadius: r,
            borderWidth: 1,
            borderBottomWidth: 0,
            borderColor: RING,
          }}
        />
      </View>

      <View style={{ marginTop: -1 }}>
        <TornEdge width={width} s={s} color={PAPER} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden', backgroundColor: PAPER },
  headerContent: { position: 'absolute', alignItems: 'center' },
  store: { fontFamily: fontFamily.display, color: INK, letterSpacing: 0.4 },
  date: { fontFamily: fontFamily.semibold, color: MUTED, letterSpacing: 0.9 },
  eyebrow: { fontFamily: fontFamily.display, letterSpacing: 1.3, color: '#9CA3AF' },
  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  itemName: { flex: 1, fontFamily: fontFamily.regular, color: INK },
  itemPrice: { fontFamily: fontFamily.semibold, color: INK, letterSpacing: 0.6 },
  more: { fontFamily: fontFamily.semibold, color: '#9CA3AF' },
  dashed: { borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: FAINT },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalLabel: { fontFamily: fontFamily.display, color: INK, letterSpacing: 0.6 },
  total: { fontFamily: fontFamily.display, color: INK, letterSpacing: 0.5 },
  notes: { fontFamily: fontFamily.regular, color: MUTED },
  tag: { alignSelf: 'center', backgroundColor: TAG, borderWidth: 1, borderColor: FAINT, borderRadius: 999 },
  tagText: { fontFamily: fontFamily.semibold, color: '#374151' },
});
