/**
 * TornEdge — the jagged receipt-bottom row of white teeth (28 downward
 * triangles, bases touching along the top). Same tooth count/height as the
 * onboarding card's zigzag (ReceiptCard.tsx's `bare` mode) so both cards match.
 *
 * Drawn as a Skia path rather than a row of 0×0 border-triangle views: those
 * render via borders on a zero-size box, and a zero-size layer doesn't reliably
 * inherit an ancestor's scale transform on iOS.
 */
import React, { useMemo } from 'react';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';

const ZIG = 28;

export function TornEdge({ width, s = 1, color = '#fff' }: { width: number; s?: number; color?: string }) {
  const toothW = width / ZIG;
  const toothH = 8 * s;

  const path = useMemo(() => {
    const p = Skia.Path.Make();
    // Each tooth: a downward triangle — base across the top, apex at the bottom.
    for (let i = 0; i < ZIG; i++) {
      const x0 = i * toothW;
      p.moveTo(x0, 0);
      p.lineTo(x0 + toothW, 0);
      p.lineTo(x0 + toothW / 2, toothH);
      p.close();
    }
    return p;
  }, [toothW, toothH]);

  if (width <= 0) return null;
  return (
    <Canvas style={{ width, height: toothH }} pointerEvents="none">
      <Path path={path} color={color} />
    </Canvas>
  );
}
