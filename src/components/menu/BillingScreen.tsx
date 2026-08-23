/**
 * BillingScreen — what the store is charging, and the route to change it.
 *
 * This screen replaced a "Connected Cards" row that displayed a hardcoded
 * "2 active". It shows no card, and cannot: with in-app purchases Apple and
 * Google are the merchant of record, the card belongs to the user's store
 * account, and no payment instrument is exposed to a third-party app.
 * RevenueCat's `CustomerInfo` carries no PAN, last4, brand or expiry — there is
 * nothing to mask, and nothing here puts the app inside PCI DSS scope.
 *
 * So the screen is deliberately READ-ONLY. Every action that touches money —
 * upgrade, downgrade, change payment method, cancel, refund — happens on the
 * store's own authenticated screen. The one button hands over to it. The most
 * valuable thing here is not the plan name, it is the payment-problem banner:
 * an involuntary churn from an expired card is invisible to the user until
 * their plan stops working, and this is the only place in the app that tells
 * them while there is still time to fix it.
 *
 * Both platforms are handled, and they genuinely differ: iOS gets a modal sheet
 * over the app, Android leaves for Play and can additionally be PAUSED, a state
 * iOS has no equivalent for.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Card, Divider, Eyebrow } from '@/components/menu/primitives';
import {
  COPY_BILLING_BILLING_ISSUE_BODY,
  COPY_BILLING_BILLING_ISSUE_TITLE,
  COPY_BILLING_FAMILY_SHARED,
  COPY_BILLING_GRACE_BODY,
  COPY_BILLING_MANAGE_CTA,
  COPY_BILLING_MANAGE_FAILED,
  COPY_BILLING_MANAGE_NOTE_ANDROID,
  COPY_BILLING_MANAGE_NOTE_IOS,
  COPY_BILLING_NO_SUBSCRIPTION,
  COPY_BILLING_PAUSED_BODY,
  COPY_BILLING_REFUND_CTA,
  COPY_BILLING_REFUND_FAILED,
  COPY_BILLING_REFUND_SUBMITTED,
} from '@/../packages/contracts/src/copy';
import { MANAGE_SUBSCRIPTION_URLS } from '@/lib/billing/config';
import { useEntitlements } from '@/lib/billing/entitlement-store';
import { getCustomerInfo, openManageSubscriptions, requestRefund, safeManagementURL } from '@/lib/billing/purchases';
import {
  describeSubscription,
  EMPTY_SUMMARY,
  storeLabel,
  type SubscriptionSummary,
} from '@/lib/billing/subscription';
import { makeStyles, useColors } from '@/theme/appearance';
import { fontFamily, radius, spacing, typography } from '@/theme/tokens';

const TIER_NAMES = { pro: 'Parse Pro', max: 'Parse Max' } as const;

/** Matches the date style used by the receipt filters, so the app reads as one app. */
function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The one line that says where the user stands.
 *
 * Cancelled deliberately reads "Ends" rather than "Cancelled": the user already
 * knows they cancelled, and what they actually came here to check is the date
 * they keep access until.
 */
function statusLine(summary: SubscriptionSummary): { label: string; value: string } | null {
  const when = formatDate(summary.expiresAt);
  switch (summary.status) {
    case 'trial':
      return { label: 'Free trial ends', value: when ?? 'Soon' };
    case 'intro':
      return { label: 'Intro price until', value: when ?? 'Soon' };
    case 'active':
      return { label: 'Renews', value: when ?? 'Unknown' };
    case 'cancelled':
      return { label: 'Ends', value: when ?? 'Unknown' };
    case 'grace':
      return { label: 'Fix payment by', value: formatDate(summary.gracePeriodExpiresAt) ?? 'Soon' };
    case 'billing_issue':
      return { label: 'Stopped', value: when ?? 'Now' };
    case 'paused':
      return { label: 'Resumes', value: formatDate(summary.autoResumeAt) ?? 'When you resume it' };
    case 'expired':
      return { label: 'Ended', value: when ?? 'Unknown' };
    default:
      return null;
  }
}

