/**
 * SleuthDog — the line-art detective-dog illustration for the Search empty
 * state, ported from the finance-app reference SVG. The project has no
 * react-native-svg, so it's drawn with Skia: each reference <path>/<rect>/
 * <ellipse> maps to a Skia primitive, in the reference's draw order (faint tail
 * sweeps behind the body, paws on top). A bottom linear-gradient fades the art
 * into the page, matching the reference's mask-image.
 */
import React from 'react';
import {
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Oval,
  Path,
  Rect,
  RoundedRect,
  vec,
} from '@shopify/react-native-skia';

const VB = 200; // reference viewBox is 200×200

/** A stroked outline. */
function Stroke({ d, color, w }: { d: string; color: string; w: number }) {
  return <Path path={d} color={color} style="stroke" strokeWidth={w} strokeJoin="round" strokeCap="round" />;
}

/** A white/grey fill with a grey outline. */
function Filled({ d, fill, stroke, w }: { d: string; fill: string; stroke: string; w: number }) {
  return (
    <Group>
      <Path path={d} color={fill} />
      <Path path={d} color={stroke} style="stroke" strokeWidth={w} strokeJoin="round" strokeCap="round" />
    </Group>
  );
}

const BODY =
  'M65 65 C 80 50, 100 55, 105 75 C 110 95, 120 105, 120 120 C 120 140, 100 150, 80 150 C 60 150, 50 130, 50 100 C 50 80, 55 70, 65 65 Z';
const EAR = 'M55 75 C 35 85, 30 125, 45 140 C 55 150, 65 120, 65 95 C 65 85, 60 75, 55 75 Z';
const PAW = 'M85 160 C 85 150, 105 150, 105 160 L105 170 L85 170 Z';

export function SleuthDog({ size = 240, fadeColor = '#FBFBFD' }: { size?: number; fadeColor?: string }) {
  const scale = size / VB;
  const transparent = fadeColor + '00'; // #RRGGBBAA, alpha 0

  return (
    <Canvas style={{ width: size, height: size }}>
      <Group transform={[{ scale }]}>
        {/* ground */}
        <Stroke d="M10 170 L190 170" color="#E5E7EB" w={2} />
        <Stroke d="M30 180 L170 180" color="#F3F4F6" w={2} />

        {/* desk + papers */}
        <Filled d="M100 160 L160 160 L140 100 L100 100 Z" fill="#FFFFFF" stroke="#D1D5DB" w={1.5} />
        <Filled d="M90 170 L170 170 L160 160 L100 160 Z" fill="#F9FAFB" stroke="#D1D5DB" w={1.5} />
        <Stroke d="M108 108 L134 108" color="#E5E7EB" w={2} />
        <Stroke d="M106 116 L142 116" color="#E5E7EB" w={2} />

        {/* faint tail / hind sweeps (behind the body) */}
        <Stroke d="M40 170 C 30 140, 40 100, 60 90 C 50 110, 50 150, 70 170" color="#E5E7EB" w={1.5} />
        <Stroke d="M70 170 C 60 140, 70 110, 90 100" color="#E5E7EB" w={1.5} />

        {/* body + ear */}
        <Filled d={BODY} fill="#FFFFFF" stroke="#D1D5DB" w={1.5} />
        <Filled d={EAR} fill="#F9FAFB" stroke="#D1D5DB" w={1.5} />
        <Stroke d="M48 95 C 42 110, 45 125, 50 130" color="#E5E7EB" w={1.5} />

        {/* glasses */}
        {[75, 97].map((x) => (
          <Group key={x}>
            <RoundedRect x={x} y={82} width={18} height={12} r={2} color="#FFFFFF" />
            <RoundedRect x={x} y={82} width={18} height={12} r={2} color="#6B7280" style="stroke" strokeWidth={2} />
          </Group>
        ))}
        <Stroke d="M93 88 L97 88" color="#6B7280" w={2} />
        <Stroke d="M60 88 L75 88" color="#6B7280" w={2} />

        {/* hat band, ear tip, snout, nose, muzzle, jowl */}
        <Stroke d="M65 65 C 65 50, 105 50, 105 65" color="#9CA3AF" w={2.5} />
        <Oval x={54} y={73} width={12} height={24} color="#9CA3AF" />
        <Stroke d="M65 92 C 75 105, 95 105, 105 92" color="#9CA3AF" w={1.5} />
        <Circle cx={105} cy={92} r={2} color="#9CA3AF" />
        <Oval x={114} y={109} width={8} height={6} color="#9CA3AF" />
        <Stroke d="M118 115 C 118 122, 110 125, 105 125" color="#D1D5DB" w={1.5} />

        {/* front paw */}
        <Filled d={PAW} fill="#FFFFFF" stroke="#D1D5DB" w={1.5} />
        <Stroke d="M92 160 L92 165" color="#D1D5DB" w={1.5} />
        <Stroke d="M98 160 L98 165" color="#D1D5DB" w={1.5} />
      </Group>

      {/* fade the art into the page toward the bottom */}
      <Rect x={0} y={0} width={size} height={size}>
        <LinearGradient start={vec(0, size * 0.45)} end={vec(0, size)} colors={[transparent, fadeColor]} />
      </Rect>
    </Canvas>
  );
}
