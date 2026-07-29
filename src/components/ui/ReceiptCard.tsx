/**
 * ReceiptCard — a paper-receipt-styled card (header, faint placeholder lines,
 * total, barcode, torn zigzag bottom). Content scales with `width` (via s) so
 * it reads correctly both large (onboarding) and small (search fan carousel).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Barcode } from '@/components/ui/Barcode';

const ZIG = 16;

export function ReceiptCard({
  width,
  height,
  total = '45.60',
  bare = false,
  children,
}: {
  width: number;
  height: number;
  total?: string;
  /** Blank paper: no printed content (grey panel), unless `children` is given. */
  bare?: boolean;
  /** Printed face for the `bare` receipt. Receives the card's scale `s`. When
   *  omitted, the bare card shows just a faint grey panel. */
  children?: (s: number) => React.ReactNode;
}) {
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
          style={{ width: 0, height: 0, borderLeftWidth: toothHalf, borderRightWidth: toothHalf, borderTopWidth: toothH, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#fff' }}
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
        <View style={[styles.body, { height: height - zigH, borderTopLeftRadius: 18 * k, borderTopRightRadius: 18 * k }]}>
          {children(k)}
        </View>
        <View style={styles.zigzag}>
          {Array.from({ length: teeth }).map((_, i) => (
            <View
              key={i}
              style={{ width: 0, height: 0, borderLeftWidth: half, borderRightWidth: half, borderTopWidth: zigH, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#fff' }}
            />
          ))}
        </View>
      </View>
    );
  }

  if (bare) {
    return (
      <View style={[styles.card, { width, shadowRadius: 20 * s }]}>
        <View style={[styles.body, { height: height - toothH, borderTopLeftRadius: 18 * s, borderTopRightRadius: 18 * s, padding: pad }]}>
          <View style={{ flex: 1, borderRadius: 8 * s, backgroundColor: 'rgba(17,17,17,0.03)' }} />
        </View>

        {tornEdge}
      </View>
    );
  }

  return (
    <View style={[styles.card, { width, shadowRadius: 20 * s }]}>
      <View style={[styles.body, { height: height - toothH, borderTopLeftRadius: 8 * s, borderTopRightRadius: 8 * s, paddingHorizontal: pad, paddingTop: pad }]}>
        <Text style={{ fontFamily: 'InstrumentSans_700Bold', fontSize: 34 * s, letterSpacing: 1 * s, color: '#111', textAlign: 'center' }}>
          RECEIPT
        </Text>
        <Text style={{ textAlign: 'center', color: '#111', letterSpacing: 4 * s, marginTop: 2 * s, fontSize: 12 * s }}>* * * *</Text>

        <View style={[styles.rule, { marginVertical: 14 * s }]} />
        <View style={[styles.line, { width: '58%', height: 9 * s, borderRadius: 5 * s, alignSelf: 'center' }]} />
        <View style={[styles.line, { width: '42%', height: 9 * s, borderRadius: 5 * s, alignSelf: 'center', marginTop: 6 * s }]} />

        <View style={[styles.rule, { marginVertical: 14 * s }]} />
        <View style={styles.row}>
          <View style={{ gap: 6 * s }}>
            <View style={[styles.line, { width: 88 * s, height: 9 * s, borderRadius: 5 * s }]} />
            <View style={[styles.line, { width: 60 * s, height: 9 * s, borderRadius: 5 * s }]} />
          </View>
          <View style={{ gap: 6 * s, alignItems: 'flex-end' }}>
            <View style={[styles.line, { width: 48 * s, height: 9 * s, borderRadius: 5 * s }]} />
            <View style={[styles.line, { width: 48 * s, height: 9 * s, borderRadius: 5 * s }]} />
          </View>
        </View>

        <View style={[styles.rule, { marginVertical: 14 * s }]} />
        <Text style={{ textAlign: 'center', color: '#9CA3AF', fontSize: 13 * s, fontFamily: 'InstrumentSans_400Regular' }}>Total</Text>
        <Text style={{ fontFamily: 'InstrumentSans_700Bold', fontSize: 30 * s, color: '#111', textAlign: 'center', marginTop: 2 * s }}>{total}</Text>

        <View style={{ marginTop: 18 * s }}>
          <Barcode s={s} />
        </View>
      </View>

      {tornEdge}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { shadowColor: '#000', shadowOpacity: 0.15, shadowOffset: { width: 0, height: 10 } },
  body: { backgroundColor: '#fff', overflow: 'hidden' },
  rule: { height: 1, backgroundColor: '#E5E7EB' },
  line: { backgroundColor: '#E5E7EB' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  zigzag: { flexDirection: 'row', backgroundColor: 'transparent' },
});
