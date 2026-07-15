/**
 * ReceiptCard — a paper-receipt-styled card (header, faint placeholder lines,
 * total, barcode, torn zigzag bottom). Content scales with `width` (via s) so
 * it reads correctly both large (onboarding) and small (search fan carousel).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

const ZIG = 16;
const BARS = 34;

export function ReceiptCard({ width, height, total = '45.60' }: { width: number; height: number; total?: string }) {
  const s = width / 300; // design width is 300
  const toothHalf = width / ZIG / 2;
  const toothH = 12 * s;
  const pad = 22 * s;

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

        <View style={[styles.barcode, { marginTop: 18 * s }]}>
          {Array.from({ length: BARS }).map((_, i) => (
            <View key={i} style={{ width: Math.max(1, ((i % 3) + 1) * s), height: 42 * s, backgroundColor: '#111', marginRight: 2 * s }} />
          ))}
        </View>
      </View>

      <View style={styles.zigzag}>
        {Array.from({ length: ZIG }).map((_, i) => (
          <View
            key={i}
            style={{ width: 0, height: 0, borderLeftWidth: toothHalf, borderRightWidth: toothHalf, borderTopWidth: toothH, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#fff' }}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { shadowColor: '#000', shadowOpacity: 0.15, shadowOffset: { width: 0, height: 10 } },
  body: { backgroundColor: '#fff', overflow: 'hidden' },
  rule: { height: 1, backgroundColor: '#E5E7EB' },
  line: { backgroundColor: '#E5E7EB' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  barcode: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end' },
  zigzag: { flexDirection: 'row', backgroundColor: 'transparent' },
});
