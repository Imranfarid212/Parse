/**
 * ReceiptCard — blank receipt PAPER: the card body, its shadow and the torn
 * zigzag bottom, with no printed content of its own.
 *
 * It used to carry a second printed face as well — its own header, totals and
 * barcode — which the Search fan rendered. That was a duplicate of ScannedFace
 * in everything but the code, and the two drifted. The fan now renders
 * ScannedFace directly, so the printed path is gone and this is only the paper
 * that `children` prints onto.
 */
import React from 'react';
import { View } from 'react-native';

import { makeStyles, usePaper } from '@/theme/appearance';

const ZIG = 16;

export function ReceiptCard({
  width,
  height,
  bare = false,
  children,
}: {
  width: number;
  height: number;
  /** Blank paper: no printed content (grey panel), unless `children` is given. */
  bare?: boolean;
  /** Printed face for the `bare` receipt. Receives the card's scale `s`. When
   *  omitted, the bare card shows just a faint grey panel. */
  children?: (s: number) => React.ReactNode;
}) {
  const styles = useStyles();
  const paper = usePaper();
  const s = width / 300; // design width is 300
  const toothHalf = width / ZIG / 2;
  const toothH = 12 * s;
  const pad = 22 * s;

  // Torn paper edge along the bottom of the card.
  const tornEdge = (
    <View style={styles.zigzag}>
      {Array.from({ length: ZIG }).map((_, i) => (
        <View
          key={i}
          style={{ width: 0, height: 0, borderLeftWidth: toothHalf, borderRightWidth: toothHalf, borderTopWidth: toothH, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: paper.body }}
        />
      ))}
    </View>
  );

  if (bare && children) {
    // Figma "Main Receipt Card" (node 422:239): a 340-wide design. Scale by
    // k = width/340 so every child pixel value maps 1:1, and the card's body
    // height comes out to 538*k — exactly what CategoryChecklist renders.
    const k = width / 340;
    const zigH = 8 * k; // Figma zigzag is 8px tall
    const teeth = 28; // 340 / ~12px per tooth
    const half = width / teeth / 2;
    return (
      <View
        style={[
          styles.card,
          { width, shadowOpacity: 0.084, shadowRadius: 24 * k, shadowOffset: { width: 0, height: 12 } },
        ]}
      >
        <View style={[styles.body, { height: height - zigH, borderTopLeftRadius: 9 * k, borderTopRightRadius: 9 * k }]}>
          {children(k)}
        </View>
        <View style={styles.zigzag}>
          {Array.from({ length: teeth }).map((_, i) => (
            <View
              key={i}
              style={{ width: 0, height: 0, borderLeftWidth: half, borderRightWidth: half, borderTopWidth: zigH, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: paper.body }}
            />
          ))}
        </View>
      </View>
    );
  }

  if (bare) {
    return (
      <View style={[styles.card, { width, shadowRadius: 20 * s }]}>
        <View style={[styles.body, { height: height - toothH, borderTopLeftRadius: 9 * s, borderTopRightRadius: 9 * s, padding: pad }]}>
          <View style={{ flex: 1, borderRadius: 8 * s, backgroundColor: paper.tint }} />
        </View>

        {tornEdge}
      </View>
    );
  }

}

const useStyles = makeStyles((colors, elevation, isDark, paper) => ({
  // The drop shadow carries the card on light. On dark the dimmed paper is
  // already the brightest thing on screen, so a heavy shadow only muddies the
  // edge — the contrast against the canvas does the separating instead.
  card: { shadowColor: '#000', shadowOpacity: isDark ? 0.45 : 0.15, shadowOffset: { width: 0, height: 10 } },
  body: { backgroundColor: paper.body, overflow: 'hidden' },
  rule: { height: 1, backgroundColor: paper.rule },
  line: { backgroundColor: paper.rule },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  zigzag: { flexDirection: 'row', backgroundColor: 'transparent' },
}));
