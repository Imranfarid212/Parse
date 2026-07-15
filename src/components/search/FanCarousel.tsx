/**
 * FanCarousel — native Reanimated rebuild of the web GSAP "social cards" fan.
 * Receipt cards fan out around a centered card. Tapping a side card swaps it to
 * the centre; chevrons rotate the fan; dots track the centre. Up to 7 cards.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { ReceiptCard } from '@/components/ui/ReceiptCard';
import { colors } from '@/theme/tokens';

export type FanItem = { id: number; total: string };

const CARD_W = 168;
const CARD_H = 280;
const CENTER = 3; // slot index of the centred card (0..6)
const SPRING = { damping: 15, stiffness: 130 };

// Fan transform for a given slot (0..6), derived from distance to centre.
function slotConfig(slot: number) {
  const d = slot - CENTER; // -3..3
  const ad = Math.abs(d);
  return {
    x: d * CARD_W * 0.3,
    y: ad * ad * (CARD_H * 0.035),
    rot: d * 7,
    scale: 1 - 0.075 * ad,
    z: 10 - ad,
  };
}

function FanCard({
  slot,
  left,
  top,
  item,
  onPress,
}: {
  slot: number;
  left: number;
  top: number;
  item: FanItem;
  onPress: () => void;
}) {
  const c = slotConfig(slot);
  const x = useSharedValue(c.x);
  const y = useSharedValue(c.y);
  const rot = useSharedValue(c.rot);
  const sc = useSharedValue(c.scale);

  useEffect(() => {
    const t = slotConfig(slot);
    x.value = withSpring(t.x, SPRING);
    y.value = withSpring(t.y, SPRING);
    rot.value = withSpring(t.rot, SPRING);
    sc.value = withSpring(t.scale, SPRING);
  }, [slot, x, y, rot, sc]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { rotate: `${rot.value}deg` }, { scale: sc.value }],
  }));

  return (
    <Animated.View style={[styles.card, { left, top, width: CARD_W, height: CARD_H, zIndex: slotConfig(slot).z }, style]}>
      <Pressable onPress={onPress} style={StyleSheet.absoluteFill}>
        <ReceiptCard width={CARD_W} height={CARD_H} total={item.total} />
      </Pressable>
    </Animated.View>
  );
}

export function FanCarousel({ items }: { items: FanItem[] }) {
  const { width } = useWindowDimensions();
  const n = items.length;
  // `order[slot] = index into items`. Starts centered on the middle item.
  const [order, setOrder] = useState<number[]>(() => items.map((_, i) => i));

  // Keep order in sync if the item set changes.
  useEffect(() => {
    setOrder(items.map((_, i) => i));
  }, [items]);

  const slotOfItem = (itemIdx: number) => order.indexOf(itemIdx);

  const tapItem = (itemIdx: number) => {
    const slot = slotOfItem(itemIdx);
    if (slot === CENTER) return;
    setOrder((prev) => {
      const next = [...prev];
      [next[slot], next[CENTER]] = [next[CENTER], next[slot]];
      return next;
    });
  };

  const rotate = (dir: 1 | -1) => {
    setOrder((prev) => (dir === 1 ? [...prev.slice(1), prev[0]] : [prev[prev.length - 1], ...prev.slice(0, -1)]));
  };

  const centerLeft = (width - CARD_W) / 2;
  const centerItem = order[CENTER];

  return (
    <View style={styles.root}>
      <View style={[styles.stage, { height: CARD_H + CARD_H * 0.24 }]}>
        {items.map((item, itemIdx) => (
          <FanCard
            key={item.id}
            slot={slotOfItem(itemIdx)}
            left={centerLeft}
            top={20}
            item={item}
            onPress={() => tapItem(itemIdx)}
          />
        ))}
      </View>

      <View style={styles.controls}>
        <Pressable style={styles.arrow} onPress={() => rotate(-1)} hitSlop={8}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.dots}>
          {items.map((_, i) => (
            <View key={i} style={[styles.dot, i === centerItem && styles.dotActive]} />
          ))}
        </View>
        <Pressable style={styles.arrow} onPress={() => rotate(1)} hitSlop={8}>
          <Ionicons name="chevron-forward" size={20} color={colors.textPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center' },
  stage: { alignSelf: 'stretch' },
  card: { position: 'absolute' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 8 },
  arrow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(120,120,128,0.10)',
  },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.15)' },
  dotActive: { backgroundColor: colors.textPrimary, transform: [{ scale: 1.3 }] },
});
