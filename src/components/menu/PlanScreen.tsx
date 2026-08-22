/**
 * PlanScreen — the Plan tab content: the subscription screen. A Pro/Max
 * segmented toggle drives which plan's features + prices show; an "Early
 * promotion discount" switch applies the discounted prices; two billing cards
 * (month/year) pick the term. Everything below reacts to those three choices,
 * ending in a Subscribe button that reflects the live price. MenuPanel renders
 * the "Subscription" title.
 *
 * The design is the app design system (Segmented, PrimaryButton, theme tokens).
 * What B8 changed is where the numbers come from: every price is the store's own
 * formatted string, in the user's currency, for the exact product the Subscribe
 * button will charge. No price is composed or formatted in this file.
 *
 * The promo switch is not a discount the client applies — it cannot be, because
 * a client cannot change what Apple or Google charges. It selects between two
 * real RevenueCat offerings, each holding its own store products. That is why
 * both prices are always real, and why the switch hides itself entirely when the
 * promo offering does not exist.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import {
  COPY_PURCHASE_PENDING_ENTITLEMENT,
  COPY_REFERRAL_ALREADY_USED,
  COPY_REFERRAL_BLOCKED,
  COPY_RESTORE_PURCHASES,
  COPY_RESTORE_PURCHASES_DONE,
  COPY_RESTORE_PURCHASES_NONE,
} from '@/../packages/contracts/src/copy';
import {
  REFERRED_REWARD_SCANS,
  REFERRER_REWARD_SCANS,
  USER_REFERRAL_MAX_REWARDS,
  isReferralCode,
  normalizeReferralCode,
  type ReferralSummary,
} from '@/../packages/contracts/src/referrals';
import { MONTHLY_SCAN_CAP, type Term, type Tier } from '@/../packages/contracts/src/products';
import { Card, Eyebrow, PrimaryButton, Segmented, Toggle } from '@/components/menu/primitives';
import { useAuth } from '@/lib/auth/auth-context';
import { useEntitlements } from '@/lib/billing/entitlement-store';
import { describeBillingDiagnosis, purchasePackage } from '@/lib/billing/purchases';
import { priceKey, usePlanOfferings } from '@/lib/billing/use-plan-offerings';
import { getReferralSummary, peekReferralSummary, redeemReferral, shareReferral } from '@/lib/referrals/client';
import { makeStyles, useColors } from '@/theme/appearance';
import { fontFamily, radius, spacing, typography } from '@/theme/tokens';

type Billing = Term;

/**
 * Copy only — the prices live in the store now. The allowance figure is imported
 * from the catalogue rather than typed, so the marketing line and the number
 * can_scan() enforces cannot drift: "200 uploads per month" next to a server
 * that stops at 150 is the kind of mismatch that becomes a refund.
 */
const PLANS: Record<Tier, { name: string; features: string[] }> = {
  pro: {
    name: 'Pro',
    features: [
      `${MONTHLY_SCAN_CAP.pro} uploads per month`,
      'Unlimited previews',
      'Unlimited exports',
      'Unlimited storage',
    ],
  },
  max: {
    name: 'Max',
    features: ['Unlimited uploads per month', 'Unlimited previews', 'Unlimited exports', 'Unlimited storage'],
  },
};

const PLAN_OPTIONS = (['pro', 'max'] as Tier[]).map((key) => ({ key, label: PLANS[key].name }));

/** A billing card: bold price (with strikethrough when the promo is on) + term. */
function BillingCard({
  term,
  selected,
  listPrice,
  promoPrice,
  promo,
  onPress,
}: {
  term: string;
  selected: boolean;
  listPrice: string | null;
  promoPrice: string | null;
  promo: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const showing = promo ? promoPrice : listPrice;
  // The struck-through price is only shown when there is a real, different price
  // to strike. Striking an identical number would imply a saving the store is
  // not giving.
  const struck = promo && listPrice && listPrice !== promoPrice ? listPrice : null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={showing ? `${showing} per ${term}` : `Price unavailable per ${term}`}
      style={[styles.billCard, selected ? styles.billCardOn : styles.billCardOff]}
    >
      <View style={styles.billPriceRow}>
        {struck && <Text style={styles.billStrike}>{struck}</Text>}
        <Text style={styles.billPrice}>{showing ?? '—'}</Text>
      </View>
      <Text style={styles.billTerm}>per {term}</Text>
    </Pressable>
  );
}

