/**
 * RecentsFolder — the green folder receipts fly into.
 *
 * Structure matters: back panel → fanned cards → FRONT panel. The arriving
 * receipt is drawn between the cards and the front panel, so it slides *into*
 * the folder rather than onto it.
 *
 * The thumbnails read as glass but are a translucent fill + hairline border
 * rather than real BlurView/GlassView: at ~50px, real blur costs a lot, looks
 * identical, and six of them animating over the Skia gooey layer is exactly
 * where this screen would jank. The GPU is better spent on the metaball.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { colors, fontFamily } from '@/theme/tokens';

const FRONT = '#047857';
const BACK = '#03604A';
const LIP = '#059669';

/** Resting fan of the cards already in the folder. */
const CARDS = [
  { rot: -13, x: -26, y: 5 },
  { rot: -6, x: -13, y: 1 },
  { rot: 1, x: 1, y: -1 },
  { rot: 8, x: 15, y: 2 },
  { rot: 15, x: 28, y: 7 },
];

function Thumb({ w, h, s }: { w: number; h: number; s: number }) {
  return (
    <View style={[styles.thumb, { width: w, height: h, borderRadius: 4 * s }]}>
      <View style={{ height: h * 0.22, backgroundColor: 'rgba(255,255,255,0.5)' }} />
      {/* Spreadsheet grid */}
      <View style={styles.grid}>
        {[0, 1, 2].map((r) => (
          <View key={r} style={{ flex: 1, borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.45)' }} />
        ))}
        <View style={[styles.col, { left: '33%' }]} />
        <View style={[styles.col, { left: '66%' }]} />
      </View>
    </View>
  );
}

export function RecentsFolder({
  width,
  label = 'Recents',
  /** 0 → resting fan, 1 → cards parted to make room for an arriving receipt. */
  spread,
}: {
  width: number;
  label?: string;
  spread?: SharedValue<number>;
}) {
  const s = width / 150; // design width is 150
  const height = width * 0.78;
  const cardW = width * 0.34;
  const cardH = height * 0.62;
  const frontH = height * 0.58;

  return (
    <View style={{ width, height }}>
      {/* Back panel */}
      <View
        style={[
          styles.back,
          { top: height * 0.18, height: height * 0.82, borderRadius: 10 * s, backgroundColor: BACK },
        ]}
      />

      {/* Cards already inside */}
      {CARDS.map((c, i) => (
        <FanCard key={i} index={i} cfg={c} w={cardW} h={cardH} s={s} spread={spread} width={width} />
      ))}

      {/* Front panel — the receipt passes BEHIND this. */}
      <View
        style={[
          styles.front,
          { height: frontH, borderRadius: 10 * s, backgroundColor: FRONT, borderTopColor: LIP, borderTopWidth: 1.5 * s },
        ]}
      >
        <View style={[styles.chip, { paddingHorizontal: 7 * s, paddingVertical: 3 * s, borderRadius: 4 * s }]}>
          <Text numberOfLines={1} style={{ fontFamily: fontFamily.semibold, fontSize: 8 * s, color: '#fff' }}>
            {label}
          </Text>
        </View>
      </View>
    </View>
  );
}

function FanCard({
  index,
  cfg,
  w,
  h,
  s,
  width,
  spread,
}: {
  index: number;
  cfg: (typeof CARDS)[number];
  w: number;
  h: number;
  s: number;
  width: number;
  spread?: SharedValue<number>;
}) {
  // Cards part outward from the centre as a receipt arrives.
  const dir = index < CARDS.length / 2 ? -1 : 1;

  const style = useAnimatedStyle(() => {
    const p = spread?.value ?? 0;
    return {
      transform: [
        { translateX: cfg.x * s + dir * interpolate(p, [0, 1], [0, 10]) * s },
        { translateY: cfg.y * s - interpolate(p, [0, 1], [0, 4]) * s },
        { rotate: `${cfg.rot + dir * interpolate(p, [0, 1], [0, 5])}deg` },
      ],
    };
  });

  return (
    <Animated.View style={[styles.card, { left: (width - w) / 2, width: w, height: h }, style]}>
      <Thumb w={w} h={h} s={s} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: 0, right: 0 },
  card: { position: 'absolute', top: 0 },
  front: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  chip: { backgroundColor: 'rgba(0,0,0,0.45)', maxWidth: '75%' },
  thumb: {
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  grid: { flex: 1 },
  col: { position: 'absolute', top: 0, bottom: 0, width: 0.5, backgroundColor: 'rgba(255,255,255,0.45)' },
});
