/**
 * TapToFocus — tap the preview to re-run autofocus and hold it.
 *
 * WHAT THIS CAN AND CANNOT DO. expo-camera exposes no point-of-interest focus:
 * `autofocus` is a single global switch — 'on' means "focus once, then LOCK",
 * 'off' means "focus continuously" (and is the default) — it is iOS-only, and
 * the camera ref has no focus method. There is no way to aim the lens at a
 * coordinate. (Verified against expo-camera 57: no `focusPoint`,
 * `pointOfInterest` or `setFocus` anywhere in the package; the `focusDistance`
 * in its types belongs to WebCameraSettings.)
 *
 * What a tap CAN do is force a fresh convergence and then lock it, which is the
 * half that actually matters when framing a receipt: continuous AF hunts, and
 * hunting is what produces the soft frame that makes /extract guess. Locking
 * once composed is the win.
 *
 *   tap → 'off'  drop any existing lock, let the lens hunt
 *       → after AF_SETTLE_MS → 'on'  lock wherever it converged
 *
 * The reticle is therefore honest feedback that focus was re-run — NOT a claim
 * that focus is biased toward that point. In practice a receipt fills the
 * frame, so centre-weighted AF lands on the document wherever you tapped.
 *
 * True aimed focus needs react-native-vision-camera's `focus({x, y})`, which is
 * a native module and a capture-pipeline migration.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { EMPHASIZED } from '@/theme/motion';

/** 'on' = focus once then lock · 'off' = continuous. Mirrors expo-camera's FocusMode. */
export type AutofocusMode = 'on' | 'off';

/** Time given to the lens to converge before the focus is locked. */
const AF_SETTLE_MS = 650;
/** How long the reticle sits at full strength before fading. */
const RETICLE_HOLD_MS = 700;
const RETICLE = 76;

export type FocusPoint = { x: number; y: number; tick: number };

export function useTapToFocus() {
  const [mode, setMode] = useState<AutofocusMode>('off');
  const [point, setPoint] = useState<FocusPoint | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick = useRef(0);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /** Re-run autofocus, then lock. Rapid taps restart the cycle rather than stack. */
  const focusAt = useCallback((x: number, y: number) => {
    tick.current += 1;
    setPoint({ x, y, tick: tick.current });
    void Haptics.selectionAsync();

    if (timer.current) clearTimeout(timer.current);
    setMode('off');
    timer.current = setTimeout(() => setMode('on'), AF_SETTLE_MS);
  }, []);

  /**
   * Back to continuous. Call whenever the frame is about to change for real —
   * a new scan is a new document, and carrying a stale lock into it would keep
   * the next receipt soft.
   */
  const release = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setMode('off');
    setPoint(null);
  }, []);

  return { mode, point, focusAt, release };
}

function Reticle({ x, y }: { x: number; y: number }) {
  const scale = useSharedValue(1.4);
  const opacity = useSharedValue(0);

  useEffect(() => {
    scale.value = withTiming(1, { duration: 220, easing: EMPHASIZED });
    opacity.value = withSequence(
      withTiming(1, { duration: 120 }),
      withDelay(RETICLE_HOLD_MS, withTiming(0, { duration: 260 })),
    );
  }, [scale, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.reticle, { left: x - RETICLE / 2, top: y - RETICLE / 2 }, style]}
    />
  );
}

/**
 * Full-bleed tap target plus the reticle. Render directly after the CameraView:
 * later siblings (menu button, shutter, controls) paint above it and keep their
 * own taps, so this only receives taps on bare preview.
 */
export function TapToFocusLayer({
  point,
  onFocus,
  enabled = true,
}: {
  point: FocusPoint | null;
  onFocus: (x: number, y: number) => void;
  enabled?: boolean;
}) {
  return (
    <>
      <Pressable
        style={StyleSheet.absoluteFill}
        disabled={!enabled}
        // Decorative: the shutter is the real control, and a full-screen
        // "button" would otherwise swallow the preview for screen readers.
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        onPress={(e) => onFocus(e.nativeEvent.locationX, e.nativeEvent.locationY)}
      />
      {point && <Reticle key={point.tick} x={point.x} y={point.y} />}
    </>
  );
}

const styles = StyleSheet.create({
  reticle: {
    position: 'absolute',
    width: RETICLE,
    height: RETICLE,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.95)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
});
