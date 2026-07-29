/**
 * AnimatedGridBackground — native Skia recreation of the "animated grid
 * pattern" web component. A faint skewed grid with grey squares that fade
 * in/out at random cells and periodically relocate, softened by a radial focus.
 *
 * Split into two layers for power:
 *   · a STATIC grid layer (memoised, drawn once) — it never animates, so there's
 *     no reason to redraw it with the twinkle.
 *   · an ANIMATED layer with only the twinkling squares, driven by a controlled
 *     ~15fps clock (a cancellable interval, not an unbounded withRepeat that
 *     redraws at 60–120fps). Slow opacity fades still read smooth at 15fps.
 *
 * The whole animation pauses — and its interval is cleared — whenever the
 * landing route loses focus, the app backgrounds, or Reduce Motion is on. Every
 * square keeps a STABLE id across relocations, so React never destroys and
 * recreates its component (and animated value) the way random keys did.
 */
import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, AppState, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { Canvas, Fill, Group, Path, RadialGradient, Rect, vec } from '@shopify/react-native-skia';
import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { colors, palette } from '@/theme/tokens';

const GRID = 40; // cell size (px)
const NUM_SQUARES = 20; // was 36 — unnecessarily dense; drop to 12–16 if still warm
const LINE_COLOR = '#D1D5DB'; // gray-300, faint neutral
const SQUARE_COLOR = '#9CA3AF'; // gray-400, neutral grey highlight (no blue)
const GREEN_TILE = 'rgba(14, 107, 80, 0.25)'; // accent tint for a few scattered tiles
const NUM_GREEN = 4; // how many of the tiles twinkle green instead of grey
const MAX_OPACITY = 0.28;
const TWINKLE_MS = 3200;
const RELOCATE_MS = 2500;
const SKEW_Y = -0.21; // ~12deg, leaning right-to-left
const TWINKLE_FPS = 15; // controlled clock rate

type Cell = { id: number; px: number; py: number; phase: number; green: boolean };

// A plain helper, not an inline hook callback — react-hooks/purity flags
// Math.random() called directly inside a useMemo/useState body, but not calls
// routed through a named function like this (same pattern randomPos() below
// already relies on from useState's initializer).
function pickGreenIds(): Set<number> {
  const ids = new Set<number>();
  while (ids.size < Math.min(NUM_GREEN, NUM_SQUARES)) ids.add(Math.floor(Math.random() * NUM_SQUARES));
  return ids;
}

function TwinkleSquare({ cell, size, t }: { cell: Cell; size: number; t: SharedValue<number> }) {
  const opacity = useDerivedValue(() => {
    const p = (t.value + cell.phase) % 1;
    const tri = p < 0.5 ? p * 2 : (1 - p) * 2; // 0 -> 1 -> 0
    // Green tiles carry their own alpha in the colour (rgba .12), so let their
    // twinkle peak at 1.0 — otherwise it compounds with MAX_OPACITY and vanishes.
    return cell.green ? tri : tri * MAX_OPACITY;
  });
  return <Rect x={cell.px} y={cell.py} width={size} height={size} color={cell.green ? GREEN_TILE : SQUARE_COLOR} opacity={opacity} />;
}

export function AnimatedGridBackground({
  children,
  excludeBand,
}: {
  children?: ReactNode;
  excludeBand?: { top: number; bottom: number } | null;
}) {
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

  // A square's on-screen Y after the skew transform (origin = screen center).
  const screenY = (px: number, py: number) => py + SKEW_Y * (px - width / 2);
  // Keep squares at least one grid cell clear of the hero-text band.
  const inExcluded = (px: number, py: number) => {
    if (!excludeBand) return false;
    const y = screenY(px, py);
    return y + GRID > excludeBand.top - GRID && y < excludeBand.bottom + GRID;
  };
  const randomPos = () => {
    let px = 0;
    let py = 0;
    for (let tries = 0; tries < 24; tries++) {
      px = Math.floor(Math.random() * cols) * GRID + 1;
      py = Math.floor(Math.random() * rows) * GRID + 1;
      if (!inExcluded(px, py)) break;
    }
    return { px, py, phase: Math.random() };
  };
  // Pick NUM_GREEN random tile ids once; green-ness is keyed to the id so a
  // relocation keeps the same tiles green rather than reshuffling which glow.
  const greenIds = useMemo(() => pickGreenIds(), []);
  // STABLE id per slot: relocation keeps the id and just moves the square, so
  // React reuses the same <TwinkleSquare> and its derived value.
  const makeCell = (id: number): Cell => ({ id, green: greenIds.has(id), ...randomPos() });

  const [squares, setSquares] = useState<Cell[]>(() =>
    Array.from({ length: NUM_SQUARES }, (_, i) => makeCell(i)),
  );

  useEffect(() => {
    setSquares(Array.from({ length: NUM_SQUARES }, (_, i) => makeCell(i)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, rows, excludeBand]);

  // Pause when the route isn't focused, the app is backgrounded, or Reduce
  // Motion is on. `animate` gates every interval below, so they never run —
  // and their cleanup clears them — outside those conditions.
  const isFocused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const app = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    const rm = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      app.remove();
      rm.remove();
    };
  }, []);
  const animate = isFocused && appActive && !reduceMotion;

  // Controlled ~15fps twinkle clock. Advancing a shared value on an interval —
  // instead of withRepeat — is what caps the redraw rate; cleared on pause.
  const t = useSharedValue(0);
  useEffect(() => {
    if (!animate) return undefined;
    const periodMs = 1000 / TWINKLE_FPS;
    const step = periodMs / TWINKLE_MS;
    const id = setInterval(() => {
      t.value = (t.value + step) % 1;
    }, periodMs);
    return () => clearInterval(id);
  }, [animate, t]);

  // Periodic relocation, also paused with `animate`.
  useEffect(() => {
    if (!animate) return undefined;
    const iv = setInterval(() => {
      setSquares((prev) =>
        prev.map((s) => (Math.random() < 0.3 ? { id: s.id, green: s.green, ...randomPos() } : s)),
      );
    }, RELOCATE_MS);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, cols, rows, excludeBand]);

  // Static layer: fill + grid. Memoised on geometry alone, so a relocation
  // (setSquares) can't trigger a redraw of it.
  const staticLayer = useMemo(
    () => (
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Fill color={colors.background} />
        <Group origin={vec(width / 2, height / 2)} transform={[{ skewY: SKEW_Y }]}>
          <Path path={gridPath} style="stroke" strokeWidth={1} color={LINE_COLOR} opacity={0.245} />
        </Group>
      </Canvas>
    ),
    [width, height, gridPath],
  );

  return (
    <View style={styles.root}>
      {staticLayer}

      {/* Animated layer: only the twinkling squares, plus the radial focus on
          top so it fades BOTH these squares and the static grid beneath. */}
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Group origin={vec(width / 2, height / 2)} transform={[{ skewY: SKEW_Y }]}>
          {squares.map((c) => (
            <TwinkleSquare key={c.id} cell={c} size={GRID - 2} t={t} />
          ))}
        </Group>

        <Rect x={0} y={0} width={width} height={height}>
          <RadialGradient
            c={vec(width / 2, height * 0.45)}
            r={Math.max(width, height) * 0.95}
            colors={[`${palette.canvas}00`, `${palette.canvas}00`, `${palette.canvas}33`]}
            positions={[0, 0.25, 1]}
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
