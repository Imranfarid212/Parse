/**
 * ReceiptReview — everything after the shutter.
 *
 * The frame is frozen (the captured photo, not the live preview): cheaper, and
 * it makes the moment read as the app having caught the receipt.
 *
 * Drag up = confirm. `p` (flight progress) tracks the finger, and the receipt
 * flies like a tossed playing card, not a melting blob: it holds its shape,
 * arcs on a cubic Bezier, and banks into the turn.
 *   p 0.20      the folder slides in
 *   p 0.80→0.90 the tumble unwinds to the sheet's exact angle and size
 *   p 0.90→1    the flap drops open; the card hangs, then is drawn in
 *   after       flap shuts with a click, folder carries it off-screen
 * Release past threshold completes it; below, it springs back.
 *
 * The receipt NEVER fades. It finishes exactly the size, place and angle of the
 * folder's front sheet and STAYS there, as the new front card — its top edge
 * standing above the flap, the older sheets behind it. Nothing is dissolved or
 * swapped out; what you watched fly is what ends up in the folder, which is
 * also why it rides the folder's exit rather than being left behind.
 *
 * Making that possible is why the folder is drawn as two layers with the card
 * between them (see RecentsFolder's `layer`): an RN view can't be interleaved
 * into a single Skia canvas's draw order. And because there's no fade left to
 * hide behind, the landing has to be pixel-honest — any misalignment now shows
 * as the card sitting visibly proud of the sheet beneath it.
 *
 * (An earlier build ran a Skia metaball wake here. Metaballs are for liquid —
 * water drops merging, gooey tab bars — and applying one to rigid editorial
 * paper read as melting clay. Deleted in favour of pure Reanimated transforms:
 * hardware-accelerated, crisp, and no shader needed for aerodynamics.)
 *
 * Drag down = edit. Axis is direction-locked on first movement.
 */
import React, { useCallback, useEffect, useState } from 'react';
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
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { EditSheet } from '@/components/receipt/EditSheet';
import { SHEETS, SPREAD, VIEW_W } from '@/components/receipt/folder/geometry';
import { RecentsFolder } from '@/components/receipt/RecentsFolder';
import { ScannedFace } from '@/components/receipt/ScannedFace';
import type { ReceiptFields } from '@/lib/receipts/types';
import { EMPHASIZED, EMPHASIZED_DECELERATE, FLIGHT_MS, FOLDER_IN_MS, FOLDER_OUT_MS } from '@/theme/motion';
import { fontFamily, spacing } from '@/theme/tokens';

/**
 * The blur is faded by its INTENSITY, never by opacity. BlurView is a
 * UIVisualEffectView, and setting alpha on one — or on any ancestor — is
 * explicitly unsupported by UIKit and can fail or crash at render time. So the
 * still and the scrim fade with opacity, and the blur dissolves on its own prop.
 */
const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);
const BLUR_INTENSITY = 80;

const CONFIRM_DY = 80;
const CONFIRM_VY = 800;
const FOLDER_W = 92;
/** Flight progress at which the folder comes in to meet the receipt. */
const FOLDER_CUE = 0.2;

/**
 * Flight shape — a cubic Bezier S-curve. The receipt swings OUT to the right as
 * it climbs, rises ABOVE the folder toward the top-right, then reverses and
 * sweeps LEFT and back DOWN to settle into it. Two control points are what make
 * the S; a quadratic can only bend one way (which is why the old path just
 * curved left the whole trip).
 *
 * The two x-ratios differ deliberately. Holding the first one IN and throwing
 * the second one OUT pushes the widest part of the sweep later, to around
 * p 0.55 — by which point the card has shrunk enough to swing that far right
 * and still stay on screen. (Both at 0.4 peaked early, at p 0.30, while the
 * card was near full size; its right edge was already within 14px of the
 * screen, so there was no room to go wider without clipping.)
 *
 * CP2 sits ABOVE the endpoint (ratio > 1), which is what lifts the arc over the
 * folder and turns the arrival into a settle DOWN rather than a flat glide in.
 * All derived from the real endpoint, so the shape holds on any screen.
 */
