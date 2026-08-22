/**
 * receiptTheme — the shared "silver receipt" look, used by both the onboarding
 * card (CategoryChecklist) and the post-capture review card (ScannedFace) so a
 * tweak to the palette or the band chrome lands on both at once.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Canvas, LinearGradient, Path, Rect, vec } from '@shopify/react-native-skia';

import { usePaper } from '@/theme/appearance';
import { fontFamily } from '@/theme/tokens';

// Reference 2 — horizontal 5-stop band gradient (left→right).
// The band/seam/dash/ink values now live in `paper` on the theme so the whole
// receipt can be dimmed for dark mode; only the stop positions are fixed.
export const BAND_LOCS = [0, 0.18, 0.46, 0.76, 1];

// Exact barcode bar widths (px) from Figma node 422:307, in order.
const BAR_WIDTHS = [2, 1, 3, 1, 4, 1, 2, 3, 1, 2, 4, 1, 1, 3, 2, 1, 4, 2, 1, 3, 1, 2, 4, 1, 2, 1, 3, 1];

/**
 * Path for the header keyline: up the left side, around the rounded top, down
 * the right side (open at the bottom — the seam line closes it). Inset by the
 * stroke width and radius reduced to match, so it sits inside the card's rounded
 * clip instead of being shaved off at the curves.
 */
export function headerKeylinePath(bandW: number, headerH: number, cornerRadius: number) {
  const ins = 1;
  const kr = cornerRadius - ins;
  const right = bandW - ins;
  return `M ${ins} ${headerH} L ${ins} ${ins + kr} Q ${ins} ${ins} ${ins + kr} ${ins} L ${right - kr} ${ins} Q ${right} ${ins} ${right} ${ins + kr} L ${right} ${headerH}`;
}

/** Absolute-fill Skia gradient for a header/footer band, plus an optional keyline. */
export function BandFill({ w, h, keyline }: { w: number; h: number; keyline?: string }) {
  const paper = usePaper();
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={w} height={h}>
        <LinearGradient start={vec(0, h / 2)} end={vec(w, h / 2)} colors={[...paper.band]} positions={BAND_LOCS} />
      </Rect>
      {keyline ? <Path path={keyline} style="stroke" strokeWidth={0.26} color={paper.headerStroke} strokeJoin="round" /> : null}
    </Canvas>
  );
}

/** A dashed perforation line spanning `widthUnits` design px (scaled by `s`). */
export function DashedLine({ s, widthUnits = 292 }: { s: number; widthUnits?: number }) {
  const paper = usePaper();
  const dash = 4 * s;
  const gap = 3 * s;
  const n = Math.ceil((widthUnits * s) / (dash + gap));
  return (
    <View style={{ height: 1, flexDirection: 'row', overflow: 'hidden' }}>
      {Array.from({ length: n }).map((_, i) => (
        <View key={i} style={{ width: dash, height: 1, marginRight: gap, backgroundColor: paper.dash }} />
      ))}
    </View>
  );
}

/** The full silver footer band: gradient fill, dashed perforation, barcode and
 *  the "PARSE · SMART RECEIPTS" brand line. Shared across receipt cards. */
export function ReceiptFooter({ s, bandW, footerH }: { s: number; bandW: number; footerH: number }) {
  const paper = usePaper();
  return (
    <View style={{ height: footerH, paddingHorizontal: 24 * s, paddingVertical: 12 * s, gap: 8 * s, alignItems: 'center', overflow: 'hidden' }}>
      <BandFill w={bandW} h={footerH} />

      <DashedLine s={s} />

      <View style={{ alignItems: 'center', gap: 2 * s }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', height: 17.64 * s }}>
          {BAR_WIDTHS.map((w, i) => (
            <View key={i} style={{ width: w * s, height: 17.64 * s, marginRight: i < BAR_WIDTHS.length - 1 ? 1 * s : 0, backgroundColor: paper.footerInk }} />
          ))}
        </View>
        <Text style={{ fontFamily: fontFamily.regular, fontSize: 8 * s, color: paper.footerMuted }}>* 1024 88952 *</Text>
      </View>

      <Text style={{ fontFamily: fontFamily.semibold, fontSize: 10 * s, letterSpacing: 0.5 * s, color: paper.footerInk, textTransform: 'uppercase' }}>
        PARSE · SMART RECEIPTS
      </Text>
    </View>
  );
}
