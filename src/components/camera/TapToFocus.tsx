/**
 * TapToFocus — tap the preview to focus the lens at that exact point.
 *
 * This is real point-of-interest focus: the tap coordinates go to
 * `CameraRef.focusTo({ x, y })`, which drives the native focus/metering point.
 * The reticle marks where the lens is actually being aimed.
 *
 * (It did not start out honest. On expo-camera there is no POI focus at all —
 * `autofocus` is one global 'on'/'off' switch — so the first version could only
 * force a global refocus and draw a square where you happened to tap. Swapping
 * to VisionCamera is what turned the reticle from decoration into aim.)
 */
import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useEffect } from 'react';

import { EMPHASIZED } from '@/theme/motion';

/** How long the reticle sits at full strength before fading. */
const RETICLE_HOLD_MS = 700;
const RETICLE = 76;

export type FocusPoint = { x: number; y: number; tick: number };

/**
 * Tracks where to draw the reticle. Deliberately does NOT drive the camera —
 * the screen owns the camera ref and calls `focusTo` itself, so this stays a
 * pure view concern.
 */
export function useFocusReticle() {
  const [point, setPoint] = useState<FocusPoint | null>(null);
  const tick = useRef(0);

  const show = useCallback((x: number, y: number) => {
    tick.current += 1;
    setPoint({ x, y, tick: tick.current });
    void Haptics.selectionAsync();
  }, []);

  const clear = useCallback(() => setPoint(null), []);

  return { point, show, clear };
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
 * Full-bleed tap target plus the reticle. Render directly after the Camera:
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
