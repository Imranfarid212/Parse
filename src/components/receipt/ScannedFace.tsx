/**
 * ScannedFace — the post-capture receipt card.
 *
 * For now it's an EMPTY card in the shared "silver receipt" theme (see
 * receiptTheme) — same header/footer bands, seam, keyline and torn edge as the
 * onboarding card. Its body content (store, items, total, …) is filled in later.
 *
 * The outer `<View style={{ width }}>` wrapper and the Skia `TornEdge` are kept
 * exactly as the flight animation in ReceiptReview needs them: the flight scales
 * the whole card, and the torn teeth must be a Skia layer to scale on iOS (RN
 * border-triangle teeth don't follow a parent scale). Sizes take the card's
 * scale `s` (= width / 340, matching the theme's design width).
 */
import React from 'react';
import { StyleSheet, View, type BoxShadowValue } from 'react-native';

import { BandFill, DashedLine, headerKeylinePath, ReceiptFooter, SEAM } from '@/components/ui/receiptTheme';
import { TornEdge } from '@/components/receipt/TornEdge';
import type { ReceiptFields } from '@/lib/receipts/types';

const RING = 'rgba(17,24,39,0.06)'; // gray-900/6 — 1px ring around the card

// Band heights in design units (the 340-wide Figma card).
const HEADER_U = 72;
const BODY_MIN_U = 176;
const FOOTER_U = 88.4;
const TEETH_U = 8;

/**
 * The card's rendered height for a given width, without waiting on a layout
 * pass. Deterministic while the body is empty, which lets the review screen's
 * feed animation size its window immediately instead of depending on an
 * onLayout that reports 0 from inside a collapsed parent.
 *
 * The seam's +1 and the torn edge's -1 overlap cancel out.
 * Revisit once the body carries real content and can grow.
 */
export function scannedFaceHeight(width: number) {
  return (HEADER_U + BODY_MIN_U + FOOTER_U + TEETH_U) * (width / 340);
}

/** Wide, soft, diffuse card shadow (spec: 0 12px 40px rgba(0,0,0,0.06)). */
const softShadow = (s: number): BoxShadowValue[] => [
  { offsetX: 0, offsetY: 12 * s, blurRadius: 40 * s, color: 'rgba(0,0,0,0.06)' },
];

// `fields` / `loading` stay in the props (ReceiptReview passes them) for when
// the body is authored; the empty card doesn't read them yet.
export function ScannedFace({ width }: { width: number; fields?: ReceiptFields | null; loading?: boolean }) {
  const s = width / 340;
  const r = 18 * s; // rounded top corners — matches the theme keyline radius
  const bandW = width;
  const headerH = HEADER_U * s;
  const bodyMinH = BODY_MIN_U * s; // placeholder floor — real content will grow past this
  const footerH = FOOTER_U * s;
  const keyline = headerKeylinePath(bandW, headerH, r);

  return (
    <View style={{ width }}>
      {/* Shadow on the outer wrapper. Clipping (below) is border-free — a
          border on the same view that clips a Skia child broke the corner
          radius, so the ring is drawn separately, on top, non-clipping. */}
      <View style={{ borderTopLeftRadius: r, borderTopRightRadius: r, boxShadow: softShadow(s) }}>
        <View style={[styles.clip, { borderTopLeftRadius: r, borderTopRightRadius: r }]}>
          {/* Header band — silver, empty for now; dashed perforation at its foot. */}
          <View style={{ height: headerH, paddingHorizontal: 24 * s, paddingBottom: 12 * s, justifyContent: 'flex-end', overflow: 'hidden' }}>
            <BandFill w={bandW} h={headerH} keyline={keyline} />
            <DashedLine s={s} />
          </View>

          {/* Seam — the header's clean bottom edge. */}
          <View style={{ height: 1, backgroundColor: SEAM }} />

          {/* White body — auto-sizes to its content (currently empty, so it
              sits at bodyMinH). Real content (items, total, notes) will push
              this taller naturally; ReceiptReview's onLayout measurement
              already picks up whatever height the card ends up rendering. */}
          <View style={{ minHeight: bodyMinH, backgroundColor: '#FFFFFF' }} />

          {/* Shared silver footer band (barcode + brand line). */}
          <ReceiptFooter s={s} bandW={bandW} footerH={footerH} />
        </View>

        {/* Ring overlay — same rounded rect, border only, no clipping. */}
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

      {/* Torn bottom edge — Skia layer, so it scales with the card in flight. */}
      <View style={{ marginTop: -1 }}>
        <TornEdge width={width} s={s} color="#FFFFFF" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Pure clip: overflow + radius only, no border — a border here previously
  // interfered with clipping the Skia band children. The ring is a separate
  // non-clipping overlay (see below).
  clip: { overflow: 'hidden', backgroundColor: '#fff' },
});
