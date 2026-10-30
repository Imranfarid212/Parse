/**
 * OnboardingOverlay — blurred backdrop + a stack of three receipt cards.
 * Swipe the top card RIGHT to advance to the next; it tosses off toward the
 * bottom-left and the next receipt is revealed. "Let's go" appears only on the
 * third (last) receipt. The fancier tear/crush exit is a later polish — this is
 * the plain toss motion + the gating behaviour.
 */
import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useIsFocused } from 'expo-router';

import { ExportCard } from '@/components/onboarding/ExportCard';
import { SwipeToFileCard } from '@/components/onboarding/SwipeToFileCard';
import { CategoryChecklist } from '@/components/ui/CategoryChecklist';
import { ReceiptCard } from '@/components/ui/ReceiptCard';
import { makeStyles, useColors } from '@/theme/appearance';
import { fontFamily, radius, spacing, typography } from '@/theme/tokens';

const NUM = 3;
const SWIPE_THRESHOLD = 70;
const SCREEN_BG = '#E0E4E8'; // background behind the receipt stack

// Static offset for a card sitting `depth` layers behind the top card.
const behindStyle = (depth: number) => ({
  transform: [{ translateX: 8 * depth }, { translateY: -13 * depth }, { rotate: `${2.5 * depth}deg` }],
});

function SwipeCard({
  width,
  height,
  onSwiped,
  children,
}: {
  width: number;
  height: number;
  onSwiped: () => void;
  children?: (s: number) => React.ReactNode;
}) {
  const styles = useStyles();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const gone = useSharedValue(0);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      tx.value = e.translationX;
      ty.value = e.translationY * 0.25;
    })
    .onEnd((e) => {
      // Advance on a horizontal swipe in EITHER direction; always toss off
      // toward the bottom-left, then reveal the next receipt.
      if (Math.abs(e.translationX) > SWIPE_THRESHOLD || Math.abs(e.velocityX) > 700) {
        tx.value = withTiming(-width * 1.4, { duration: 340 });
        ty.value = withTiming(height * 0.55, { duration: 340 });
        gone.value = withTiming(1, { duration: 340 }, (finished) => {
          if (finished) runOnJS(onSwiped)();
        });
      } else {
        tx.value = withSpring(0);
        ty.value = withSpring(0);
      }
    });

  const style = useAnimatedStyle(() => ({
    opacity: 1 - gone.value,
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${interpolate(tx.value, [-width, 0, width], [-22, 0, 14])}deg` },
    ],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.cardWrap, { width, height }, style]}>
        <ReceiptCard width={width} height={height} bare>
          {children}
        </ReceiptCard>
      </Animated.View>
    </GestureDetector>
  );
}

export function OnboardingOverlay({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Card aspect ratio: 340 wide × 529 tall (97 header + 335.6 rows + 88.4 footer
  // + 8 zigzag). Keep it exact so the card is the natural height of its content —
  // otherwise the checklist overflows and clips. Fall back to a height-driven
  // width when the ratio-derived card is taller than the screen.
  const DESIGN_W = 340;
  const DESIGN_H = 529;
  const maxCardH = height - insets.top - insets.bottom - 150;
  let cardW = Math.min(width * 0.8, 330);
  let cardH = (cardW * DESIGN_H) / DESIGN_W;
  if (cardH > maxCardH) {
    cardH = maxCardH;
    cardW = (cardH * DESIGN_W) / DESIGN_H;
  }

  const isFocused = useIsFocused();
  const [index, setIndex] = useState(0); // which receipt is on top

  /**
   * Finishing is now reachable two ways — the CTA, and swiping the last receipt
   * away — and both are live at the same time, since the button stays on screen
   * while the card flies off. Latched so a tap during that 340ms toss cannot
   * complete onboarding twice.
   */
  const completed = useRef(false);
  const complete = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    onComplete();
  }, [onComplete]);
  const isLast = index === NUM - 1;

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: SCREEN_BG }]}>
      {/* Screen background behind the receipt stack — solid colour, just enough
          to separate the white sheets and their shadows from the backdrop. */}
      <Pressable style={styles.fill} onPress={onClose} />

      <Pressable onPress={onClose} hitSlop={16} style={[styles.close, { top: insets.top + spacing.md }]}>
        <Text style={styles.closeGlyph}>✕</Text>
      </Pressable>

      <View style={styles.center} pointerEvents="box-none">
        <View style={{ width: cardW, height: cardH }}>
          {/* Deepest first so the top card paints last. */}
          {[2, 1, 0]
            .filter((i) => i >= index)
            .map((i) => {
              const depth = i - index;
              // Each receipt owns its own printed face now; all three share the
              // paper, the footer and the torn edge. They had all been the same
              // checklist with `empty` blanking the body, which meant cards 2
              // and 3 repeated card 1's header over white.
              //
              // `animating` is the leash on the two looping cards: only the one
              // on top, and only while the screen is focused. Unbounded
              // withRepeat has been stripped from this project twice for
              // thermal reasons, so these die the moment you swipe past.
              const animating = i === index && isFocused;
              const content = (s: number) => {
                if (i === 1) return <SwipeToFileCard s={s} active={animating} />;
                if (i === 2) return <ExportCard s={s} active={animating} />;
                return <CategoryChecklist s={s} />;
              };

              // The last receipt is swipeable too, and swiping it away finishes
              // onboarding — the same outcome as the CTA beneath it. Leaving it
              // inert made the final card the one place the gesture the whole
              // stack just taught you stopped working.
              if (i === index) {
                return (
                  <SwipeCard
                    key={i}
                    width={cardW}
                    height={cardH}
                    onSwiped={isLast ? complete : () => setIndex((n) => n + 1)}
                  >
                    {content}
                  </SwipeCard>
                );
              }
              return (
                <View key={i} style={[styles.cardWrap, { width: cardW, height: cardH }, behindStyle(depth)]}>
                  <ReceiptCard width={cardW} height={cardH} bare>
                    {content}
                  </ReceiptCard>
                </View>
              );
            })}

          {!isLast && (
            <View style={styles.hint} pointerEvents="none">
              <Feather name="arrow-left" size={16} color={colors.textSecondary} />
              <Text style={styles.hintLabel}>Swipe left</Text>
            </View>
          )}
        </View>
      </View>

      {/* "Let's go" appears only on the third receipt. */}
      {isLast && (
        <Pressable onPress={complete} style={[styles.cta, { bottom: insets.bottom + spacing.xl + 15 }]}>
          <Text style={styles.ctaLabel}>Let&apos;s go</Text>
        </Pressable>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  close: {
    position: 'absolute',
    right: spacing.lg,
    zIndex: 10,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: { fontSize: 20, color: colors.textSecondary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cardWrap: { position: 'absolute' },
  hint: { position: 'absolute', bottom: -34, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6 },
  hintLabel: { color: colors.textSecondary, fontSize: 15, fontFamily: fontFamily.medium },
  cta: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.ctaBackground,
    borderRadius: radius.pill,
  },
  ctaLabel: { ...typography.button, color: colors.ctaText },
}));
