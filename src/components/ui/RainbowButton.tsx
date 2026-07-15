/**
 * RainbowButton — native Skia rebuild of the web "rainbow" glow button
 * (originally Tailwind animate-rainbow + CSS gradient-border + blurred
 * ::before glow, none of which run in RN). Draws an animated rainbow gradient
 * border and a blurred rainbow glow beneath a dark pill; colours flow on a loop.
 */
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Blur, Canvas, Group, LinearGradient, Paint, RoundedRect, vec } from '@shopify/react-native-skia';
import { Easing, useDerivedValue, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { typography } from '@/theme/tokens';

const BTN_W = 210;
const BTN_H = 54;
const GLOW = 34;
const R = 16;
const CANVAS_W = BTN_W + GLOW * 2;
const CANVAS_H = BTN_H + GLOW * 2;
const FACE = '#121213';

// c1, c5, c3, c4, c2 (matches the source gradient order), looped for seamless repeat.
const RAINBOW = ['#FF5B5B', '#8BFF5B', '#5BA9FF', '#5BE1FF', '#B15BFF', '#FF5B5B'];
const POS = [0, 0.2, 0.4, 0.6, 0.8, 1];

export function RainbowButton({ label, onPress }: { label: string; onPress: () => void }) {
  const phase = useSharedValue(0);
  useEffect(() => {
    phase.value = withRepeat(withTiming(BTN_W, { duration: 3000, easing: Easing.linear }), -1, false);
  }, [phase]);

  const gradTransform = useDerivedValue(() => [{ translateX: phase.value }]);

  // Rendered fresh per shape (a Skia gradient element can't be shared across shapes).
  const grad = () => (
    <LinearGradient start={vec(0, 0)} end={vec(BTN_W, 0)} colors={RAINBOW} positions={POS} mode="repeat" transform={gradTransform} />
  );

  return (
    <View style={styles.wrap}>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* Super-subtle animated rainbow glow bleeding out around the edges */}
        <Group opacity={0.48} layer={<Paint><Blur blur={11} /></Paint>}>
          <RoundedRect x={GLOW - 3.5} y={GLOW - 3.5} width={BTN_W + 7} height={BTN_H + 7} r={R + 3}>
            {grad()}
          </RoundedRect>
        </Group>

        {/* Dark face (no border) */}
        <RoundedRect x={GLOW} y={GLOW} width={BTN_W} height={BTN_H} r={R} color={FACE} />
      </Canvas>

      <Pressable onPress={onPress} style={styles.hit}>
        <Text style={styles.label}>{label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: CANVAS_W, height: CANVAS_H, alignItems: 'center', justifyContent: 'center' },
  hit: { width: BTN_W, height: BTN_H, alignItems: 'center', justifyContent: 'center' },
  label: { ...typography.button, color: '#fff' },
});
