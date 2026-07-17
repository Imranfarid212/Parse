/**
 * RecentsFolder — the folder receipts fly into.
 *
 * Rebuilt natively from a web reference (rule 1: Tailwind/framer-motion/CSS
 * gradients don't exist in RN, so the effect gets rebuilt in Skia + Reanimated
 * rather than pasted). Gradients are Skia — RN has none natively, and
 * expo-linear-gradient would cost another dev-client rebuild for no gain.
 *
 * What makes it read as a folder rather than stacked rectangles:
 *   - a TAB on the back panel's top-left (the defining manila-folder shape)
 *   - vertical gradients on every panel, not flat fills
 *   - a near-black recess inside the back panel, so the cards sit in a well
 *   - a specular hairline along the front panel's top edge
 *
 * Z-order is load-bearing: back panel → cards → FRONT panel. An arriving
 * receipt is drawn between the cards and the front, so it goes *into* the
 * folder rather than onto it.
 *
 * Thumbnails fake glass (translucent fill + hairline) rather than using real
 * BlurView: at ~60px it looks identical and real blur here would cost frames
 * during the flight.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Canvas, LinearGradient, Rect, vec } from '@shopify/react-native-skia';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { fontFamily } from '@/theme/tokens';

const FRONT = ['#0B8A66', '#053D2D'];
const BACK = ['#077055', '#032B20'];
const TAB = ['#0B8A66', '#067053'];
const RECESS = '#01120D';
const EDGE = 'rgba(255,255,255,0.22)';

/**
 * Resting fan. `x` is a fraction of card width, `y` of card height.
 * Deliberately subtle — the web reference's big fan (offset*8°, offset*30px)
 * is its HOVER state; at rest it only fans offset*3°. A wide fan here also
 * swings the outer cards clean outside the folder's width.
 */
const CARDS = [
  { rot: -7, x: -0.14, y: 0.055 },
  { rot: -3.5, x: -0.07, y: 0.016 },
  { rot: 0, x: 0, y: 0 },
  { rot: 3.5, x: 0.07, y: 0.016 },
  { rot: 7, x: 0.14, y: 0.055 },
];

/** A panel filled with a vertical gradient (Skia) behind arbitrary children. */
function GradientPanel({
  w,
  h,
  colors,
  radius,
  style,
  children,
  specular = false,
}: {
  w: number;
  h: number;
  colors: string[];
  radius: number;
  style?: object;
  children?: React.ReactNode;
  specular?: boolean;
}) {
  return (
    <View style={[{ width: w, height: h, borderRadius: radius, overflow: 'hidden' }, style]}>
      <Canvas style={{ width: w, height: h, position: 'absolute' }}>
        <Rect x={0} y={0} width={w} height={h}>
          <LinearGradient start={vec(0, 0)} end={vec(0, h)} colors={colors} />
        </Rect>
        {/* Light catching the top edge — transparent → white → transparent. */}
        {specular && (
          <Rect x={0} y={0} width={w} height={1}>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(w, 0)}
              colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.5)', 'rgba(255,255,255,0)']}
            />
          </Rect>
        )}
      </Canvas>
      {children}
    </View>
  );
}