export function PlanScreen() {
  const styles = useStyles();
  const colors = useColors();
  const [plan, setPlan] = useState<Tier>('pro');
  const [promo, setPromo] = useState(false);
  const [billing, setBilling] = useState<Billing>('month');
  const [busy, setBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [referralCode, setReferralCode] = useState('');
  const auth = useAuth();
  const userId = auth.user?.id ?? null;
  // Seed from the cache so a revisit paints the real code and progress on the
  // first frame. A cold load still starts null and shows the placeholder.
  const [referral, setReferral] = useState<ReferralSummary | null>(() => peekReferralSummary(userId));
  const referralRef = useRef<ReferralSummary | null>(referral);
  const [referralError, setReferralError] = useState<string | null>(null);
  const [referralLoading, setReferralLoading] = useState(() => peekReferralSummary(userId) === null);

  const prices = usePlanOfferings();
  const entitlements = useEntitlements();

  // The reward bar fills to its value instead of snapping there. It animates on
  // the real number arriving and on every subsequent change, so a reward earned
  // while the screen is open reads as progress rather than a jump.
  const rewardPct = Math.min(
    100,
    ((referral?.rewarded ?? 0) / (referral?.max_rewards ?? USER_REFERRAL_MAX_REWARDS)) * 100,
  );
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(rewardPct, { duration: 650 });
  }, [rewardPct, progress]);
  const progressStyle = useAnimatedStyle(() => ({ width: `${progress.value}%` }));

  const loadReferral = useCallback(async () => {
    // Stale-while-revalidate: with a summary already on screen the refresh runs
    // silently, so re-opening Plan never flashes back to a placeholder. Only a
    // genuine cold load gets the loading state.
    if (!referralRef.current) setReferralLoading(true);
    try {
      setReferralError(null);
      const summary = await getReferralSummary(userId);
      referralRef.current = summary;
      setReferral(summary);
    } catch (error) {
      // A refresh failure must not contradict a valid summary already rendered
      // on screen (for example, "Referral already applied" plus a load error).
      // Keep the last confirmed server state and surface an error only when the
      // screen has never loaded referral details successfully.
      if (!referralRef.current) {
        setReferralError(error instanceof Error ? error.message : 'Could not load referral details.');
      }
    } finally {
      setReferralLoading(false);
    }
  }, [userId]);

  useEffect(() => { void loadReferral(); }, [loadReferral]);

  const applyReferral = useCallback(async () => {
    const code = normalizeReferralCode(referralCode);
    if (!isReferralCode(code) || redeemBusy) return;
    setRedeemBusy(true);
    setReferralError(null);
    try {
      const result = await redeemReferral(code, 'code');
      if (result.granted) {
        setReferralCode('');
        Alert.alert('Referral applied', result.toast ?? `You received ${REFERRED_REWARD_SCANS} extra scans.`);
        await Promise.all([loadReferral(), entitlements.refresh()]);
      } else if (result.reason === 'already_redeemed') {
        Alert.alert('Referral already used', COPY_REFERRAL_ALREADY_USED);
      } else {
        Alert.alert('Referral not applied', COPY_REFERRAL_BLOCKED);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not apply the referral code.';
      setReferralError(message);
    } finally {
      setRedeemBusy(false);
    }
  }, [entitlements, loadReferral, redeemBusy, referralCode]);

  const share = useCallback(async () => {
    if (shareBusy) return;
    if (!referral?.code) {
      Alert.alert(
        'Invite unavailable',
        referralError ?? (referralLoading ? 'Your referral code is still loading.' : 'Your referral code is not ready yet.'),
      );
      return;
    }
    setShareBusy(true);
    setReferralError(null);
    try {
      await shareReferral(referral.code);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open the share sheet. Please try again.';
      setReferralError(message);
      Alert.alert('Could not share invite', message);
    }
    finally { setShareBusy(false); }
  }, [referral, shareBusy, referralError, referralLoading]);

  const listEntry = prices.entries[priceKey('default', plan, billing)] ?? null;
  const promoEntry = prices.entries[priceKey('promo', plan, billing)] ?? null;
  const selected = promo ? promoEntry : listEntry;

  const current = PLANS[plan];

  // A preview entry has no package, so it can never be bought. The button still
  // shows its price, because the whole point is to see the finished screen.
  const purchasable = selected?.pkg != null;

  /**
   * The badge counts down the real balance, as the design does. A paid plan
   * shows the plan instead — "Free Trial: 3 scans left" over a paid account
   * would be nonsense — and an uncapped plan has no number to show.
   */
  const planBadge = useMemo(() => {
    const { tier, remaining } = entitlements;
    if (tier === 'max') return `${PLANS.max.name} plan active`;
    if (tier === 'pro') {
      return remaining == null ? `${PLANS.pro.name} plan active` : `${PLANS.pro.name}: ${remaining} scans left`;
    }
    if (remaining == null) return 'Free Trial';
    return `Free Trial: ${remaining} ${remaining === 1 ? 'scan' : 'scans'} left`;
  }, [entitlements]);

  const subscribeLabel = useMemo(() => {
    if (!selected) return prices.loading ? 'Loading…' : 'Unavailable';
    return `Subscribe for ${selected.priceString} / ${billing}`;
  }, [selected, billing, prices.loading]);

  const subscribe = useCallback(async () => {
    if (!selected?.pkg || busy) return;
    setBusy(true);
    try {
      const outcome = await purchasePackage(selected.pkg);
      // Cancelling is the most common outcome of opening a paywall and is not an
      // error: say nothing at all.
      if (outcome.status === 'cancelled') return;
      if (outcome.status === 'unavailable') {
        Alert.alert('Purchases unavailable', 'This build cannot make purchases.');
        return;
      }
      if (outcome.status === 'failed') {
        Alert.alert('Purchase failed', outcome.message);
        return;
      }
      // The store has the money; the entitlement follows over the webhook. The
      // refresh usually closes the gap immediately, and the copy is honest about
      // it when it does not.
      await entitlements.refresh();
      if (!entitlements.tier) Alert.alert('Almost there', COPY_PURCHASE_PENDING_ENTITLEMENT);
    } finally {
      setBusy(false);
    }
  }, [selected, busy, entitlements]);

  const restore = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const outcome = await entitlements.restore();
      if (outcome.status === 'purchased') {
        Alert.alert('Restore', entitlements.tier ? COPY_RESTORE_PURCHASES_DONE : COPY_RESTORE_PURCHASES_NONE);
      } else if (outcome.status === 'failed') {
        Alert.alert('Restore failed', outcome.message);
      }
    } finally {
      setBusy(false);
    }
  }, [busy, entitlements]);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.referralSection}>
        <Eyebrow>INVITE FRIENDS</Eyebrow>
        <Card style={styles.referralCard}>
          <View style={styles.referralHeading}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.referralTitle}>Earn {REFERRER_REWARD_SCANS} scans per friend</Text>
              <Text style={styles.referralSub}>They start with {10 + REFERRED_REWARD_SCANS} free scans.</Text>
            </View>
            <Text selectable style={styles.ownCode}>{referral?.code ?? '------'}</Text>
          </View>
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: referral?.max_rewards ?? USER_REFERRAL_MAX_REWARDS, now: referral?.rewarded ?? 0 }}
            style={styles.progressTrack}
          >
            <Animated.View style={[styles.progressFill, progressStyle]} />
          </View>
          <View style={styles.referralMeta}>
            <Text style={styles.progressText}>{referral?.rewarded ?? 0}/{referral?.max_rewards ?? USER_REFERRAL_MAX_REWARDS} rewarded</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share referral invite"
              accessibilityState={{ busy: shareBusy }}
              disabled={shareBusy}
              onPress={() => void share()}
              style={({ pressed }) => [styles.shareButton, (pressed || shareBusy) && styles.secondaryPressed]}
            >
              <Feather name="share-2" size={15} color={colors.ctaText} />
              <Text style={styles.shareText}>{shareBusy ? 'Opening…' : 'Share invite'}</Text>
            </Pressable>
          </View>
        </Card>

        {/*
          Until the summary arrives, neither branch is known to be correct.
          Rendering the code row by default meant an already-referred user
          always saw "enter a code" first and then watched it get replaced a
          network round-trip later. The placeholder holds the same 48pt slot so
          nothing moves, and the resolved state fades in rather than hard-cutting.
        */}
        {referralLoading && !referral ? (
          <View style={styles.codePlaceholder} />
        ) : !referral?.referred ? (
          <Animated.View entering={FadeIn.duration(180)} style={styles.codeRow}>
            <TextInput
              value={referralCode}
              onChangeText={(value) => setReferralCode(normalizeReferralCode(value).slice(0, 6))}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              placeholder="6-character code"
              placeholderTextColor={colors.textFaint}
              accessibilityLabel="Referral code"
              style={styles.codeInput}
              editable={!redeemBusy}
              onSubmitEditing={() => void applyReferral()}
              returnKeyType="done"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Apply referral code"
              accessibilityState={{ disabled: !isReferralCode(referralCode) || redeemBusy }}
              disabled={!isReferralCode(referralCode) || redeemBusy}
              onPress={() => void applyReferral()}
              style={({ pressed }) => [styles.applyButton, (pressed || !isReferralCode(referralCode) || redeemBusy) && styles.secondaryPressed]}
            >
              <Text style={styles.applyText}>{redeemBusy ? 'Checking…' : 'Apply'}</Text>
            </Pressable>
          </Animated.View>
        ) : (
          <Animated.View
            entering={FadeIn.duration(180)}
            accessible
            accessibilityRole="text"
            accessibilityLabel={`Referral already applied. You received ${REFERRED_REWARD_SCANS} extra scans.`}
            style={styles.referralApplied}
          >
            <Feather name="check-circle" size={17} color={colors.accent} />
            <Text style={styles.referralAppliedText}>
              Referral already applied · {REFERRED_REWARD_SCANS} extra scans received
            </Text>
          </Animated.View>
        )}
        {referralError && <Text selectable style={styles.referralError}>{referralError}</Text>}
      </View>

      <Segmented value={plan} options={PLAN_OPTIONS} onChange={setPlan} />

      {/* Trial badge */}
      <View style={styles.trialWrap}>
        <View style={styles.trialBadge}>
          <Feather name="alert-circle" size={14} color={colors.warning} />
          <Text style={styles.trialText}>{planBadge}</Text>
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

      {/* Promo — hidden unless a real promo price list exists to switch to. */}
      {prices.hasPromo && (
        <View style={styles.promoRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.promoTitle}>Early promotion discount</Text>
            <Text style={styles.promoSub}>Tap now to avail</Text>
          </View>
          <Toggle label="Early promotion discount" value={promo} onValueChange={setPromo} />
        </View>
      )}

      {/* Billing */}
      <View style={styles.billRow}>
        <BillingCard
          term="month"
          selected={billing === 'month'}
          listPrice={prices.entries[priceKey('default', plan, 'month')]?.priceString ?? null}
          promoPrice={prices.entries[priceKey('promo', plan, 'month')]?.priceString ?? null}
          promo={promo}
          onPress={() => setBilling('month')}
        />
        <BillingCard
          term="year"
          selected={billing === 'year'}
          listPrice={prices.entries[priceKey('default', plan, 'year')]?.priceString ?? null}
          promoPrice={prices.entries[priceKey('promo', plan, 'year')]?.priceString ?? null}
          promo={promo}
          onPress={() => setBilling('year')}
        />
      </View>

      {/* Disabled unless there is a real product behind it, so the button can
          never charge a price the screen did not show. */}
      <PrimaryButton
        label={subscribeLabel}
        busy={busy || !purchasable}
        busyLabel={busy ? 'Working…' : subscribeLabel}
        onPress={() => void subscribe()}
        style={styles.subscribe}
      />

      {/* Says plainly that these are not real prices. The screen looks finished
          so it can be reviewed; the caption stops anyone reading it as live. */}
      {prices.preview && (
        <Text style={styles.helper}>
          Sample pricing — the store is not connected yet, so nothing here can be purchased.
        </Text>
      )}
      {!prices.loading && prices.empty && !prices.preview && (
        <Text style={styles.helper}>Plans are unavailable right now. Please try again later.</Text>
      )}
      {/* Development only: says WHICH cause it is. Shipping this to users would
          be noise, but not knowing cost an afternoon. */}
      {__DEV__ && describeBillingDiagnosis() && (
        <Text style={styles.diagnostic}>{describeBillingDiagnosis()}</Text>
      )}

      {/* Both stores require a restore control. */}
      <Pressable
        disabled={busy}
        onPress={() => void restore()}
        accessibilityRole="button"
        accessibilityLabel={COPY_RESTORE_PURCHASES}
        style={styles.restore}
      >
        <Text style={styles.restoreText}>{COPY_RESTORE_PURCHASES}</Text>
      </Pressable>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors, elevation) => ({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },

  referralSection: { gap: spacing.sm },
  referralCard: { padding: spacing.lg, gap: spacing.md },
  referralHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  referralTitle: { ...typography.label, color: colors.textPrimary },
  referralSub: { ...typography.meta, color: colors.textSecondary },
  ownCode: {
    fontFamily: fontFamily.display,
    fontSize: 20,
    letterSpacing: 2,
    color: colors.accent,
    fontVariant: ['tabular-nums'],
  },
  progressTrack: { height: 6, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.surfaceSubtle },
  progressFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.accent },
  referralMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  progressText: { ...typography.meta, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  shareButton: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.ctaBackground,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  shareText: { ...typography.label, color: colors.ctaText },
  codeRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm },
  // Same 48pt slot as both real branches, so resolving the summary never
  // reflows the card. Deliberately quiet — it should read as "not ready yet",
  // not as a third state competing for attention.
  codePlaceholder: {
    minHeight: 48,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceSubtle,
    opacity: 0.6,
  },
  codeInput: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontFamily: fontFamily.semibold,
    fontSize: 16,
    letterSpacing: 1.2,
    color: colors.textPrimary,
  },
  applyButton: {
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.accent,
  },
  applyText: { ...typography.label, color: colors.ctaText },
  secondaryPressed: { opacity: 0.5 },
  referralApplied: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  referralAppliedText: { ...typography.meta, flex: 1, color: colors.textSecondary },
  referralError: { ...typography.meta, color: colors.danger },

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
    // 15% down from 20 — with the promo on, the struck list price sits beside
    // this one in the same fixed-width card and the pair overflowed the border.
    fontSize: 17,
    letterSpacing: -0.4,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  billTerm: { ...typography.eyebrow, fontFamily: fontFamily.regular, color: colors.textSecondary, marginTop: spacing.xs },

  subscribe: { marginTop: spacing.sm, boxShadow: elevation.card },

  helper: { ...typography.meta, color: colors.textSecondary, textAlign: 'center' },
  diagnostic: { ...typography.eyebrow, fontFamily: fontFamily.regular, color: colors.warning, textAlign: 'center' },
  restore: { alignItems: 'center', paddingVertical: spacing.sm },
  restoreText: { ...typography.label, color: colors.textSecondary },
}));
