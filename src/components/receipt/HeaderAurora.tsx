/**
 * HeaderAurora — the soft pastel mesh behind the store name on the receipt
 * header (Figma node 22:4, "gradient-header").
 *
 * The Figma builds it from five overlapping blurred blob SVGs. Those don't run
 * in RN (rule 1), so it's rebuilt here as blurred radial gradients over white:
 * a few pastel blobs spread horizontally, heavily blurred so they merge, then
 * faded back to white at the bottom so the mesh melts into the paper before the
 * items. Purely decorative — it sits behind the text.
 */
import React from 'react';
import { Blur, Canvas, Circle, Fill, Group, LinearGradient, Paint, RadialGradient, Rect, vec } from '@shopify/react-native-skia';

type Blob = { cx: number; cy: number; r: number; color: string };

// Centres/radii are fractions of the header box; colours are pastel-on-white,
// spread green → blue → violet left to right to read as one horizontal wash.
const BLOBS: Blob[] = [
  { cx: 0.28, cy: 0.72, r: 0.62, color: 'rgba(92,198,148,0.72)' }, // green, lower-left
  { cx: 0.16, cy: 0.28, r: 0.5, color: 'rgba(120,176,220,0.5)' }, // blue, upper-left
  { cx: 0.6, cy: 0.4, r: 0.56, color: 'rgba(176,150,226,0.58)' }, // violet, centre-right
  { cx: 0.84, cy: 0.66, r: 0.54, color: 'rgba(150,168,236,0.55)' }, // periwinkle, right
  { cx: 0.5, cy: 0.14, r: 0.42, color: 'rgba(158,206,206,0.4)' }, // teal wash, top
];

export function HeaderAurora({ width, height }: { width: number; height: number }) {
  if (width <= 0 || height <= 0) return null;
  const spread = Math.max(width, height);

  return (
    <Canvas style={{ width, height }} pointerEvents="none">
      <Fill color="#FFFFFF" />

      <Group
        layer={
          <Paint>
            <Blur blur={width * 0.06} />
          </Paint>
        }
      >
        {BLOBS.map((b, i) => {
          const cx = b.cx * width;
          const cy = b.cy * height;
          const r = b.r * spread;
          return (
            <Circle key={i} cx={cx} cy={cy} r={r}>
              <RadialGradient c={vec(cx, cy)} r={r} colors={[b.color, 'rgba(255,255,255,0)']} />
            </Circle>
          );
        })}
      </Group>

      {/* Melt the mesh into white toward the bottom, before the divider. */}
      <Rect x={0} y={height * 0.45} width={width} height={height * 0.55}>
        <LinearGradient
          start={vec(0, height * 0.45)}
          end={vec(0, height)}
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.9)']}
        />
      </Rect>
    </Canvas>
  );
}
