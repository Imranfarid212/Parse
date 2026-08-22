/**
 * A continuous receipt carousel that renders at most five overlapping cards.
 * The selected receipt advances through the full result set; the five-card
 * window follows it, keeping rendering bounded even for large searches.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { ReceiptCard, type ReceiptCardDetails } from '@/components/ui/ReceiptCard';
import { makeStyles, useColors } from '@/theme/appearance';
import { radius, spacing, typography } from '@/theme/tokens';

export type FanItem = { id: string; total: string; details: ReceiptCardDetails };

const CARD_W = 168;
const CARD_H = 280;
const MAX_VISIBLE_CARDS = 5;
const CENTER_SLOT = Math.floor(MAX_VISIBLE_CARDS / 2);
const SWIPE_THRESHOLD = 60;
const SPRING = { damping: 15, stiffness: 130 };

function slotConfig(slot: number, activeSlot: number) {
  const distance = slot - activeSlot;
  const magnitude = Math.abs(distance);
  return {
    x: distance * CARD_W * 0.3,
    y: magnitude * magnitude * (CARD_H * 0.035),
    rotation: distance * 7,
    scale: 1 - 0.075 * magnitude,
    zIndex: MAX_VISIBLE_CARDS - magnitude,
  };
}

function FanCard({ item, slot, activeSlot, left, active, onPress }: {
  item: FanItem;
  slot: number;
  activeSlot: number;
  left: number;
  active: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const initial = slotConfig(slot, activeSlot);
  const x = useSharedValue(initial.x);
  const y = useSharedValue(initial.y);
  const rotation = useSharedValue(initial.rotation);
  const scale = useSharedValue(initial.scale);

  useEffect(() => {
    const next = slotConfig(slot, activeSlot);
    x.value = withSpring(next.x, SPRING);
    y.value = withSpring(next.y, SPRING);
    rotation.value = withSpring(next.rotation, SPRING);
    scale.value = withSpring(next.scale, SPRING);
  }, [activeSlot, rotation, scale, slot, x, y]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { rotate: `${rotation.value}deg` },
      { scale: scale.value },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.card,
        { left, top: 20, width: CARD_W, height: CARD_H, zIndex: slotConfig(slot, activeSlot).zIndex },
        animatedStyle,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.details.merchant}, ${item.total}${active ? ', tap to edit' : ', tap to select'}`}
        onPress={onPress}
        style={StyleSheet.absoluteFill}
      >
        <ReceiptCard width={CARD_W} height={CARD_H} total={item.total} details={item.details} />
      </Pressable>
    </Animated.View>
  );
}

export function FanCarousel({ items, onOpenItem, onDeleteItem }: {
  items: FanItem[];
  onOpenItem?: (id: string) => void;
  onDeleteItem?: (id: string) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { width } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const itemIds = useMemo(() => items.map((item) => item.id).join('|'), [items]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, items.length - 1)));
  }, [itemIds, items.length]);

  const visibleEntries = useMemo(() => {
    if (items.length === 0) return [];
    const offsets = items.length >= MAX_VISIBLE_CARDS ? [-2, -1, 0, 1, 2] : [0, 1, -1, 2, -2];
    const seen = new Set<number>();
    return offsets.flatMap((offset) => {
      const index = (activeIndex + offset + items.length) % items.length;
      if (seen.has(index)) return [];
      seen.add(index);
      return [{ item: items[index], index, slot: CENTER_SLOT + offset }];
    }).sort((a, b) => a.slot - b.slot);
  }, [activeIndex, items]);
  const selectedItem = items[activeIndex];
  const activeDotIndex = visibleEntries.length > 0 ? activeIndex % visibleEntries.length : 0;
  const centerLeft = (width - CARD_W) / 2;
  const canMove = items.length > 1;

  const previous = () => setActiveIndex((current) => (current - 1 + items.length) % items.length);
  const next = () => setActiveIndex((current) => (current + 1) % items.length);

  const finishSwipe = (x: number, y: number) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const deltaX = x - start.x;
    const deltaY = y - start.y;
    if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;
    if (deltaX < 0 && canMove) next();
    if (deltaX > 0 && canMove) previous();
  };

  return (
    <View
      style={styles.root}
      onTouchStart={(event) => {
        touchStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
      }}
      onTouchEnd={(event) => finishSwipe(event.nativeEvent.pageX, event.nativeEvent.pageY)}
      onTouchCancel={() => { touchStart.current = null; }}
    >
      <View style={[styles.stage, { height: CARD_H + CARD_H * 0.24 }]}>
        {visibleEntries.map(({ item, index, slot }) => {
          const active = index === activeIndex;
          return (
            <FanCard
              key={item.id}
              item={item}
              slot={slot}
              activeSlot={CENTER_SLOT}
              left={centerLeft}
              active={active}
              onPress={() => active ? onOpenItem?.(item.id) : setActiveIndex(index)}
            />
          );
        })}
      </View>

      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous receipt"
          style={[styles.arrow, !canMove && styles.disabled]}
          onPress={previous}
          hitSlop={8}
          disabled={!canMove}
        >
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.dots}>
          {visibleEntries.map(({ item }, dotIndex) => (
            <View key={item.id} style={[styles.dot, dotIndex === activeDotIndex && styles.dotActive]} />
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next receipt"
          style={[styles.arrow, !canMove && styles.disabled]}
          onPress={next}
          hitSlop={8}
          disabled={!canMove}
        >
          <Ionicons name="chevron-forward" size={20} color={colors.textPrimary} />
        </Pressable>
      </View>

      {selectedItem && (onOpenItem || onDeleteItem) ? (
        <View style={styles.actions}>
          {onOpenItem ? (
            <Pressable accessibilityRole="button" onPress={() => onOpenItem(selectedItem.id)} style={styles.actionButton} hitSlop={6}>
              <Ionicons name="create-outline" size={16} color={colors.textPrimary} />
              <Text style={styles.actionText}>Edit receipt</Text>
            </Pressable>
          ) : null}
          {onDeleteItem ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${selectedItem.details.merchant}`} onPress={() => onDeleteItem(selectedItem.id)} style={styles.deleteButton} hitSlop={6}>
              <Ionicons name="trash-outline" size={17} color={colors.danger} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { alignItems: 'center' },
  stage: { alignSelf: 'stretch' },
  card: { position: 'absolute' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  arrow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  disabled: { opacity: 0.35 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.borderStrong },
  dotActive: { backgroundColor: colors.accent, transform: [{ scale: 1.3 }] },
  actions: { minHeight: 40, marginTop: spacing.sm + 2, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actionButton: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionText: { ...typography.label, color: colors.textPrimary },
  deleteButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dangerSurface,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
}));