const BULGE_IN_RATIO = 0.2; // first control point's x — held in, so the swing waits
const BULGE_OUT_RATIO = 0.85; // second's x — the far side of the sweep
const CP1_Y_RATIO = 0.3; // first control point's height
const CP2_Y_RATIO = 1.2; // second, ABOVE the folder → rises, then settles down

/** Tumble through the flight, in degrees at ALIGN_FROM (where it stops growing). */
const PITCH = 70; // rotateX — tips away from the viewer
const YAW = -45; // rotateY — flips around the vertical axis
const ROLL = -40; // rotateZ — banks into the turn

/**
 * The approach. Three phases share the tail of the flight:
 *
 *  p 0.80→0.90  ALIGN. The tumble freezes wherever it had got to and unwinds
 *               from there to the sheet's exact orientation — flat, and turned
 *               a quarter to landscape. Size lands on the sheet's exact size in
 *               the same window. By 0.90 the card IS a sheet, just not in yet.
 *  p 0.90→1.00  MAGNET. Path progress is re-eased so the card hangs almost
 *               still, then gets drawn in. This is only 10% of the distance but
 *               ~58% of the clock (the decelerate curve front-loads the path),
 *               which is what buys the pause without stalling the whole flight.
 *
 * The flap opens on the same 0.90 cue and closes once the card is home.
 */
const ALIGN_FROM = 0.8;
const ALIGNED_BY = 0.9;
/**
 * Landing orientation: a quarter turn, matching the sheets in the folder — plus
 * the tilt the front sheet itself picks up from `spread`, so the two are
 * genuinely parallel and not just both "landscape".
 */
const LAND_TURN = -90;
const SPREAD_TURN = (SPREAD.front.rot * 180) / Math.PI; // Skia is radians, RN is degrees
/** Where the magnetic hang-then-draw-in takes over path progress. */
const MAGNET_FROM = 0.9;

/** Folder flap: lowers to receive the card, then shuts behind it. */
const FLAP_OPEN_MS = 230;
const FLAP_CLOSE_MS = 300;
/** Beat between the card settling and the flap shutting on it. */
const FLAP_HOLD_MS = 160;
/** Sheets parting to make room, timed to be done well before the card arrives. */
const SPREAD_MS = 485;

/**
 * Where the frozen frame lets go: the still, its blur and the scrim fade out
 * across this window, so by BACKDROP_CLEAR_P the live camera is fully visible
 * and usable again — while the receipt and folder finish playing over the top
 * of it. Same 0.9 as the align/magnet handover; the receipt is a sheet in the
 * folder by then, so the review has nothing left to say.
 */
const BACKDROP_FADE_FROM = 0.35;
const BACKDROP_CLEAR_P = 0.9;
/** How far the flap drops, in folder viewbox units. */
const FLAP_DROP = 5;

/** Resting breath — the card eases ±1% around its true size. */
const BREATH = 0.01;
const BREATH_MS = 3600;

