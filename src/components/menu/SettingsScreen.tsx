/**
 * SettingsScreen — the Settings tab content.
 * Profile card, then Preferences / Finance / Support / Account sections, each a
 * white Card of Rows. Renders into MenuPanel's content area (MenuPanel owns the
 * "Settings" title + close).
 */
import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { DeleteAccountScreen } from '@/components/menu/DeleteAccountScreen';
import { Card, Divider, Eyebrow, Row, Toggle } from '@/components/menu/primitives';
import { useAuth } from '@/lib/auth/auth-context';
import { colors, fontFamily, radius, spacing, typography } from '@/theme/tokens';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Eyebrow style={{ marginLeft: spacing.sm }}>{title}</Eyebrow>
      <Card>{children}</Card>
    </View>
  );
}

export function SettingsScreen() {
  const auth = useAuth();
  const [darkMode, setDarkMode] = useState(false);
  const [push, setPush] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // Deletion is an interstitial, not a dialog: Blueprint §13.2 requires the
  // billing warning and both manage-subscription links to be READ before the
  // destructive action is reachable, which an alert cannot carry.
  const [deleting, setDeleting] = useState(false);
  const email = auth.user?.email ?? 'Signed in';
  const displayName = auth.user?.user_metadata?.full_name ?? email.split('@')[0] ?? 'Parse user';

  const logOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await auth.signOut();
    } finally {
      setSigningOut(false);
    }
  };

  if (deleting) return <DeleteAccountScreen onCancel={() => setDeleting(false)} />;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Profile */}
      <Card style={styles.profile}>
        <View style={styles.avatar}>
          <Feather name="user" size={24} color={colors.textSecondary} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={styles.name}>{displayName}</Text>
          <Text numberOfLines={1} style={styles.email}>{email}</Text>
        </View>
        <View style={styles.editBtn}>
          <Text style={styles.editText}>Edit</Text>
        </View>
      </Card>

      <Section title="Preferences">
        <Row icon="dollar-sign" label="Default Currency" value={auth.profile?.default_currency ?? 'USD'} onPress={() => {}} />
        <Divider />
        <Row icon="tag" label="Categories" value={`${auth.selectedCategoryIds.length} active`} onPress={() => {}} />
        <Divider />
        <Row icon="moon" label="Dark Mode" right={<Toggle label="Dark Mode" value={darkMode} onValueChange={setDarkMode} />} />
        <Divider />
        <Row icon="bell" label="Push Notifications" right={<Toggle label="Push Notifications" value={push} onValueChange={setPush} />} />
      </Section>

      <Section title="Finance">
        <Row
          icon="credit-card"
          iconColor={colors.info}
          iconBg={colors.infoSurface}
          label="Connected Cards"
          value="2 active"
          onPress={() => {}}
        />
      </Section>

      <Section title="Support">
        <Row icon="help-circle" label="Help Center" onPress={() => {}} />
        <Divider />
        <Row icon="alert-circle" label="Report a Bug" onPress={() => {}} />
        <Divider />
        <Row icon="info" label="About Us" onPress={() => {}} />
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

const styles = StyleSheet.create({
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
  },
  name: { fontFamily: fontFamily.display, fontSize: 17, color: colors.textPrimary },
  email: { ...typography.meta, color: colors.textSecondary, marginTop: 2 },
  editBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  editText: { ...typography.eyebrow, color: colors.textPrimary },
  version: { ...typography.eyebrow, color: colors.textFaint, textAlign: 'center', marginTop: spacing.xs },
});
