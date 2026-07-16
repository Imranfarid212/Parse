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
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { EditSheet } from '@/components/receipt/EditSheet';
import { RecentsFolder } from '@/components/receipt/RecentsFolder';
import { ScannedFace } from '@/components/receipt/ScannedFace';
import { ReceiptCard } from '@/components/ui/ReceiptCard';
import type { ReceiptFields } from '@/lib/receipts/types';
import { colors, fontFamily, spacing } from '@/theme/tokens';

const CONFIRM_DY = 80;
const CONFIRM_VY = 800;
const FOLDER_W = 108;

/**
 * Bezier control point, as a fraction of the trip. The paper is pulled right
 * and up before it sweeps left into the folder — that's the swoop. Derived
 * from the real endpoint rather than hardcoded, so the arc holds its shape on
 * any screen size.
 */
const CP_X_RATIO = 0.75; // outward (opposite the folder) …
const CP_Y_RATIO = 0.53; // … and most of the way up

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
  const cardH = Math.min(height * 0.52, 430);

  // Folder sits top-left; the flight runs from the card's centre to its mouth.
  const folderH = FOLDER_W * 0.78;
  const folderCentre = {
    x: insets.left + spacing.lg + FOLDER_W / 2,
    y: insets.top + spacing.sm + folderH * 0.55,
  };
  const cardCentre = { x: width / 2, y: height / 2 };
  const flightDist = Math.hypot(cardCentre.x - folderCentre.x, cardCentre.y - folderCentre.y);

  const p = useSharedValue(0);
  const dragY = useSharedValue(0);
  const spread = useSharedValue(0);

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
          if (done) runOnJS(finish)();
        });
      } else if (down) {
        runOnJS(openEdit)();
      } else {
        p.value = withTiming(0, { duration: 260 });
        dragY.value = withTiming(0, { duration: 260 });
      }
    });

  /**
   * Tossed-card physics. The paper holds its shape, arcs through the air on a
   * quadratic Bezier, and banks into the turn:
   *   P(t) = (1-t)²·P0 + 2(1-t)t·P1 + t²·P2
   * where P0 is rest, P1 the invisible magnet that bends the path, P2 the folder.
   */
  const cardStyle = useAnimatedStyle(() => {
    const t = p.value;
    const mt = 1 - t;

    // P0 is the card at rest (0,0 in its own space); P2 is the folder.
    const endX = folderCentre.x - cardCentre.x;
    const endY = folderCentre.y - cardCentre.y;
    // P1 pulls outward (away from the folder) and up, so the paper sweeps.
    const cpX = Math.abs(endX) * CP_X_RATIO;
    const cpY = endY * CP_Y_RATIO;

    const translateX = 2 * mt * t * cpX + t * t * endX;
    const translateY = 2 * mt * t * cpY + t * t * endY + dragY.value * 0.4;

    return {
      // Fades at the very end so it blends into the folder rather than clipping.
      opacity: interpolate(t, [0.8, 1], [1, 0], Extrapolation.CLAMP),
      transform: [
        { translateX },
        { translateY },
        { scale: interpolate(t, [0, 1], [1, 0.15], Extrapolation.CLAMP) },
        // perspective must precede the rotations for them to read as 3D.
        { perspective: 800 },
        { rotateX: `${interpolate(t, [0, 1], [0, 60])}deg` }, // pitch: tips away
        { rotateY: `${interpolate(t, [0, 1], [0, -15])}deg` }, // yaw: slight twist
        { rotateZ: `${interpolate(t, [0, 1], [0, -25])}deg` }, // roll: banks left
      ],
    };
  });

  const folderStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0.2, 0.28], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(p.value, [0.2, 0.34], [0.7, 1], 'clamp') }],
  }));

  const hintStyle = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.08], [1, 0], 'clamp') }));

  return (
    <View style={styles.root}>
      {/* Frozen frame, blurred back so the paper card is the only thing in focus. */}
      <Image source={{ uri: photoUri }} style={styles.fill} contentFit="cover" />
      <BlurView intensity={60} tint="dark" style={styles.fill} />
      <View style={styles.scrim} />

      <Animated.View style={[styles.folder, { left: insets.left + spacing.lg, top: insets.top + spacing.sm }, folderStyle]}>
        <RecentsFolder width={FOLDER_W} spread={spread} />
      </Animated.View>

      <View style={styles.centre} pointerEvents="box-none">
        <GestureDetector gesture={pan}>
          <Animated.View
            style={[{ width: cardW, height: cardH }, cardStyle]}
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
            <ReceiptCard width={cardW} height={cardH} bare>
              {(s) => <ScannedFace s={s} fields={fields} loading={loading} />}
            </ReceiptCard>
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
