/**
 * AboutScreen — the "About Us" interstitial, reached from Settings › Support.
 *
 * Follows DeleteAccountScreen's pattern: SettingsScreen early-returns this in
 * place of its own content and passes `onBack`, so MenuPanel keeps owning the
 * title and close affordance.
 *
 * What this screen is actually for: a receipt scanner holds people's financial
 * records, so the unspoken question behind "About Us" is not "who are you" but
 * "who has my receipts". That is why the team comes first, the data promise is
 * stated plainly, and a real reply address is the last thing on the page —
 * a two-person team can honestly promise a human answer, and that is the whole
 * advantage over the apps this competes with.
 *
 * The address comes from `lib/support` so this screen and the Settings row can
 * never drift apart.
 *
 * ⚠️ EVERY VALUE IN `ABOUT` BELOW IS A PLACEHOLDER. Fill them in before this
 * ships. Do not invent an origin story: the trust this page is built to earn is
 * exactly what a fabricated detail costs. `dataPromise` in particular must match
 * the privacy policy and the App Store privacy labels — Apple checks that.
 */
import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';

import { Card, Divider, Eyebrow } from '@/components/menu/primitives';
import { SUPPORT_EMAIL } from '@/lib/support';
import { colors, fontFamily, radius, spacing, typography } from '@/theme/tokens';

const ABOUT = {
  /** One line, no mission statement. Says who, immediately. */
  intro: 'Parse is made by two people — a brother and sister.',
  people: [
    { name: '[Your name]', title: 'Co-founder, product & design' },
    { name: "[Sister's name]", title: 'Co-founder, engineering' },
  ],
  /** The real reason. Concrete beats inspirational: a shoebox of receipts at
   *  tax time reads true, "we're passionate about fintech" does not. */
  why:
    '[The honest reason you started it — the shoebox of receipts at tax time, ' +
    'the small business, the expenses that never got claimed. Two or three ' +
    'sentences, plain language, no mission statement.]',
  dataPromise:
    'Your receipts stay yours. We do not sell your data, and we have no ' +
    'interest in a business model that would need us to.',
} as const;

function Person({ name, title }: { name: string; title: string }) {
  return (
    <View style={styles.person}>
      <View style={styles.avatar}>
        <Feather name="user" size={18} color={colors.textSecondary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.personName}>{name}</Text>
        {/* Titles wrap rather than truncate — "Co-founder, engineering &
            infrastructure" is a legitimate length and clipping it mid-word
            reads worse than a second line. */}
        <Text style={styles.personTitle}>{title}</Text>
      </View>
    </View>
  );
}

export function AboutScreen({ onBack }: { onBack: () => void }) {
  const version = Constants.expoConfig?.version ?? null;

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.intro}>{ABOUT.intro}</Text>

      <View style={styles.section}>
        <Eyebrow style={{ marginLeft: spacing.sm }}>The team</Eyebrow>
        <Card style={styles.teamCard}>
          {ABOUT.people.map((p, i) => (
            <React.Fragment key={p.name}>
              {i > 0 && <Divider inset={spacing.md + 40 + spacing.md} />}
              <Person name={p.name} title={p.title} />
            </React.Fragment>
          ))}
        </Card>
      </View>

      <View style={styles.section}>
        <Eyebrow style={{ marginLeft: spacing.sm }}>Why we built it</Eyebrow>
        <Card style={styles.proseCard}>
          <Text style={styles.prose}>{ABOUT.why}</Text>
        </Card>
      </View>

      <View style={styles.section}>
        <Eyebrow style={{ marginLeft: spacing.sm }}>Your data</Eyebrow>
        <Card style={styles.proseCard}>
          <Text style={styles.prose}>{ABOUT.dataPromise}</Text>
        </Card>
      </View>

      {/* The payoff line. On a two-person team the promise of a real reply is
          true, which is why it is worth making explicit. */}
      <Card style={styles.contactCard}>
        <Text style={styles.contactPrompt}>Something broken, or missing?</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Email us at ${SUPPORT_EMAIL}`}
          onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
          style={({ pressed }) => [styles.contactRow, pressed && { opacity: 0.7 }]}
        >
          <Feather name="mail" size={16} color={colors.textSecondary} />
          <Text style={styles.contactText}>{SUPPORT_EMAIL}</Text>
        </Pressable>
        <Text style={styles.contactNote}>It reaches us both.</Text>
      </Card>

      {version && <Text style={styles.version}>Parse {version}</Text>}

      <Pressable onPress={onBack} style={styles.backBtn} accessibilityRole="button">
        <Text style={styles.backText}>Back</Text>
      </Pressable>
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

  intro: { ...typography.subtitle, color: colors.textPrimary },

  section: { gap: spacing.sm },

  teamCard: { paddingVertical: spacing.xs },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personName: { ...typography.row, color: colors.textPrimary },
  personTitle: { ...typography.meta, color: colors.textSecondary, marginTop: 1 },

  proseCard: { padding: spacing.md },
  prose: { ...typography.meta, fontSize: 14, lineHeight: 21, color: colors.textSecondary },

  contactCard: { padding: spacing.md, gap: spacing.xs },
  contactPrompt: { ...typography.label, color: colors.textPrimary },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  contactText: { ...typography.label, fontSize: 14, color: colors.accent },
  contactNote: { ...typography.eyebrow, fontFamily: fontFamily.regular, color: colors.textFaint },

  version: { ...typography.eyebrow, fontFamily: fontFamily.regular, color: colors.textFaint, textAlign: 'center' },

  backBtn: {
    height: 52,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { ...typography.button, color: colors.textPrimary },
});
