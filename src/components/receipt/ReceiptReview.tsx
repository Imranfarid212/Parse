/**
 * ReceiptReview — everything after the shutter.
 *
 * The frame is frozen (the captured photo, not the live preview): cheaper, and
 * it makes the moment read as the app having caught the receipt.
 *
 * Drag up = confirm. `p` (flight progress) tracks the finger, and the receipt
 * flies like a tossed playing card, not a melting blob: it holds its shape,
 * arcs on a quadratic Bezier, and banks into the turn.
 *   p 0.20   the folder appears
 *   p 0.80→1 the card fades as it drops into the folder
 * Release past threshold completes it; below, it springs back.
 *
 * (An earlier build ran a Skia metaball wake here. Metaballs are for liquid —
 * water drops merging, gooey tab bars — and applying one to rigid editorial
 * paper read as melting clay. Deleted in favour of pure Reanimated transforms:
 * hardware-accelerated, crisp, and no shader needed for aerodynamics.)
 *
 * Drag down = edit. Axis is direction-locked on first movement.
 */
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { EditSheet } from '@/components/receipt/EditSheet';
import { folderHeight } from '@/components/receipt/folder/geometry';
import { RecentsFolder } from '@/components/receipt/RecentsFolder';
import { ScannedFace } from '@/components/receipt/ScannedFace';
import type { ReceiptFields } from '@/lib/receipts/types';
import { EMPHASIZED, FOLDER_IN_MS, FOLDER_OUT_MS } from '@/theme/motion';
import { fontFamily, spacing } from '@/theme/tokens';

const CONFIRM_DY = 80;
const CONFIRM_VY = 800;
const FOLDER_W = 92;
/** Flight progress at which the folder comes in to meet the receipt. */
const FOLDER_CUE = 0.2;

/**
 * Flight shape — a cubic Bezier S-curve. The receipt swings OUT to the right as
 * it climbs, then reverses and sweeps LEFT into the folder, arriving almost
 * horizontally. Two control points are what make the S; a quadratic can only
 * bend one way (which is why the old path just curved left the whole trip).
 *
 * Both control points sit out to the right. The second sits near the folder's
 * height, so the final tangent is nearly horizontal — that's the flat arrival.
 * All derived from the real endpoint, so the shape holds on any screen.
 */
const BULGE_RATIO = 0.4; // how far right it swings, against the climb
const CP1_Y_RATIO = 0.3; // first control point's height
const CP2_Y_RATIO = 0.92; // second, level with the folder → flat arrival

/** Tumble through the flight, in degrees at t = 1. */
const PITCH = 70; // rotateX — tips away from the viewer
const YAW = -45; // rotateY — flips around the vertical axis
const ROLL = -40; // rotateZ — banks into the turn

