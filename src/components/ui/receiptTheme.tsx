/**
 * receiptTheme — the shared "silver receipt" look, used by both the onboarding
 * card (CategoryChecklist) and the post-capture review card (ScannedFace) so a
 * tweak to the palette or the band chrome lands on both at once.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Canvas, LinearGradient, Path, Rect, vec } from '@shopify/react-native-skia';

import { fontFamily } from '@/theme/tokens';

// Reference 2 — horizontal 5-stop band gradient (left→right). Reference 1's
// greys are saved in memory for swap-back.
export const BAND_COLORS = ['#e2e3e4', '#eef0f0', '#f7f8f8', '#eff0f0', '#dee0e1'];
export const BAND_LOCS = [0, 0.18, 0.46, 0.76, 1];
export const SEAM = '#c4c6ca'; // continuous line marking a band's clean edge
export const DASH = '#b1b3b8'; // dashed perforation lines
export const HEADER_STROKE = '#9099a1'; // thin keyline framing the header
const FOOTER_INK = '#1a1815'; // barcode bars + brand line
const FOOTER_MUTED = '#8a877e'; // barcode caption

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
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={w} height={h}>
        <LinearGradient start={vec(0, h / 2)} end={vec(w, h / 2)} colors={BAND_COLORS} positions={BAND_LOCS} />
      </Rect>
      {keyline ? <Path path={keyline} style="stroke" strokeWidth={0.26} color={HEADER_STROKE} strokeJoin="round" /> : null}
    </Canvas>
  );
}

/** A dashed perforation line spanning `widthUnits` design px (scaled by `s`). */
export function DashedLine({ s, widthUnits = 292 }: { s: number; widthUnits?: number }) {
  const dash = 4 * s;
  const gap = 3 * s;
  const n = Math.ceil((widthUnits * s) / (dash + gap));
  return (
    <View style={{ height: 1, flexDirection: 'row', overflow: 'hidden' }}>
      {Array.from({ length: n }).map((_, i) => (
        <View key={i} style={{ width: dash, height: 1, marginRight: gap, backgroundColor: DASH }} />
      ))}
    </View>
  );
}

/** The full silver footer band: gradient fill, dashed perforation, barcode and
 *  the "PARSE · SMART RECEIPTS" brand line. Shared across receipt cards. */
export function ReceiptFooter({ s, bandW, footerH }: { s: number; bandW: number; footerH: number }) {
  return (
    <View style={{ height: footerH, paddingHorizontal: 24 * s, paddingVertical: 12 * s, gap: 8 * s, alignItems: 'center', overflow: 'hidden' }}>
      <BandFill w={bandW} h={footerH} />

      <DashedLine s={s} />

      <View style={{ alignItems: 'center', gap: 2 * s }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', height: 17.64 * s }}>
          {BAR_WIDTHS.map((w, i) => (
            <View key={i} style={{ width: w * s, height: 17.64 * s, marginRight: i < BAR_WIDTHS.length - 1 ? 1 * s : 0, backgroundColor: FOOTER_INK }} />
          ))}
        </View>
        <Text style={{ fontFamily: fontFamily.regular, fontSize: 8 * s, color: FOOTER_MUTED }}>* 1024 88952 *</Text>
      </View>

      <Text style={{ fontFamily: fontFamily.semibold, fontSize: 10 * s, letterSpacing: 0.5 * s, color: FOOTER_INK, textTransform: 'uppercase' }}>
        PARSE · SMART RECEIPTS
      </Text>
    </View>
  );
}