function Thumb({ w, h, s }: { w: number; h: number; s: number }) {
  return (
    <View style={[styles.thumb, { width: w, height: h, borderRadius: 5 * s }]}>
      {/* Header band */}
      <View style={{ height: h * 0.2, backgroundColor: 'rgba(255,255,255,0.75)' }} />
      {/* Spreadsheet grid */}
      <View style={{ flex: 1 }}>
        {[0, 1, 2, 3].map((r) => (
          <View key={r} style={{ flex: 1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.55)' }} />
        ))}
        <View style={[styles.col, { left: '34%' }]} />
        <View style={[styles.col, { left: '67%' }]} />
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
  // The web reference's front panel is 340px wide; panel styling derives from
  // that. Card SIZE does not — the reference is a 400px hero whose container is
  // far larger than its folder, so its absolute card size (224x288) here made
  // the cards 1.6x taller than the folder and hanging out of its sides.
  // Everything below is sized against the folder itself instead.
  const k = width / 340;
  const s = width / 150;

  const frontH = 176 * k;
  /** How far the cards rise above the front panel's top edge. */
  const peek = frontH * 0.6;
  /** Headroom above the cards so the fan's rotation has somewhere to go. */
  const pad = 10 * k;

  const height = pad + peek + frontH;
  const cardW = width * 0.46;
  // Enough to clear the front panel, plus as much again tucked inside it.
  const cardH = peek + frontH * 0.6;
  const cardTop = pad;

  const backW = width * 0.9;
  const backH = peek * 0.75 + frontH;
  const backBottom = 4 * k;
  const tabW = backW * 0.4;
  const tabH = 40 * k;
  const bodyTop = tabH * 0.8;

  const bodyH = backH - bodyTop;
  const recessPad = 6 * k;

  return (
    <View style={{ width, height }}>
      {/* ── Back panel: tab + body + recess ── */}
      <View style={{ position: 'absolute', left: (width - backW) / 2, bottom: backBottom, width: backW, height: backH }}>
        {/* Tab is drawn taller than it shows; the body covers its lower half so
            only the top corners round — the manila-folder silhouette. */}
        <GradientPanel
          w={tabW}
          h={tabH + 16 * k}
          colors={TAB}
          radius={7 * k}
          style={{ position: 'absolute', top: 0, left: 0 }}
        />
        <GradientPanel
          w={backW}
          h={bodyH}
          colors={BACK}
          radius={9 * k}
          style={{ position: 'absolute', top: bodyTop, left: 0, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}
        >
          {/* The well the cards sit in. */}
          <View
            style={{
              position: 'absolute',
              top: recessPad,
              left: recessPad,
              right: recessPad,
              bottom: recessPad,
              borderRadius: 6 * k,
              backgroundColor: RECESS,
            }}
          />
        </GradientPanel>
      </View>

      {/* ── Cards already inside ── */}
      {CARDS.map((c, i) => (
        <FanCard
          key={i}
          index={i}
          cfg={c}
          w={cardW}
          h={cardH}
          s={s}
          left={(width - cardW) / 2}
          top={cardTop}
          spread={spread}
        />
      ))}

      {/* ── Front panel — arrivals pass BEHIND this ── */}
      <GradientPanel
        w={width}
        h={frontH}
        colors={FRONT}
        radius={13 * k}
        specular
        style={[styles.front, { borderWidth: 1, borderColor: EDGE }]}
      >
        <View style={[styles.chipWrap, { paddingBottom: 18 * k }]}>
          <View style={[styles.chip, { paddingHorizontal: 10 * k, paddingVertical: 5 * k, borderRadius: 5 * k }]}>
            <Text numberOfLines={1} style={{ fontFamily: fontFamily.semibold, fontSize: 11 * k, color: 'rgba(255,255,255,0.92)' }}>
              {label}
            </Text>
          </View>
        </View>
      </GradientPanel>
    </View>
  );
}

function FanCard({
  index,
  cfg,
  w,
  h,
  s,
  left,
  top,
  spread,
}: {
  index: number;
  cfg: (typeof CARDS)[number];
  w: number;
  h: number;
  s: number;
  left: number;
  top: number;
  spread?: SharedValue<number>;
}) {
  // Cards part outward from the centre as a receipt arrives.
  const dir = index < CARDS.length / 2 ? -1 : 1;

  const style = useAnimatedStyle(() => {
    const p = spread?.value ?? 0;
    return {
      transform: [
        { translateX: cfg.x * w + dir * interpolate(p, [0, 1], [0, 0.1]) * w },
        { translateY: cfg.y * h - interpolate(p, [0, 1], [0, 0.04]) * h },
        { rotate: `${cfg.rot + dir * interpolate(p, [0, 1], [0, 4])}deg` },
      ],
    };
  });

  return (
    <Animated.View style={[styles.card, { left, top, width: w, height: h }, style]}>
      <Thumb w={w} h={h} s={s} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  front: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    // Casts up over the cards, the way the reference's front panel does.
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -6 },
    elevation: 10,
  },
  card: {
    position: 'absolute',
    transformOrigin: 'bottom center',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 5 },
  },
  chipWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  chip: { backgroundColor: 'rgba(0,0,0,0.82)', maxWidth: '80%' },
  thumb: {
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.65)',
  },
  col: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.55)' },
});
