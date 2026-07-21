/**
 * SettingsScreen — the Settings tab content (finance-app reference).
 * Profile card, then Preferences / Finance / Support / Account sections, each a
 * ringed white Card of Rows. Renders into MenuPanel's content area (MenuPanel
 * owns the "Settings" title + close).
 */
import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Card, Divider, Eyebrow, GRAY, Row, Toggle } from '@/components/menu/primitives';
import { useAuth } from '@/lib/auth/auth-context';
import { fontFamily, spacing } from '@/theme/tokens';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <Eyebrow style={{ marginLeft: 8 }}>{title}</Eyebrow>
      <Card>{children}</Card>
    </View>
  );
}

export function SettingsScreen() {
  const auth = useAuth();
  const [darkMode, setDarkMode] = useState(false);
  const [push, setPush] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
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

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Profile */}
      <Card style={styles.profile}>
        <View style={styles.avatar}>
          <Feather name="user" size={24} color={GRAY[500]} />
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
        <Row icon="moon" label="Dark Mode" right={<Toggle value={darkMode} onValueChange={setDarkMode} />} />
        <Divider />
        <Row icon="bell" label="Push Notifications" right={<Toggle value={push} onValueChange={setPush} />} />
      </Section>

      <Section title="Finance">
        <Row icon="credit-card" iconColor="#2563EB" iconBg="#EFF6FF" label="Connected Cards" value="2 active" onPress={() => {}} />
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
          iconColor="#EF4444"
          iconBg="#FEF2F2"
          label={signingOut ? 'Logging out' : 'Log Out'}
          labelColor="#EF4444"
          right={signingOut ? <ActivityIndicator color="#EF4444" /> : undefined}
          onPress={() => {
            void logOut();
          }}
        />
      </Section>

      <Text style={styles.version}>Version 1.0.4 (Build 402)</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 40, gap: 28 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: GRAY[100],
    borderWidth: 1,
    borderColor: GRAY[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontFamily: fontFamily.display, fontSize: 16, color: GRAY[900] },
  email: { fontFamily: fontFamily.semibold, fontSize: 13, color: GRAY[500], marginTop: 2 },
  editBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: GRAY[50],
    borderWidth: 1,
    borderColor: GRAY[200],
  },
  editText: { fontFamily: fontFamily.semibold, fontSize: 12, color: GRAY[900] },
  version: { fontFamily: fontFamily.semibold, fontSize: 12, color: GRAY[400], textAlign: 'center', marginTop: 4 },
});
