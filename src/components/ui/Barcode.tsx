/**
 * Barcode — the printed barcode block on a receipt. Bar widths cycle so the
 * pattern reads as a real code; sizes scale with the receipt's `s`.
 *
 * `subtle` swaps the retail look for a watermark: ultra-thin, tightly packed
 * lines in faint grey, so it reads as a design element rather than something
 * you'd scan at a checkout.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

export function Barcode({
  s,
  height = 42,
  bars,
  subtle = false,
}: {
  s: number;
  height?: number;
  bars?: number;
  subtle?: boolean;
}) {
  const count = bars ?? (subtle ? 60 : 34);
  const color = subtle ? 'rgba(17,17,17,0.2)' : '#111';
  const gap = (subtle ? 1.2 : 2) * s;
  const barWidth = (i: number) =>
    subtle ? Math.max(0.6, ((i % 4 === 0 ? 2 : 1)) * 0.8 * s) : Math.max(1, ((i % 3) + 1) * s);

  return (
    <View style={styles.row}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={{ width: barWidth(i), height: height * s, backgroundColor: color, marginRight: i < count - 1 ? gap : 0 }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end' },
});
