/**
 * TornEdge — the jagged receipt-bottom row of white teeth. Same construction as
 * ReceiptCard's built-in edge (16 downward triangles), pulled out so the split
 * body card can reuse the exact tooth appearance.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

const ZIG = 16;

export function TornEdge({ width, s = 1, color = '#fff' }: { width: number; s?: number; color?: string }) {
  const toothHalf = width / ZIG / 2;
  const toothH = 12 * s;
  return (
    <View style={styles.row}>
      {Array.from({ length: ZIG }).map((_, i) => (
        <View
          key={i}
          style={{
            width: 0,
            height: 0,
            borderLeftWidth: toothHalf,
            borderRightWidth: toothHalf,
            borderTopWidth: toothH,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderTopColor: color,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row' } });
