/**
 * AnimatedGridBackground — native Skia recreation of the "animated grid
 * pattern" web component (originally SVG <pattern> + framer-motion, which RN
 * can't run). A faint grid of lines, skewed for a slight side-angle look, with
 * grey squares that fade in/out at random cells and periodically relocate,
 * softened by a radial focus toward center.
 */
import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Canvas, Fill, Group, Path, RadialGradient, Rect, vec } from '@shopify/react-native-skia';
import {
  Easing,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { colors, palette } from '@/theme/tokens';

const GRID = 40; // cell size (px)
const NUM_SQUARES = 36;
const LINE_COLOR = '#D1D5DB'; // gray-300, faint neutral
const SQUARE_COLOR = '#9CA3AF'; // gray-400, neutral grey highlight (no blue)
const MAX_OPACITY = 0.28;
const TWINKLE_MS = 3200;
const RELOCATE_MS = 2500;
const SKEW_Y = -0.21; // ~12deg, leaning right-to-left

type Cell = { px: number; py: number; phase: number; key: number };

function TwinkleSquare({ cell, size, t }: { cell: Cell; size: number; t: SharedValue<number> }) {
  const opacity = useDerivedValue(() => {
    const p = (t.value + cell.phase) % 1;
    const tri = p < 0.5 ? p * 2 : (1 - p) * 2; // 0 -> 1 -> 0
    return tri * MAX_OPACITY;
  });
  return <Rect x={cell.px} y={cell.py} width={size} height={size} color={SQUARE_COLOR} opacity={opacity} />;
}

export function AnimatedGridBackground({ children }: { children?: ReactNode }) {
  const { width, height } = useWindowDimensions();

  // Pad beyond the screen, SNAPPED to whole grid cells so the lines and the
  // squares share exactly one lattice (otherwise squares don't sit in cells).
  const padX = Math.ceil((width * 0.4) / GRID) * GRID;
  const padY = Math.ceil((height * 0.5) / GRID) * GRID;
  const startX = -padX;
  const endX = width + padX;
  const startY = -padY;
  const endY = height + padY;

  const gridPath = useMemo(() => {
    let d = '';
    const stepsX = Math.ceil((endX - startX) / GRID);
    const stepsY = Math.ceil((endY - startY) / GRID);
    for (let i = 0; i <= stepsX; i++) {
      const x = startX + i * GRID;
      d += `M${x} ${startY}V${endY} `;
    }
    for (let j = 0; j <= stepsY; j++) {
      const y = startY + j * GRID;
      d += `M${startX} ${y}H${endX} `;
    }
    return d.trim();
  }, [startX, endX, startY, endY]);

  // Twinkling squares across the visible screen (they skew with the grid).
  const cols = Math.ceil(width / GRID);
  const rows = Math.ceil(height / GRID);
  const randomCell = (): Cell => ({
    px: Math.floor(Math.random() * cols) * GRID + 1,
    py: Math.floor(Math.random() * rows) * GRID + 1,
    phase: Math.random(),
    key: Math.random(),
  });

  const [squares, setSquares] = useState<Cell[]>(() => Array.from({ length: NUM_SQUARES }, randomCell));

  useEffect(() => {
    setSquares(Array.from({ length: NUM_SQUARES }, randomCell));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, rows]);

  useEffect(() => {
    const iv = setInterval(() => {
      setSquares((prev) => prev.map((s) => (Math.random() < 0.3 ? randomCell() : s)));
    }, RELOCATE_MS);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, rows]);

  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: TWINKLE_MS, easing: Easing.linear }), -1, false);
  }, [t]);

  return (
    <View style={styles.root}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill color={colors.background} />

        {/* Skewed grid + twinkling squares. */}
        <Group origin={vec(width / 2, height / 2)} transform={[{ skewY: SKEW_Y }]}>
          <Path path={gridPath} style="stroke" strokeWidth={1} color={LINE_COLOR} opacity={0.35} />
          {squares.map((c) => (
            <TwinkleSquare key={c.key} cell={c} size={GRID - 2} t={t} />
          ))}
        </Group>

        {/* Radial focus — grid crisp at center, fading hard outward to near-white at edges. */}
        <Rect x={0} y={0} width={width} height={height}>
          <RadialGradient
            c={vec(width / 2, height * 0.45)}
            r={Math.max(width, height) * 0.95}
            colors={[
              `${palette.canvas}00`,
              `${palette.canvas}00`,
              `${palette.canvas}99`,
              palette.canvas,
            ]}
            positions={[0, 0.18, 0.62, 1]}
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
