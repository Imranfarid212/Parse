/**
 * PlanScreen — the Plan tab content: the subscription screen (finance-app
 * reference). A Pro/Max segmented toggle drives which plan's features + prices
 * show; an "Early promotion discount" switch applies the discounted prices; two
 * billing cards (month/year) pick the term. Everything below reacts to those
 * three choices, ending in a Subscribe button that reflects the live price.
 * MenuPanel renders the "Subscription" title.
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';

import { Card, GRAY, Toggle } from '@/components/menu/primitives';
import { fontFamily, spacing } from '@/theme/tokens';

type PlanKey = 'pro' | 'max';
type Billing = 'month' | 'year';

const PLANS: Record<PlanKey, {
  name: string;
  features: string[];
  monthly: { original: number; discounted: number };
  yearly: { original: number; discounted: number };
}> = {
  pro: {
    name: 'Pro',
    features: ['200 uploads per month', 'Unlimited previews', 'Unlimited exports', 'Unlimited storage'],
    monthly: { original: 9.99, discounted: 6.99 },
    yearly: { original: 71.99, discounted: 49.99 },
  },
  max: {
    name: 'Max',
    features: ['Unlimited uploads per month', 'Unlimited previews', 'Unlimited exports', 'Unlimited storage'],
    monthly: { original: 15.99, discounted: 10.99 },
    yearly: { original: 149.99, discounted: 79.99 },
  },
};

const GREEN = '#22C55E';
const AMBER = { fg: '#B45309', bg: '#FFFBEB', border: '#FDE68A' };

/** Two-segment Pro/Max toggle with a sliding white pill. */
const SEG_PAD = 4;
function PlanToggle({ value, onChange }: { value: PlanKey; onChange: (p: PlanKey) => void }) {
  const [trackW, setTrackW] = useState(0);
  const segW = trackW > 0 ? (trackW - SEG_PAD * 2) / 2 : 0;
  const p = useDerivedValue(() => withTiming(value === 'max' ? 1 : 0, { duration: 220 }));
  const indicator = useAnimatedStyle(() => ({ width: segW, transform: [{ translateX: p.value * segW }] }));

  return (
    <View style={styles.segTrack} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
      {segW > 0 && <Animated.View style={[styles.segIndicator, indicator]} />}
      {(['pro', 'max'] as PlanKey[]).map((k) => (
        <Pressable key={k} style={styles.segBtn} onPress={() => onChange(k)}>
          <Text style={[styles.segLabel, { color: value === k ? GRAY[900] : GRAY[500] }]}>{PLANS[k].name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** A billing card: bold price (with strikethrough when the promo is on) + term. */
function BillingCard({
  term,
  selected,
  original,
  discounted,
  promo,
  onPress,
}: {
  term: string;
  selected: boolean;
  original: number;
  discounted: number;
  promo: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.billCard, selected ? styles.billCardOn : styles.billCardOff]}
    >
      <View style={styles.billPriceRow}>
        {promo && <Text style={styles.billStrike}>${original.toFixed(2)}</Text>}
        <Text style={styles.billPrice}>${(promo ? discounted : original).toFixed(2)}</Text>
      </View>
      <Text style={styles.billTerm}>per {term}</Text>
    </Pressable>
  );
}

export function PlanScreen() {
  const [plan, setPlan] = useState<PlanKey>('pro');
  const [promo, setPromo] = useState(false);
  const [billing, setBilling] = useState<Billing>('month');

  const current = PLANS[plan];
  const price = billing === 'month' ? current.monthly : current.yearly;
  const displayPrice = promo ? price.discounted : price.original;

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <PlanToggle value={plan} onChange={setPlan} />

      {/* Trial badge */}
      <View style={styles.trialWrap}>
        <View style={styles.trialBadge}>
          <Feather name="alert-circle" size={14} color={AMBER.fg} />
          <Text style={styles.trialText}>Free Trial: 9 scans left</Text>
        </View>
      </View>

      {/* Features */}
      <Card style={styles.featureCard}>
        {current.features.map((f) => (
          <View key={f} style={styles.featureRow}>
            <Feather name="check" size={18} color={GREEN} />
            <Text style={styles.featureText}>{f}</Text>
          </View>
        ))}
      </Card>

      {/* Promo */}
      <View style={styles.promoRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.promoTitle}>Early promotion discount</Text>
          <Text style={styles.promoSub}>30% off — tap now to avail</Text>
        </View>
        <Toggle value={promo} onValueChange={setPromo} activeColor={GREEN} />
      </View>

      {/* Billing */}
      <View style={styles.billRow}>
        <BillingCard
          term="month"
          selected={billing === 'month'}
          original={current.monthly.original}
          discounted={current.monthly.discounted}
          promo={promo}
          onPress={() => setBilling('month')}
        />
        <BillingCard
          term="year"
          selected={billing === 'year'}
          original={current.yearly.original}
          discounted={current.yearly.discounted}
          promo={promo}
          onPress={() => setBilling('year')}
        />
      </View>

      {/* Subscribe */}
      <Pressable style={({ pressed }) => [styles.subscribe, pressed && { transform: [{ scale: 0.98 }] }]}>
        <Text style={styles.subscribeText}>Subscribe for ${displayPrice.toFixed(2)} / {billing}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 40 },

  segTrack: {
    flexDirection: 'row',
    backgroundColor: GRAY[200],
    borderRadius: 999,
    padding: SEG_PAD,
  },
  segIndicator: {
    position: 'absolute',
    top: SEG_PAD,
    bottom: SEG_PAD,
    left: SEG_PAD,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 3, color: 'rgba(0,0,0,0.10)' }],
  },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9 },
  segLabel: { fontFamily: fontFamily.semibold, fontSize: 13 },

  trialWrap: { alignItems: 'center', marginTop: 24 },
  trialBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: AMBER.bg,
    borderWidth: 1,
    borderColor: AMBER.border,
  },
  trialText: { fontFamily: fontFamily.semibold, fontSize: 12, color: AMBER.fg },

  featureCard: { borderRadius: 24, padding: 24, gap: 16, marginTop: 24 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureText: { fontFamily: fontFamily.regular, fontSize: 14, color: GRAY[600] },

  promoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: GRAY[100],
    boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 12, color: 'rgba(0,0,0,0.02)' }],
  },
  promoTitle: { fontFamily: fontFamily.semibold, fontSize: 13, color: GRAY[900] },
  promoSub: { fontFamily: fontFamily.regular, fontSize: 11, color: GRAY[500], marginTop: 2 },

  billRow: { flexDirection: 'row', gap: 16, marginTop: 24 },
  billCard: { flex: 1, padding: 16, borderRadius: 20, borderWidth: 2 },
  billCardOn: { borderColor: GRAY[900], backgroundColor: GRAY[50] },
  billCardOff: { borderColor: GRAY[200], backgroundColor: '#FFFFFF' },
  billPriceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  billStrike: { fontFamily: fontFamily.regular, fontSize: 13, color: GRAY[400], textDecorationLine: 'line-through' },
  billPrice: { fontFamily: fontFamily.display, fontSize: 16, color: GRAY[900] },
  billTerm: { fontFamily: fontFamily.regular, fontSize: 11, color: GRAY[500], marginTop: 4 },

  subscribe: {
    height: 52,
    borderRadius: 16,
    backgroundColor: GRAY[900],
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
    boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 20, color: 'rgba(0,0,0,0.15)' }],
  },
  subscribeText: { fontFamily: fontFamily.semibold, fontSize: 15, color: '#FFFFFF' },
});
