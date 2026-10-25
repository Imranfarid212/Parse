/**
 * SwipeToFileCard — the SECOND onboarding receipt.
 *
 * Teaches the one gesture the review screen depends on: up confirms, down
 * opens the editor. The copy says "edit", not "retake", because that is what
 * ReceiptReview actually does on a downward swipe — retake lives inside the
 * editor, and onboarding someone into a gesture that does not exist is worse
 * than not mentioning it.
 *
 * The receipt inside is a miniature of ScannedFace rather than an abstract
 * block: store, date, perforation, items, total, barcode. The card you are
 * being taught to flick is the card you will actually meet after the first
 * scan, so the gesture has something to attach to.
 *
 * Demonstration only — no live pan handler. SwipeCard already owns a Pan
 * gesture for the horizontal swipe, and a vertical one here would fight it.
 */
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { ReceiptFooter } from '@/components/ui/receiptTheme';
import { usePaper } from '@/theme/appearance';
import { fontFamily } from '@/theme/tokens';

/** Design units at DESIGN_W 340: 46 + 386.6 + 88.4 = 521, the body height
 *  ReceiptCard gives its children. Card 1 splits the same 521 as 97/335.6/88.4. */
const DESIGN_W = 340;
export const SWIPE_CARD_HEADER_U = 46;
export const SWIPE_CARD_BODY_U = 386.6;

const GREEN = '#0e7043'; // confirm — the same forest used by card 1's check circles
const TRAVEL_U = 45.5; // how far the receipt rises and falls
const WINDOW_U = 296; // the slot it travels inside; it is TALLER than this, so it crops
const MINI_W_U = 236;
const MINI_H_U = 292;

const RISE_MS = 700;
const HOLD_MS = 400;
const REST_MS = 300;

/** A dashed rule inside the mini receipt. Its own, not receiptTheme's: that one
 *  is sized for a full card and would read as a solid line at this scale. */
function MiniDash({ s }: { s: number }) {
  const paper = usePaper();
  const dash = 3 * s;
  const gap = 2 * s;
  const n = Math.ceil((MINI_W_U * s) / (dash + gap));
  return (
    <View style={{ height: 1, flexDirection: 'row', overflow: 'hidden' }}>
      {Array.from({ length: n }).map((_, i) => (
        <View key={i} style={{ width: dash, height: 1, marginRight: gap, backgroundColor: paper.dash }} />
      ))}
    </View>
  );
}