export function ReceiptReview({
  photoUri,
  fields,
  loading,
  onConfirmed,
  onDone,
  onRetake,
  onFieldsChange,
}: {
  photoUri: string;
  fields: ReceiptFields | null;
  loading: boolean;
  /**
   * The receipt is in — persist it. Fires at BACKDROP_CLEAR_P, NOT at the end
   * of the animation, because from that point the camera is live again and a
   * second capture can remount this component mid-flight. Confirming on unmount
   * would silently lose the receipt in exactly that case.
   */
  onConfirmed: (f: ReceiptFields) => void;
  /** The animation has fully played out and the overlay can be torn down. */
  onDone: () => void;
  onRetake: () => void;
  onFieldsChange: (f: ReceiptFields) => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false);
  // The face's height is content-driven (item count, notes), so it's measured
  // rather than assumed — the landing size is derived from it.
  const [cardH, setCardH] = useState(0);

  const cardW = Math.min(width * 0.72, 290);

  // Folder sits top-left. The flight ends ON the front sheet already inside it —
  // same centre, same size, same orientation — so the receipt becomes one of
  // them. Derived from the shared folder geometry, so it can't drift out of
  // register. (Barely 3px from the old eyeballed folder centre, but now exact.)
  const folderLeft = insets.left + spacing.lg;
  const folderTop = insets.top + spacing.sm;
  const fScale = FOLDER_W / VIEW_W;
  const sheetW = SHEETS.front.w * fScale;
  const sheetH = SHEETS.front.h * fScale;
  /** The front sheet at rest. `spread` slides it off this — added in the worklet. */
  const landing = {
    x: folderLeft + (SHEETS.front.x + SHEETS.front.w / 2) * fScale,
    y: folderTop + (SHEETS.front.y + SHEETS.front.h / 2) * fScale,
  };
  /** What `spread` adds to that, at full spread, in screen px. */
  const spreadOffset = { x: SPREAD.front.dx * fScale, y: SPREAD.front.dy * fScale };
  const cardCentre = { x: width / 2, y: height / 2 };
  const flightDist = Math.hypot(cardCentre.x - landing.x, cardCentre.y - landing.y);

  // Parked just past the left edge, at its resting height — it slides straight
  // in, left to right.
  const folderOffX = -(folderLeft + FOLDER_W + 12);

  const p = useSharedValue(0);
  const dragY = useSharedValue(0);
  const spread = useSharedValue(0);
  /** 0 → parked off-screen, 1 → in place. */
  const folderIn = useSharedValue(0);
  /** 0 → flap shut, 1 → dropped open to receive the card. */
  const flap = useSharedValue(0);
  /**
   * 1 once the swipe is past threshold and the flight is playing itself out.
   * Guards the handover below: a finger CAN drag past BACKDROP_CLEAR_P and then
   * come back down without ever releasing, and persisting a receipt the user
   * then pulled back would be a real bug.
   */
  const committed = useSharedValue(0);
  /** Camera is live again; the overlay stops taking touches. */
  const [released, setReleased] = useState(false);

  // Slow floating breath: the card eases between 99% and 101% scale while it
  // rests. Safe to scale the whole card because the torn edge is a Skia layer —
  // the old border-triangle teeth wouldn't follow a parent scale on iOS.
  const breath = useSharedValue(1 - BREATH);
  useEffect(() => {
    breath.value = withRepeat(
      withTiming(1 + BREATH, { duration: BREATH_MS, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [breath]);

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

  // The flap drops open as the card comes in to land, and shuts again if the
  // drag is abandoned. Threshold-watched like the folder, so it keeps its own
  // easing rather than being yoked to the finger.
  useAnimatedReaction(
    () => p.value >= MAGNET_FROM,
    (open, prev) => {
      if (prev === null || open === prev) return;
      flap.value = withTiming(open ? 1 : 0, {
        duration: open ? FLAP_OPEN_MS : FLAP_CLOSE_MS,
        easing: EMPHASIZED,
      });
    },
  );

  /**
   * Hand the receipt over and let the camera go. Both happen at the same beat.
   *
   * NB: declared ABOVE the reaction that calls it. A worklet captures its
   * closure when it is built, during render — referencing a `const` declared
   * further down the component body reads it in its temporal dead zone.
   */
  const release = useCallback(() => {
    setReleased(true);
    if (fields) onConfirmed(fields);
  }, [fields, onConfirmed]);

  const finish = useCallback(() => {
    onDone();
  }, [onDone]);

  // The receipt is home enough to hand over: persist it and give the camera
  // back. One-way — once released the flight is committed, so there's nothing
  // to undo.
  useAnimatedReaction(
    () => committed.value === 1 && p.value >= BACKDROP_CLEAR_P,
    (out, prev) => {
      if (prev === null || out === prev || !out) return;
      runOnJS(release)();
    },
  );

  const openEdit = useCallback(() => {
    setEditing(true);
    dragY.value = withTiming(0);
  }, [dragY]);

  const buzz = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  /**
   * The flap shutting on the receipt. Rigid is the sharpest of the impact
   * styles — it reads as a click rather than a thud.
   *
   * TODO: play a click sample here too. The project has no audio package and no
   * sound assets, and expo-audio is a native module (dev-client rebuild), so
   * this is haptics-only for now — see the note in the PR.
   */
  const clack = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
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
        committed.value = 1;
        spread.value = withTiming(1, { duration: SPREAD_MS });
        p.value = withTiming(1, { duration: FLIGHT_MS, easing: EMPHASIZED_DECELERATE }, (done) => {
          if (!done) return;
          // Receipt is in. Let it settle for a beat, then the flap shuts on it
          // with a click, and only then does the folder carry it off-screen.
          // p stays at 1, so neither reaction above will fight this.
          runOnJS(clack)();
          flap.value = withDelay(
            FLAP_HOLD_MS,
            withTiming(0, { duration: FLAP_CLOSE_MS, easing: EMPHASIZED }, (shut) => {
              if (!shut) return;
              folderIn.value = withTiming(0, { duration: FOLDER_OUT_MS, easing: EMPHASIZED }, (gone) => {
                if (gone) runOnJS(finish)();
              });
            }),
          );
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

    // MAGNET: past 0.9 the path parameter is re-eased so the card hangs almost
    // still and is then drawn in. Squaring the segment means it barely creeps
    // for the first half of it — that hang IS the pause. Only the path uses
    // this; orientation and size keep using raw `t` so they finish on schedule.
    const seg = interpolate(t, [MAGNET_FROM, 1], [0, 1], Extrapolation.CLAMP);
    const tPath = Math.min(t, MAGNET_FROM) + (1 - MAGNET_FROM) * seg * seg;
    const mt = 1 - tPath;

    // Track the front sheet where it ACTUALLY is: `spread` has parted the
    // sheets by the time the receipt arrives, so the resting geometry alone
    // would drop the card short of it. Read live rather than assuming spread
    // has reached 1, so an abandoned drag stays consistent too.
    const sp = spread.value;
    const endX = landing.x + spreadOffset.x * sp - cardCentre.x;
    const endY = landing.y + spreadOffset.y * sp - cardCentre.y;

    // Both control points sit out to the right, but not by the same amount: the
    // first is held in so the climb starts tight, the second is thrown far out
    // and above the folder, which is what carries the card up to the top-right
    // before it turns and settles back down into the folder.
    const climb = Math.abs(endY);
    const cp1X = climb * BULGE_IN_RATIO;
    const cp1Y = endY * CP1_Y_RATIO;
    const cp2X = climb * BULGE_OUT_RATIO;
    const cp2Y = endY * CP2_Y_RATIO;

    const translateX = 3 * mt * mt * tPath * cp1X + 3 * mt * tPath * tPath * cp2X + tPath * tPath * tPath * endX;
    const translateY =
      3 * mt * mt * tPath * cp1Y +
      3 * mt * tPath * tPath * cp2Y +
      tPath * tPath * tPath * endY +
      dragY.value * 0.4;

    // Resting breath, eased out the instant the flight begins so it never
    // fights the shrink into the folder.
    const restFade = interpolate(t, [0, 0.15], [1, 0], Extrapolation.CLAMP);
    const breathScale = 1 + (breath.value - 1) * restFade;

    // ALIGN: the tumble stops growing at ALIGN_FROM and unwinds from whatever
    // angle it had reached to the sheet's — flat, quarter-turned — by
    // ALIGNED_BY. Freezing `tumbleT` is what makes it "from wherever it is"
    // rather than from a fixed pose.
    const align = interpolate(t, [ALIGN_FROM, ALIGNED_BY], [0, 1], Extrapolation.CLAMP);
    const tumbleT = Math.min(t, ALIGN_FROM);
    const rx = interpolate(tumbleT, [0, 1], [0, PITCH]) * (1 - align);
    const ry = interpolate(tumbleT, [0, 1], [0, YAW]) * (1 - align);
    const rz =
      interpolate(tumbleT, [0, 1], [0, ROLL]) * (1 - align) + (LAND_TURN + SPREAD_TURN * sp) * align;

    // ...and the size lands on the sheet's exact size in the same window. Once
    // turned, the card lies on its side: its height runs across the screen and
    // its width down it, so each screen axis is sized separately.
    const faceH = cardH || cardW * 1.5; // fallback for the frame before measurement
    const size = interpolate(t, [0, ALIGNED_BY], [0, 1], Extrapolation.CLAMP);
    const sx = 1 + (sheetW / faceH - 1) * size;
    const sy = 1 + (sheetH / cardW - 1) * size;

    // Once home, the card rides the folder out. It's the folder's front card
    // now, so it has to leave WITH the folder — left behind it would hang in
    // mid-air as the folder slid away. Gated on `landed` so the folder's own
    // ENTRY (folderIn 0→1, back at p 0.2) doesn't drag the card along with it.
    const landed = interpolate(t, [0.98, 1], [0, 1], Extrapolation.CLAMP);
    const carry = interpolate(folderIn.value, [0, 1], [folderOffX, 0], Extrapolation.CLAMP) * landed;

    return {
      transform: [
        { translateX: translateX + carry },
        { translateY },
        { scaleX: sx * breathScale },
        { scaleY: sy * breathScale },
        // perspective must precede the rotations for them to read as 3D.
        { perspective: 900 },
        { rotateX: `${rx}deg` },
        { rotateY: `${ry}deg` },
        { rotateZ: `${rz}deg` },
      ],
    };
  });

  // Slides in from beyond the left edge and back out the same way.
  const folderStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(folderIn.value, [0, 1], [folderOffX, 0]) }],
  }));

  const hintStyle = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.08], [1, 0], 'clamp') }));

  // The frozen frame releases the screen back to the live camera behind it.
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [BACKDROP_FADE_FROM, BACKDROP_CLEAR_P], [1, 0], Extrapolation.CLAMP),
  }));
  // ...and the blur goes with it, via intensity rather than alpha (see above).
  const blurProps = useAnimatedProps(() => ({
    intensity: interpolate(
      p.value,
      [BACKDROP_FADE_FROM, BACKDROP_CLEAR_P],
      [BLUR_INTENSITY, 0],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    // Once released the overlay is pure decoration playing out over a live
    // camera, so it must stop swallowing taps on the shutter beneath it.
    <View style={styles.root} pointerEvents={released ? 'none' : 'auto'}>
      {/* Frozen frame, blurred back so the card is the only thing in focus —
          and faded out entirely by BACKDROP_CLEAR_P, handing the screen back to
          the live camera underneath. The opaque black lives here, not on the
          root, or it would keep the camera hidden after the fade. */}
      <View style={styles.backdrop} pointerEvents="none">
        <Animated.View style={[styles.fill, styles.black, backdropStyle]}>
          <Image source={{ uri: photoUri }} style={styles.fill} contentFit="cover" />
        </Animated.View>
        <AnimatedBlurView tint="dark" style={styles.fill} animatedProps={blurProps} />
        <Animated.View style={[styles.scrim, backdropStyle]} />
      </View>

      {/* The folder is split so the receipt can sit INSIDE it — back panel and
          existing sheets below the card, flap above. Both layers carry the same
          position and slide-in transform, so they move as one object. */}
      <Animated.View
        style={[styles.folderBack, { left: folderLeft, top: folderTop }, folderStyle]}
        pointerEvents="none"
      >
        <RecentsFolder width={FOLDER_W} spread={spread} layer="back" />
      </Animated.View>

      <View style={styles.centre} pointerEvents="box-none">
        <GestureDetector gesture={pan}>
          <Animated.View
            style={[{ width: cardW }, cardStyle]}
            onLayout={(e) => setCardH(e.nativeEvent.layout.height)}
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

      {/* The flap, drawn over the card — this is what makes the receipt read as
          being tucked IN the folder rather than resting on top of it. */}
      <Animated.View
        style={[styles.folderFront, { left: folderLeft, top: folderTop }, folderStyle]}
        pointerEvents="none"
      >
        <RecentsFolder width={FOLDER_W} label="" flap={flap} flapDrop={FLAP_DROP} layer="front" />
      </Animated.View>

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
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  // No backgroundColor here: the black rides the fading layer, not the wrapper,
  // or it would stay opaque and keep the camera hidden.
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  black: { backgroundColor: '#000' },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  // Card (3) under folder (5), so it drops behind the folder's front panel.
  // Z-order is the whole trick: folder back (4) → receipt (5) → flap (6), so
  // the receipt lands as the FRONT card in the folder, under the flap.
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', zIndex: 5 },
  folderBack: { position: 'absolute', zIndex: 4 },
  folderFront: { position: 'absolute', zIndex: 6 },
  hints: { position: 'absolute', bottom: 70, flexDirection: 'row', alignItems: 'center', gap: 6 },
  hintText: { fontFamily: fontFamily.semibold, fontSize: 14, color: 'rgba(255,255,255,0.9)' },
  sheetWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 },
});
