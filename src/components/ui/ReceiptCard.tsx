/**
 * ReceiptCard — a paper-receipt-styled card (header, faint placeholder lines,
 * total, barcode, torn zigzag bottom). Content scales with `width` (via s) so
 * it reads correctly both large (onboarding) and small (search fan carousel).
 */
import React from 'react';
import { Text, View } from 'react-native';

import { Barcode } from '@/components/ui/Barcode';
import { makeStyles, usePaper } from '@/theme/appearance';

const ZIG = 16;

export type ReceiptCardDetails = {
  merchant: string;
  date?: string | null;
  category?: string | null;
  currency?: string;
  items?: { name: string; amount?: number }[];
};

export function ReceiptCard({
  width,
  height,
  total = '45.60',
  details,
  bare = false,
  children,
}: {
  width: number;
  height: number;
  total?: string;
  /** Real receipt content used by Search without changing the paper design. */
  details?: ReceiptCardDetails;
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
        <View style={[styles.body, { height: height - zigH, borderTopLeftRadius: 18 * k, borderTopRightRadius: 18 * k }]}>
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
        <View style={[styles.body, { height: height - toothH, borderTopLeftRadius: 18 * s, borderTopRightRadius: 18 * s, padding: pad }]}>
          <View style={{ flex: 1, borderRadius: 8 * s, backgroundColor: paper.tint }} />
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
        {details ? (
          <>
            <Text numberOfLines={1} style={{ fontFamily: 'InstrumentSans_700Bold', fontSize: 17 * s, color: '#111', textAlign: 'center' }}>
              {details.merchant}
            </Text>
            <Text numberOfLines={1} style={{ fontFamily: 'InstrumentSans_400Regular', fontSize: 11 * s, color: paper.inkMuted, textAlign: 'center', marginTop: 4 * s }}>
              {[details.date, details.category].filter(Boolean).join(' • ') || 'Receipt details'}
            </Text>
          </>
        ) : (
          <>
            <View style={[styles.line, { width: '58%', height: 9 * s, borderRadius: 5 * s, alignSelf: 'center' }]} />
            <View style={[styles.line, { width: '42%', height: 9 * s, borderRadius: 5 * s, alignSelf: 'center', marginTop: 6 * s }]} />
          </>
        )}

        <View style={[styles.rule, { marginVertical: 14 * s }]} />
        {details ? (
          <View style={{ gap: 6 * s, minHeight: 39 * s, flexShrink: 1, overflow: 'hidden' }}>
            {(details.items ?? []).slice(0, 3).map((item, index) => (
              <View key={`${item.name}-${index}`} style={[styles.row, { alignItems: 'flex-start' }]}>
                <Text numberOfLines={2} style={{ flex: 1, paddingRight: 6 * s, fontFamily: 'InstrumentSans_400Regular', fontSize: 14 * s, lineHeight: 17 * s, color: paper.inkStrong }}>
                  {item.name}
                </Text>
                {item.amount !== undefined ? (
                  <Text style={{ fontFamily: 'InstrumentSans_500Medium', fontSize: 14 * s, lineHeight: 17 * s, color: '#111', fontVariant: ['tabular-nums'] }}>
                    {item.amount.toFixed(2)}
                  </Text>
                ) : null}
              </View>
            ))}
            {(details.items?.length ?? 0) === 0 ? (
              <Text style={{ fontFamily: 'InstrumentSans_400Regular', fontSize: 13 * s, color: paper.inkFaint, textAlign: 'center' }}>No line items</Text>
            ) : null}
          </View>
        ) : (
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
        )}

        <View style={[styles.rule, { marginVertical: 14 * s }]} />
        <Text style={{ textAlign: 'center', color: paper.inkFaint, fontSize: 13 * s, fontFamily: 'InstrumentSans_400Regular' }}>Total</Text>
        <Text style={{ fontFamily: 'InstrumentSans_700Bold', fontSize: 30 * s, color: '#111', textAlign: 'center', marginTop: 2 * s }}>{total}</Text>

        <View style={{ marginTop: 18 * s }}>
          <Barcode s={s} />
        </View>
      </View>

      {tornEdge}
    </View>
  );
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