export function SwipeToFileCard({ s, active }: { s: number; active: boolean }) {
  const paper = usePaper();
  const y = useSharedValue(0);
  const travel = TRAVEL_U * s;

  useEffect(() => {
    if (!active) {
      // Deliberately NOT an unbounded withRepeat left running. Two of those were
      // stripped from this project for thermal reasons; this one only breathes
      // while its card is on top and the screen is focused.
      cancelAnimation(y);
      y.value = withTiming(0, { duration: 200 });
      return;
    }
    const ease = Easing.inOut(Easing.cubic);
    y.value = withRepeat(
      withSequence(
        withTiming(-travel, { duration: RISE_MS, easing: ease }),
        withDelay(HOLD_MS, withTiming(0, { duration: RISE_MS, easing: ease })),
        withDelay(REST_MS, withTiming(travel, { duration: RISE_MS, easing: ease })),
        withDelay(HOLD_MS, withTiming(0, { duration: RISE_MS, easing: ease })),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(y);
  }, [active, travel, y]);

  // Scale is derived from y rather than animated separately, so the two can
  // never drift out of step: it grows a little on the way up (lifting away)
  // and settles smaller on the way down (going back for correction).
  const miniStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: y.value },
      { scale: interpolate(y.value, [-travel, 0, travel], [1.04, 1, 0.98], 'clamp') },
    ],
  }));
  const upStyle = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [-travel, -travel * 0.25, 0], [1, 1, 0.28], 'clamp'),
  }));
  const downStyle = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [0, travel * 0.25, travel], [0.28, 1, 1], 'clamp'),
  }));

  const ink = { color: paper.inkStrong } as const;

  return (
    <>
      {/* Header: card 1's eyebrow treatment exactly — same size, tracking, ink
          and position — so the line does not jump as you swipe between them.
          No seam below it; the flattened paper made that rule read as a stray. */}
      <View style={{ height: SWIPE_CARD_HEADER_U * s, paddingHorizontal: 24 * s, paddingTop: 17 * s }}>
        <Text style={{ fontFamily: fontFamily.semibold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: paper.inkFaint }}>
          Swipe to file it
        </Text>
      </View>

      <View style={{ height: SWIPE_CARD_BODY_U * s, alignItems: 'center', justifyContent: 'center', gap: 14 * s, paddingHorizontal: 22 * s }}>
        <Animated.View style={[styles.label, { gap: 8 * s }, upStyle]}>
          <Feather name="arrow-up" size={20} color={GREEN} />
          <Text style={{ fontFamily: fontFamily.semibold, fontSize: 16, color: GREEN }}>Swipe up to confirm</Text>
        </Animated.View>

        {/* The window crops the receipt top and bottom even at rest, so the
            movement reads as paper feeding through a slot rather than a card
            sliding around on a surface. */}
        <View style={{ height: WINDOW_U * s, width: '100%', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <Animated.View
            style={[
              {
                width: MINI_W_U * s,
                height: MINI_H_U * s,
                borderRadius: 13 * s,
                backgroundColor: paper.body,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: paper.rule,
                paddingHorizontal: 16 * s,
                paddingTop: 17 * s,
              },
              miniStyle,
            ]}
          >
            <Text numberOfLines={1} style={{ ...styles.center, fontFamily: fontFamily.display, fontSize: 14, ...ink }}>
              Uber Takeout
            </Text>
            <Text style={{ ...styles.center, fontFamily: fontFamily.semibold, fontSize: 11, color: paper.inkMuted, marginTop: 3 * s, marginBottom: 10 * s }}>
              1 Sep 2023
            </Text>
            <MiniDash s={s} />

            <Text style={{ fontFamily: fontFamily.semibold, fontSize: 11, letterSpacing: 1, color: paper.inkFaint, marginTop: 11 * s, marginBottom: 7 * s }}>
              ITEMS
            </Text>
            <View style={[styles.row, { marginBottom: 6 * s }]}>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: fontFamily.medium, fontSize: 12, ...ink }}>Paneer &amp; Rice</Text>
              <Text style={{ fontFamily: fontFamily.display, fontSize: 12, ...ink }}>38.00</Text>
            </View>
            <View style={styles.row}>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: fontFamily.medium, fontSize: 12, ...ink }}>Mango lassi</Text>
              <Text style={{ fontFamily: fontFamily.display, fontSize: 12, ...ink }}>4.50</Text>
            </View>

            <View style={{ marginTop: 11 * s }}><MiniDash s={s} /></View>
            <View style={[styles.row, { marginTop: 11 * s }]}>
              <Text style={{ fontFamily: fontFamily.display, fontSize: 13, ...ink }}>Total</Text>
              <Text style={{ fontFamily: fontFamily.display, fontSize: 16, ...ink }}>US$42.50</Text>
            </View>

            <View style={{ marginTop: 'auto', paddingBottom: 14 * s }}>
              <MiniDash s={s} />
              <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 9 * s }}>
                {MINI_BARS.map((w, i) => (
                  <View key={i} style={{ width: w * s, height: 14 * s, marginRight: 1 * s, backgroundColor: paper.footerInk }} />
                ))}
              </View>
            </View>
          </Animated.View>
        </View>

        <Animated.View style={[styles.label, { gap: 8 * s }, downStyle]}>
          <Feather name="arrow-down" size={20} color={paper.inkMuted} />
          <Text style={{ fontFamily: fontFamily.semibold, fontSize: 16, color: paper.inkMuted }}>Swipe down to edit</Text>
        </Animated.View>
      </View>

      <ReceiptFooter s={s} bandW={DESIGN_W * s} footerH={88.4 * s} />
    </>
  );
}

/** Bar widths for the mini barcode — narrower than the footer's so it still
 *  reads as a code at a third of the size. */
const MINI_BARS = [2, 1, 2, 1, 3, 1, 2, 2, 1, 3, 1, 2, 2, 1, 1, 3, 1, 2, 1, 2];

const styles = StyleSheet.create({
  label: { flexDirection: 'row', alignItems: 'center' },
  center: { textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
});
