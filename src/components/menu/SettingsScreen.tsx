/**
 * SettingsScreen — the Settings tab content.
 * Profile card, then Preferences / Finance / Support / Account sections, each a
 * white Card of Rows. Renders into MenuPanel's content area. MenuPanel owns the
 * header, so opening a sub-screen (Default Currency / Categories / Billing /
 * About Us / Delete Account) is reported up through `onSubScreen` — that is
 * what retitles the bar and turns the X into a pop back to here.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';

import { AboutScreen } from '@/components/menu/AboutScreen';
import { BillingScreen } from '@/components/menu/BillingScreen';
import { CategoriesScreen } from '@/components/menu/CategoriesScreen';
import { CurrencyScreen } from '@/components/menu/CurrencyScreen';
import { DeleteAccountScreen } from '@/components/menu/DeleteAccountScreen';
import { Card, Divider, Eyebrow, Row, Toggle } from '@/components/menu/primitives';
import {
  COPY_BILLING_ROW_LABEL,
  COPY_BILLING_TITLE,
  COPY_DELETE_ACCOUNT_TITLE,
} from '@/../packages/contracts/src/copy';
import { useAuth } from '@/lib/auth/auth-context';
import { resolveIdentity } from '@/lib/auth/identity';
import { useEntitlements } from '@/lib/billing/entitlement-store';
import { buildSupportMailto } from '@/lib/support';
import { makeStyles, useAppAppearance, useColors } from '@/theme/appearance';
import { fontFamily, spacing, typography } from '@/theme/tokens';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Eyebrow style={{ marginLeft: spacing.sm }}>{title}</Eyebrow>
      <Card>{children}</Card>
    </View>
  );
}

/**
 * The circle on the profile card: the provider's picture, else initials, else
 * the generic glyph.
 *
 * The error fallback is not defensive padding. A Google avatar URL outlives the
 * picture it points at — removing the photo on the Google account leaves the
 * URL in our stored metadata, still well-formed and now a 404 — so the failure
 * shows up on accounts that once had a picture, not on broken ones.
 */
function ProfileAvatar({ uri, initials, name }: { uri: string | null; initials: string | null; name: string }) {
  const styles = useStyles();
  const colors = useColors();
  const [failed, setFailed] = useState(false);

  // Signing out and back in as someone else reuses this component; without the
  // reset a previous account's failure would suppress the new account's photo.
  useEffect(() => setFailed(false), [uri]);

  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        style={styles.avatar}
        contentFit="cover"
        transition={150}
        accessibilityLabel={`${name}'s profile picture`}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <View style={styles.avatar}>
      {initials ? (
        // Decorative: the name it abbreviates is read out by the Text beside it.
        <Text style={styles.initials} numberOfLines={1} accessibilityElementsHidden importantForAccessibility="no">
          {initials}
        </Text>
      ) : (
        <Feather name="user" size={24} color={colors.textSecondary} />
      )}
    </View>
  );
}

/**
 * What Settings is currently showing instead of itself.
 *
 * Reported up to MenuPanel, which owns the header: it needs the title so the
 * bar stops saying "Settings" over a screen that is not Settings, and it needs
 * `onBack` so the X pops back here rather than closing the whole menu out to
 * the camera — a sub-screen the user opened two taps deep should not exit the
 * menu entirely on the first tap out.
 */
export type SettingsSubScreen = { title: string; onBack: () => void };