export function ReceiptReview({
  photoUri,
  fields,
  loading,
  onConfirmed,
  onRetake,
  onFieldsChange,
}: {
  photoUri: string;
  fields: ReceiptFields | null;
  loading: boolean;
  onConfirmed: (f: ReceiptFields) => void;
  onRetake: () => void;
  onFieldsChange: (f: ReceiptFields) => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false);

  const cardW = Math.min(width * 0.72, 290);

  // Folder sits top-left; the flight runs from the card's centre to its mouth.
  const folderH = folderHeight(FOLDER_W);
  const folderLeft = insets.left + spacing.lg;
  const folderTop = insets.top + spacing.sm;
  const folderCentre = {
    x: folderLeft + FOLDER_W / 2,
    y: folderTop + folderH * 0.55,
  };
  const cardCentre = { x: width / 2, y: height / 2 };
  const flightDist = Math.hypot(cardCentre.x - folderCentre.x, cardCentre.y - folderCentre.y);

  // Parked just past the left edge, at its resting height — it slides straight
  // in, left to right.
  const folderOffX = -(folderLeft + FOLDER_W + 12);

  const p = useSharedValue(0);
  const dragY = useSharedValue(0);
  const spread = useSharedValue(0);
  /** 0 → parked off-screen, 1 → in place. */
  const folderIn = useSharedValue(0);

  // The folder comes in to meet the receipt, and leaves again if the drag is
  // abandoned. Watching p rather than deriving from it, so the entry keeps its
  // own easing instead of being yoked to the finger.
  useAnimatedReaction(
    () => p.value >= FOLDER_CUE,
    (cued, prev) => {
      if (prev === null || cued === prev) return;
      folderIn.value = withTiming(cued ? 1 : 0, {
        duration: cued ? FOLDER_IN_MS : FOLDER_OUT_MS,
        easing: EMPHASIZED,
      });
    },
  );

  const finish = useCallback(() => {
    if (fields) onConfirmed(fields);
  }, [fields, onConfirmed]);

  const openEdit = useCallback(() => {
    setEditing(true);
    dragY.value = withTiming(0);
  }, [dragY]);

  const buzz = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const pan = Gesture.Pan()
    .enabled(!loading && !!fields && !editing)
    // Direction-lock: the dominant axis on first movement wins.
    .activeOffsetY([-12, 12])
    .failOffsetX([-24, 24])
    .onUpdate((e) => {
      if (e.translationY < 0) {
        p.value = Math.min(1, -e.translationY / flightDist);
        dragY.value = 0;
      } else {
        dragY.value = e.translationY;
        p.value = 0;
      }
    })
    .onEnd((e) => {
      const up = e.translationY < -CONFIRM_DY || e.velocityY < -CONFIRM_VY;
      const down = e.translationY > CONFIRM_DY || e.velocityY > CONFIRM_VY;

      if (up) {
        runOnJS(buzz)();
        spread.value = withTiming(1, { duration: 420 });
        p.value = withTiming(1, { duration: 620, easing: Easing.bezier(0.4, 0, 0.2, 1) }, (done) => {
          if (!done) return;
          // Receipt is in. The folder carries it off-screen, then we close —
          // p stays at 1, so the reaction above won't fight this.
          folderIn.value = withTiming(0, { duration: FOLDER_OUT_MS, easing: EMPHASIZED }, (gone) => {
            if (gone) runOnJS(finish)();
          });
        });
      } else if (down) {
        runOnJS(openEdit)();
      } else {
        p.value = withTiming(0, { duration: 260 });
        dragY.value = withTiming(0, { duration: 260 });
      }
    });

  /**
   * Tossed-card physics: the paper holds its shape, arcs through the air, and
   * banks. Cubic Bezier, with P0 the card at rest (0,0 in its own space) and
   * P3 the folder:
   *   P(t) = (1-t)³·P0 + 3(1-t)²t·P1 + 3(1-t)t²·P2 + t³·P3
   * The P0 term drops out since it's the origin.
   */
  const cardStyle = useAnimatedStyle(() => {
    const t = p.value;
    const mt = 1 - t;

    const endX = folderCentre.x - cardCentre.x;
    const endY = folderCentre.y - cardCentre.y;

    // Both control points sit out to the right: the first throws it outward as
    // it climbs, the second (level with the folder) reels it back in flat.
    const bulge = Math.abs(endY) * BULGE_RATIO;
    const cp1X = bulge;
    const cp1Y = endY * CP1_Y_RATIO;
    const cp2X = bulge;
    const cp2Y = endY * CP2_Y_RATIO;

    const translateX = 3 * mt * mt * t * cp1X + 3 * mt * t * t * cp2X + t * t * t * endX;
    const translateY =
      3 * mt * mt * t * cp1Y + 3 * mt * t * t * cp2Y + t * t * t * endY + dragY.value * 0.4;

    return {
      // Fades at the very end so it blends into the folder rather than clipping.
      opacity: interpolate(t, [0.8, 1], [1, 0], Extrapolation.CLAMP),
      transform: [
        { translateX },
        { translateY },
        { scale: interpolate(t, [0, 1], [1, 0.15], Extrapolation.CLAMP) },
        // perspective must precede the rotations for them to read as 3D.
        { perspective: 800 },
        { rotateX: `${interpolate(t, [0, 1], [0, PITCH])}deg` },
        { rotateY: `${interpolate(t, [0, 1], [0, YAW])}deg` },
        { rotateZ: `${interpolate(t, [0, 1], [0, ROLL])}deg` },
      ],
    };
  });

  // Slides in from beyond the left edge and back out the same way.
  const folderStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(folderIn.value, [0, 1], [folderOffX, 0]) }],
  }));

  const hintStyle = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.08], [1, 0], 'clamp') }));

  return (
    <View style={styles.root}>
      {/* Frozen frame, blurred back so the card is the only thing in focus. */}
      <Image source={{ uri: photoUri }} style={styles.fill} contentFit="cover" />
      <BlurView intensity={80} tint="dark" style={styles.fill} />
      <View style={styles.scrim} />

      <Animated.View style={[styles.folder, { left: folderLeft, top: folderTop }, folderStyle]}>
        <RecentsFolder width={FOLDER_W} spread={spread} />
      </Animated.View>

      <View style={styles.centre} pointerEvents="box-none">
        <GestureDetector gesture={pan}>
          <Animated.View
            style={[{ width: cardW }, cardStyle]}
            accessible
            accessibilityRole="summary"
            accessibilityLabel={
              fields ? `Receipt from ${fields.store}, total ${fields.total.toFixed(2)}` : 'Reading receipt'
            }
            // Drag-only confirm would lock out VoiceOver; these are invisible.
            accessibilityActions={[
              { name: 'confirm', label: 'Confirm receipt' },
              { name: 'edit', label: 'Edit receipt' },
            ]}
            onAccessibilityAction={(e) => {
              if (e.nativeEvent.actionName === 'confirm') finish();
              if (e.nativeEvent.actionName === 'edit') openEdit();
            }}
          >
            <ScannedFace width={cardW} fields={fields} loading={loading} />
          </Animated.View>
        </GestureDetector>

        {!editing && (
          <Animated.View style={[styles.hints, hintStyle]} pointerEvents="none">
            <Feather name="arrow-up" size={15} color="rgba(255,255,255,0.9)" />
            <Text style={styles.hintText}>{loading ? 'Reading receipt…' : 'Swipe up to confirm · down to edit'}</Text>
          </Animated.View>
        )}
      </View>

      {editing && fields && (
        <View style={[styles.sheetWrap, { paddingTop: insets.top + spacing.xl }]}>
          <EditSheet
            fields={fields}
            destructiveRetake={false}
            onChange={onFieldsChange}
            onDone={() => setEditing(false)}
            onRetake={onRetake}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000' },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  // Card (3) under folder (5), so it drops behind the folder's front panel.
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', zIndex: 3 },
  folder: { position: 'absolute', zIndex: 5 },
  hints: { position: 'absolute', bottom: 70, flexDirection: 'row', alignItems: 'center', gap: 6 },
  hintText: { fontFamily: fontFamily.semibold, fontSize: 14, color: 'rgba(255,255,255,0.9)' },
  sheetWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 },
});
