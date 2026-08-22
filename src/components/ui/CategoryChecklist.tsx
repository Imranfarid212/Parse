/**
 * CategoryChecklist — the printed face of the FIRST onboarding receipt, a 1:1
 * build of the "Main Receipt Card" Figma component (node 422:239). Everything
 * is a Figma pixel value multiplied by the receipt scale `s` (= card width /
 * 340, the design width), so the layout tracks the card at any size.
 *
 * Bands: Header (114) + Category Checklist (335.6) + Footer (88.4) = 538, which
 * equals ReceiptCard's body height for this card. Purely illustrative — the
 * first two rows read done, the third is the active step.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { BandFill, DashedLine, headerKeylinePath, ReceiptFooter } from '@/components/ui/receiptTheme';
import { usePaper } from '@/theme/appearance';
import { fontFamily } from '@/theme/tokens';

const DESIGN_W = 340;

// Content colours specific to the onboarding card (the band chrome — gradient,
// seam, dash, keyline — lives in receiptTheme so it stays in sync with the
// review card).
const GREEN = '#0e7043'; // selected check circle, filled progress dots
const GREEN_TEXT = '#1b5e3b'; // "YOUR CATEGORIES"
const SPARKLE = '#4d4742'; // ✦ glyphs
const TITLE_INK = '#1a1714'; // "Expense categories"
const MUTED = '#8a877e'; // counts
const SELECTED_TEXT = '#111827'; // selected row label — dark, bold, draws the eye
const UNSELECTED_TEXT = '#6b7280'; // unselected row label — subtle grey
const OUTLINE = '#d1d5db'; // empty (unselected) circle outline
const ROW_BORDER = '#f0eeeb'; // row dividers

const ITEMS = ['Travel & Gas', 'Meals and Entertainment', 'Office & Software', 'Professional Fees', 'Marketing Expenses', 'Miscellaneous'];
const DONE = 3; // first 3 rows selected (checked green); rest unselected
const NUM_DOTS = 18;
const FILLED_DOTS = Math.round((DONE / ITEMS.length) * NUM_DOTS); // meter tracks DONE (3/6 → 9)
const ROW_H = 335.6 / 6; // 55.933

function Circle({ selected, s }: { selected: boolean; s: number }) {
  const d = 23.8 * s;
  const base = { width: d, height: d, borderRadius: 11.9 * s, alignItems: 'center', justifyContent: 'center' } as const;

  if (selected) {
    return (
      <View style={[base, { backgroundColor: GREEN }]}>
        <Feather name="check" size={13 * s} color="#fff" />
      </View>
    );
  }
  // Unselected: a clean empty grey outline — no number, so the list reads as a
  // multi-select pick list rather than a ranked sequence.
  return <View style={[base, { borderWidth: 1.4 * s, borderColor: OUTLINE }]} />;
}

export function CategoryChecklist({ s, empty = false }: { s: number; empty?: boolean }) {
  const paper = usePaper();
  const bandW = DESIGN_W * s; // equals the card width in px
  const headerH = 97 * s; // tightened after moving the progress meter inline
  const footerH = 88.4 * s;

  const keyline = headerKeylinePath(bandW, headerH, 18 * s);

  return (
    <View style={styles.root}>
      {/* Header Area — silver band gradient + keyline; overflow hidden keeps the
          Skia layer strictly inside the band so the body below stays white. */}
      <View style={{ height: headerH, paddingHorizontal: 24 * s, paddingTop: 24 * s, paddingBottom: 12 * s, gap: 12 * s, overflow: 'hidden' }}>
        <BandFill w={bandW} h={headerH} keyline={keyline} />

        <Text style={{ textAlign: 'center', fontFamily: fontFamily.semibold, fontSize: 13 * s, letterSpacing: 0.8 * s, textTransform: 'uppercase' }}>
          <Text style={{ color: SPARKLE }}>✦ </Text>
          <Text style={{ color: GREEN_TEXT }}>YOUR CATEGORIES</Text>
          <Text style={{ color: SPARKLE }}> ✦</Text>
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontFamily: fontFamily.medium, fontSize: 16 * s, color: TITLE_INK }}>Expense categories</Text>
          {/* Modern segmented progress meter — thin vertical bars, inline to the
              right of the label and left of the count. */}
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginHorizontal: 10 * s }}>
            {Array.from({ length: NUM_DOTS }).map((_, i) => (
              <View
                key={i}
                style={{ width: 2 * s, height: 13 * s, marginRight: i < NUM_DOTS - 1 ? 2 * s : 0, borderRadius: 1 * s, backgroundColor: i < FILLED_DOTS ? GREEN : '#ffffff' }}
              />
            ))}
          </View>
          <Text style={{ fontFamily: fontFamily.semibold, fontSize: 13 * s, color: MUTED }}>
            {DONE}/{ITEMS.length}
          </Text>
        </View>

        {/* Dashed perforation ("line break") on the grey header, just above its
            bottom edge — mirrors the footer's dashed line. */}
        <View style={{ paddingHorizontal: 24 * s }}>
          <DashedLine s={s} />
        </View>
      </View>

      {/* Continuous grey line: the header's clean bottom edge. With the dashed
          line above it, this mirrors the body/footer seam so the header reads as
          a clean block above the white body. */}
      <View style={{ height: 1, backgroundColor: paper.seam }} />

      {/* Category Checklist — full-bleed rows on a pure-white body. `empty`
          renders just the white body (same size) for the not-yet-authored
          cards, which reuse this card's header + footer chrome. */}
      {empty ? (
        <View style={[styles.body, { flex: 1 }]} />
      ) : (
        <View style={styles.body}>
          {ITEMS.map((label, i) => {
            const selected = i < DONE;
            return (
              <View key={label} style={{ height: ROW_H * s, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20 * s, borderBottomWidth: 1, borderBottomColor: ROW_BORDER }}>
                <Circle selected={selected} s={s} />
                <Text
                  numberOfLines={1}
                  style={{
                    flex: 1,
                    marginLeft: 14 * s,
                    fontFamily: selected ? fontFamily.semibold : fontFamily.regular,
                    fontSize: 13.5 * s,
                    color: selected ? SELECTED_TEXT : UNSELECTED_TEXT,
                  }}
                >
                  {label}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Receipt Footer — shared silver band with barcode + brand line. */}
      <ReceiptFooter s={s} bandW={bandW} footerH={footerH} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  body: { backgroundColor: '#ffffff' },
});