function statusBadge(summary: SubscriptionSummary): string | null {
  switch (summary.status) {
    case 'trial':
      return 'Free trial';
    case 'intro':
      return 'Intro price';
    case 'cancelled':
      return 'Cancelled';
    case 'paused':
      return 'Paused';
    case 'expired':
      return 'Expired';
    default:
      return null;
  }
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/**
 * No Back control of its own: MenuPanel's header X pops back to Settings while
 * a sub-screen is open, so a second route out would be redundant chrome at the
 * bottom of a scroll the user may never reach.
 */
export function BillingScreen() {
  const styles = useStyles();
  const colors = useColors();
  const entitlements = useEntitlements();
  const [summary, setSummary] = useState<SubscriptionSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refunding, setRefunding] = useState(false);

  const load = useCallback(async () => {
    const info = await getCustomerInfo();
    setSummary(describeSubscription(info, Platform.OS, safeManagementURL(info?.managementURL)));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The store is where the change happens, so the app has to re-read after the
   * user comes back — otherwise someone who just cancelled sees "Renews" until
   * they kill the app. EntitlementProvider already refreshes the TIER on
   * foreground; this refreshes the fuller picture this screen shows.
   */
  const onManage = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Cross-store: subscribed on one platform, reading this on the other. The
      // native sheet can only ever show this device's store.
      const crossStore = !summary.manageableHere && summary.store
        ? summary.store === 'app_store'
          ? MANAGE_SUBSCRIPTION_URLS.apple
          : summary.store === 'play_store'
            ? MANAGE_SUBSCRIPTION_URLS.google
            : null
        : null;
      const outcome = await openManageSubscriptions(crossStore ?? summary.managementURL);
      if (outcome === 'failed') Alert.alert('Billing', COPY_BILLING_MANAGE_FAILED);
    } finally {
      setBusy(false);
      // Cheap, and covers the iOS modal sheet, which dismisses without the app
      // ever backgrounding — so no AppState change fires to trigger a refresh.
      void load();
      void entitlements.refresh();
    }
  };

  const onRefund = async () => {
    if (refunding) return;
    setRefunding(true);
    try {
      const outcome = await requestRefund();
      if (outcome === 'submitted') Alert.alert('Refund requested', COPY_BILLING_REFUND_SUBMITTED);
      else if (outcome === 'failed') Alert.alert('Refund', COPY_BILLING_REFUND_FAILED);
      // 'cancelled' is the user backing out of Apple's sheet. Silent by design.
    } finally {
      setRefunding(false);
      void load();
    }
  };

  const hasSubscription = summary.status !== 'none';
  const planName = summary.displayName ?? (summary.tier ? TIER_NAMES[summary.tier] : null);
  const line = statusLine(summary);
  const badge = statusBadge(summary);
  const needsAttention = summary.status === 'grace' || summary.status === 'billing_issue';

  /**
   * Where the button will actually land — which is what the note must describe.
   *
   * Keyed off the billing store, not the device: an iPhone subscription opened
   * on an Android tablet routes to Apple. The device is only the fallback, for
   * a subscription with no store we recognise (a promo grant, a web purchase,
   * or no subscription at all), where the generic page for THIS platform is the
   * only sensible destination. Reading the device alone was the earlier bug: an
   * Android user with an unknown billing store was told "opens the App Store".
   */
  const deviceStore = Platform.OS === 'android' ? 'play_store' : 'app_store';
  const destinationStore =
    summary.store === 'app_store' || summary.store === 'play_store' ? summary.store : deviceStore;
  const manageNote =
    destinationStore === 'play_store' ? COPY_BILLING_MANAGE_NOTE_ANDROID : COPY_BILLING_MANAGE_NOTE_IOS;
  // Family members cannot manage a subscription they did not buy: the store
  // screen would not list it. Refunds are Apple-only and pointless once the
  // subscription has already ended.
  const canManage = hasSubscription && !summary.isFamilyShared;
  const canRefund =
    Platform.OS === 'ios' &&
    summary.store === 'app_store' &&
    !summary.isFamilyShared &&
    (summary.status === 'active' || summary.status === 'trial' || summary.status === 'intro' || summary.status === 'cancelled');

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {needsAttention && (
        <View style={styles.alert}>
          <View style={styles.alertHead}>
            <Feather name="alert-triangle" size={14} color={colors.warning} />
            <Text style={styles.alertTitle}>{COPY_BILLING_BILLING_ISSUE_TITLE}</Text>
          </View>
          <Text style={styles.alertBody}>
            {summary.status === 'grace' ? COPY_BILLING_GRACE_BODY : COPY_BILLING_BILLING_ISSUE_BODY}
          </Text>
        </View>
      )}

      {summary.status === 'paused' && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{COPY_BILLING_PAUSED_BODY}</Text>
        </View>
      )}

      {!hasSubscription ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyText}>{COPY_BILLING_NO_SUBSCRIPTION}</Text>
        </Card>
      ) : (
        <View style={styles.section}>
          <Eyebrow style={{ marginLeft: spacing.sm }}>Subscription</Eyebrow>
          <Card>
            <View style={styles.planHead}>
              <Text style={styles.planName}>{planName ?? 'Active plan'}</Text>
              {badge && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              )}
            </View>
            <Divider inset={spacing.md} />
            <InfoRow label="Billed through" value={storeLabel(summary.store)} />
            {line && (
              <>
                <Divider inset={spacing.md} />
                <InfoRow label={line.label} value={line.value} />
              </>
            )}
            {/* Sandbox is a fact about OUR build, not about the user's money,
                and it means nothing to them. Development only: it stays
                genuinely useful while testing against the Test Store, where
                every other field looks real and nothing says why. */}
            {__DEV__ && summary.isSandbox && (
              <>
                <Divider inset={spacing.md} />
                <InfoRow label="Environment" value="Sandbox" />
              </>
            )}
          </Card>
        </View>
      )}

      {summary.isFamilyShared && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{COPY_BILLING_FAMILY_SHARED}</Text>
        </View>
      )}

      {canManage && (
        <View style={styles.section}>
          <Pressable
            onPress={() => void onManage()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={COPY_BILLING_MANAGE_CTA}
            style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
          >
            {busy ? (
              <ActivityIndicator color={colors.ctaText} />
            ) : (
              <>
                <Text style={styles.ctaText}>{COPY_BILLING_MANAGE_CTA}</Text>
                <Feather name="external-link" size={15} color={colors.ctaText} />
              </>
            )}
          </Pressable>
          {/* Say where the button goes before it is pressed. The destination is
              another company's screen, which is a surprise worth defusing. */}
          <Text style={styles.ctaNote}>{manageNote}</Text>
        </View>
      )}

      {canRefund && (
        <Pressable
          onPress={() => void onRefund()}
          disabled={refunding}
          accessibilityRole="button"
          accessibilityLabel={COPY_BILLING_REFUND_CTA}
          style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
        >
          {refunding ? (
            <ActivityIndicator color={colors.textSecondary} />
          ) : (
            <Text style={styles.secondaryText}>{COPY_BILLING_REFUND_CTA}</Text>
          )}
        </Pressable>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  loading: { paddingVertical: spacing.xl * 2, alignItems: 'center' },
  section: { gap: spacing.sm },
  alert: {
    backgroundColor: colors.warningSurface,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  alertHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
  alertTitle: { ...typography.label, fontSize: 14, color: colors.warning },
  alertBody: { ...typography.meta, color: colors.textSecondary, lineHeight: 18 },
  notice: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  noticeText: { ...typography.meta, color: colors.textSecondary, lineHeight: 18 },
  emptyCard: { padding: spacing.md },
  emptyText: { ...typography.meta, color: colors.textSecondary, lineHeight: 19 },
  planHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    gap: spacing.sm,
  },
  planName: { fontFamily: fontFamily.display, fontSize: 17, color: colors.textPrimary, flexShrink: 1 },
  badge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeText: { ...typography.eyebrow, color: colors.textSecondary },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    gap: spacing.md,
  },
  infoLabel: { ...typography.meta, color: colors.textSecondary },
  infoValue: { ...typography.label, fontSize: 14, color: colors.textPrimary, flexShrink: 1 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.ctaBackground,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    minHeight: 50,
  },
  ctaText: { ...typography.label, fontSize: 15, color: colors.ctaText },
  ctaNote: {
    ...typography.meta,
    color: colors.textFaint,
    textAlign: 'center',
    lineHeight: 17,
    paddingHorizontal: spacing.md,
  },
  secondary: { alignItems: 'center', paddingVertical: spacing.sm + 2, minHeight: 40 },
  secondaryText: { ...typography.meta, color: colors.textSecondary, textDecorationLine: 'underline' },
}));