export function SettingsScreen({ onSubScreen }: { onSubScreen?: (s: SettingsSubScreen | null) => void }) {
  const auth = useAuth();
  const styles = useStyles();
  const colors = useColors();
  const { isDark, setMode } = useAppAppearance();
  const [signingOut, setSigningOut] = useState(false);
  // Deletion is an interstitial, not a dialog: Blueprint §13.2 requires the
  // billing warning and both manage-subscription links to be READ before the
  // destructive action is reachable, which an alert cannot carry.
  const [deleting, setDeleting] = useState(false);
  // Same interstitial pattern as deletion — see DeleteAccountScreen.
  const [about, setAbout] = useState(false);
  const [billing, setBilling] = useState(false);
  const [categories, setCategories] = useState(false);
  const [currency, setCurrency] = useState(false);
  const entitlements = useEntitlements();
  // The row's value is the one fact the store screen cannot tell them at a
  // glance, and it stays honest while the tier is still loading: no text beats
  // a wrong tier.
  const billingRowValue = entitlements.loading
    ? undefined
    : entitlements.tier === 'max'
      ? 'Max'
      : entitlements.tier === 'pro'
        ? 'Pro'
        : 'Free';
  /**
   * Excludes Miscellaneous. `complete_onboarding` always writes the system
   * category, so the raw length is one higher than anything the user chose —
   * "4 active" after picking three read like an off-by-one, and disagreed with
   * the "3 of 9" the Categories screen shows.
   */
  const chosenCategoryCount = auth.selectedCategoryIds.filter(
    (id) => !auth.categories.some((category) => category.id === id && category.is_system),
  ).length;
  // Name, email, picture and initials all come off the same provider metadata,
  // so they are resolved together rather than re-derived per field.
  const identity = useMemo(() => resolveIdentity(auth.user), [auth.user]);

  const logOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await auth.signOut();
    } finally {
      setSigningOut(false);
    }
  };

  // One closer for all three: the header X does not know which is open, and
  // clearing all of them is correct however it was reached.
  const closeSubScreen = useCallback(() => {
    setDeleting(false);
    setAbout(false);
    setBilling(false);
    setCategories(false);
    setCurrency(false);
  }, []);

  const subScreenTitle = billing
    ? COPY_BILLING_TITLE
    : currency
      ? 'Default Currency'
      : categories
        ? 'Categories'
        : about
          ? 'About Us'
          : deleting
            ? COPY_DELETE_ACCOUNT_TITLE
            : null;

  useEffect(() => {
    onSubScreen?.(subScreenTitle ? { title: subScreenTitle, onBack: closeSubScreen } : null);
  }, [subScreenTitle, closeSubScreen, onSubScreen]);

  // Switching tabs unmounts this screen with a sub-screen still open; without
  // this the header would keep its stale title over the Export tab.
  useEffect(() => () => onSubScreen?.(null), [onSubScreen]);

  if (deleting) return <DeleteAccountScreen onCancel={closeSubScreen} />;
  if (about) return <AboutScreen onBack={closeSubScreen} />;
  if (billing) return <BillingScreen />;
  if (categories) return <CategoriesScreen />;
  if (currency) return <CurrencyScreen />;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Profile. No Edit affordance: name, email and picture are all owned by the
          identity provider, so the only honest place to change them is the
          Google or Apple account itself. A button here could either do nothing
          or write a display name that the next sign-in silently overwrites. */}
      <Card style={styles.profile}>
        <ProfileAvatar uri={identity.avatarUrl} initials={identity.initials} name={identity.displayName} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={styles.name}>{identity.displayName}</Text>
          <Text numberOfLines={1} style={styles.email}>{identity.email}</Text>
        </View>
      </Card>

      <Section title="Preferences">
        <Row icon="dollar-sign" label="Default Currency" value={auth.profile?.default_currency ?? 'USD'} onPress={() => setCurrency(true)} />
        <Divider />
        <Row icon="tag" label="Categories" value={`${chosenCategoryCount} active`} onPress={() => setCategories(true)} />
        <Divider />
        <Row icon="moon" label="Dark Mode" right={<Toggle label="Dark Mode" value={isDark} onValueChange={(value) => setMode(value ? 'dark' : 'light')} />} />
      </Section>

      {/* This was "Connected Cards · 2 active" — a hardcoded literal under a
          Finance heading, asserting a fact about the user's payment methods
          that no code had ever checked. It could never become real: with in-app
          purchases the card belongs to the user's App Store or Play account and
          is never exposed to us, so there is no card to list, masked or
          otherwise. Billing shows what we genuinely know and routes to the
          store for everything else. */}
      <Section title="Finance">
        <Row
          icon="credit-card"
          iconColor={colors.info}
          iconBg={colors.infoSurface}
          label={COPY_BILLING_ROW_LABEL}
          value={billingRowValue}
          onPress={() => setBilling(true)}
        />
      </Section>

      {/* No Help Center row: an article library is a maintenance commitment,
          and a thin one costs more trust than it earns. Contact Support is
          deliberately not called "Report a Bug" — people with a question that
          isn't a bug don't tap a row that says bug, and those are exactly the
          people worth hearing from. */}
      <Section title="Support">
        <Row icon="mail" label="Contact Support" onPress={() => void Linking.openURL(buildSupportMailto(auth.user?.id))} />
        <Divider />
        <Row icon="info" label="About Us" onPress={() => setAbout(true)} />
      </Section>

      <Section title="Account Actions">
        <Row
          icon="log-out"
          iconColor={colors.danger}
          iconBg={colors.dangerSurface}
          label={signingOut ? 'Logging out' : 'Log Out'}
          labelColor={colors.danger}
          right={signingOut ? <ActivityIndicator color={colors.danger} /> : undefined}
          onPress={() => {
            void logOut();
          }}
        />
        <Divider />
        {/* Both stores require in-app account deletion to be reachable from the
            app itself, not only from a website. */}
        <Row
          icon="trash-2"
          iconColor={colors.danger}
          iconBg={colors.dangerSurface}
          label="Delete Account"
          labelColor={colors.danger}
          onPress={() => setDeleting(true)}
        />
      </Section>

      <Text style={styles.version}>Version 1.0.4 (Build 402)</Text>
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
  section: { gap: spacing.sm },
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    // Android clips a child to a rounded parent only when told to; without it
    // the photo renders as a square over the circle.
    overflow: 'hidden',
  },
  // Sized so two characters clear the 56pt circle at the largest text setting.
  initials: { fontFamily: fontFamily.display, fontSize: 20, lineHeight: 24, color: colors.textPrimary },
  name: { fontFamily: fontFamily.display, fontSize: 17, color: colors.textPrimary },
  email: { ...typography.meta, color: colors.textSecondary, marginTop: 2 },
  version: { ...typography.eyebrow, color: colors.textFaint, textAlign: 'center', marginTop: spacing.xs },
}));
