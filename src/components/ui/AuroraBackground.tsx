/**
 * AuroraBackground — native Skia recreation of the "aurora" web effect
 * (originally a Tailwind repeating-linear-gradient, which RN can't run).
 *
 * The signature look is a REPEATING diagonal gradient — many thin parallel
 * colored bands, lightly blurred and slowly drifting — not a single blurred
 * blob. Two offset layers drift in opposite directions for shimmer/depth,
 * over the clean-fintech canvas, with a soft bottom vignette for readability.
 */
import React, { useEffect, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import {
  Blur,
  Canvas,
  Fill,
  Group,
  LinearGradient,
  Paint,
  Rect,
  vec,
} from '@shopify/react-native-skia';
import {
  Easing,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { aurora, colors, palette } from '@/theme/tokens';

const CLEAR = `${palette.canvas}00`; // transparent canvas — the gap between bands

type LayerProps = {
  x: number;
  y: number;
  w: number;
  h: number;
  period: number;
  rotate: number;
  blur: number;
  opacity: number;
  bandColors: string[];
  drift: ReturnType<typeof useDerivedValue<{ translateX: number }[]>>;
  center: { x: number; y: number };
};

function StreakLayer({ x, y, w, h, period, rotate, blur, opacity, bandColors, drift, center }: LayerProps) {
  // Colored bands separated by transparent gaps; repeats across the whole rect.
  const stops = [CLEAR, ...bandColors, CLEAR];
  const n = stops.length - 1;
  const positions = stops.map((_, i) => i / n);
  return (
    <Group origin={vec(center.x, center.y)} transform={[{ rotate }]}>
      <Group opacity={opacity} layer={<Paint><Blur blur={blur} /></Paint>}>
        <Group transform={drift}>
          <Rect x={x} y={y} width={w} height={h}>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(period, 0)}
              mode="repeat"
              colors={stops}
              positions={positions}
            />
          </Rect>
        </Group>
      </Group>
    </Group>
  );
}

export function AuroraBackground({ children }: { children?: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const center = { x: width / 2, y: height / 2 };

  const a = useSharedValue(0);
  const b = useSharedValue(0);
  useEffect(() => {
    a.value = withRepeat(withTiming(1, { duration: aurora.driftMs, easing: Easing.inOut(Easing.ease) }), -1, true);
    b.value = withRepeat(withTiming(1, { duration: aurora.driftMs * 1.6, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [a, b]);

  const periodA = width * 0.6;
  const periodB = width * 0.42;
  // Drift the bands sideways by up to one period (seamless because the gradient repeats).
  const driftA = useDerivedValue(() => [{ translateX: (a.value - 0.5) * periodA }]);
  const driftB = useDerivedValue(() => [{ translateX: (0.5 - b.value) * periodB }]);

  // Oversized rects so rotation + drift never expose an edge.
  const rx = -width * 0.6;
  const rw = width * 2.2;
  const ry = -height * 0.25;
  const rh = height * 1.5;

  return (
    <View style={styles.root}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill color={colors.background} />

        <StreakLayer
          x={rx} y={ry} w={rw} h={rh} period={periodA} rotate={-0.16} blur={18} opacity={0.55}
          bandColors={[palette.auroraBlue, palette.auroraSky, palette.auroraIndigo, palette.auroraViolet]}
          drift={driftA} center={center}
        />
        <StreakLayer
          x={rx} y={ry} w={rw} h={rh} period={periodB} rotate={-0.24} blur={26} opacity={0.35}
          bandColors={[palette.auroraSky, palette.auroraViolet, palette.auroraBlueLight]}
          drift={driftB} center={center}
        />

        {/* Soft bottom vignette so the CTA/copy area stays clean. */}
        <Rect x={0} y={0} width={width} height={height}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, height)}
            colors={[CLEAR, CLEAR, palette.canvas]}
            positions={[0, 0.62, 0.98]}
          />
        </Rect>
      </Canvas>

      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
