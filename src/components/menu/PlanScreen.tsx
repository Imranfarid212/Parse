/**
 * PlanScreen — the Plan tab content: the subscription screen. A Pro/Max
 * segmented toggle drives which plan's features + prices show; an "Early
 * promotion discount" switch applies the discounted prices; two billing cards
 * (month/year) pick the term. Everything below reacts to those three choices,
 * ending in a Subscribe button that reflects the live price. MenuPanel renders
 * the "Subscription" title.
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Card, PrimaryButton, Segmented, Toggle } from '@/components/menu/primitives';
import { colors, elevation, fontFamily, radius, spacing, typography } from '@/theme/tokens';

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

const PLAN_OPTIONS = (['pro', 'max'] as PlanKey[]).map((key) => ({ key, label: PLANS[key].name }));

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
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`$${(promo ? discounted : original).toFixed(2)} per ${term}`}
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
      <Segmented value={plan} options={PLAN_OPTIONS} onChange={setPlan} />

      {/* Trial badge */}
      <View style={styles.trialWrap}>
        <View style={styles.trialBadge}>
          <Feather name="alert-circle" size={14} color={colors.warning} />
          <Text style={styles.trialText}>Free Trial: 9 scans left</Text>
        </View>
      </View>

      {/* Features */}
      <Card style={styles.featureCard}>
        {current.features.map((f) => (
          <View key={f} style={styles.featureRow}>
            <Feather name="check" size={18} color={colors.accent} />
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
        <Toggle label="Early promotion discount" value={promo} onValueChange={setPromo} />
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

      <PrimaryButton
        label={`Subscribe for $${displayPrice.toFixed(2)} / ${billing}`}
        style={styles.subscribe}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },

  trialWrap: { alignItems: 'center' },
  trialBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.warningSurface,
    borderWidth: 1,
    borderColor: colors.warningBorder,
  },
  trialText: { ...typography.eyebrow, color: colors.warning },

  featureCard: { padding: spacing.lg, gap: spacing.md },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  featureText: { ...typography.meta, fontSize: 15, color: colors.textSecondary },

  promoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  promoTitle: { ...typography.label, color: colors.textPrimary },
  promoSub: { ...typography.eyebrow, fontFamily: fontFamily.regular, color: colors.textSecondary, marginTop: 2 },

  billRow: { flexDirection: 'row', gap: spacing.md },
  billCard: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    borderWidth: 2,
  },
  billCardOn: { borderColor: colors.accent, backgroundColor: colors.accentSurface },
  billCardOff: { borderColor: colors.border, backgroundColor: colors.surface },
  billPriceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  billStrike: {
    ...typography.meta,
    color: colors.textFaint,
    textDecorationLine: 'line-through',
  },
  billPrice: {
    fontFamily: fontFamily.display,
    fontSize: 20,
    letterSpacing: -0.4,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  billTerm: { ...typography.eyebrow, fontFamily: fontFamily.regular, color: colors.textSecondary, marginTop: spacing.xs },

  subscribe: { marginTop: spacing.sm, boxShadow: elevation.card },
});
