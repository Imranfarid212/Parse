import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { checkSupabaseHealth, type SupabaseHealthResult } from '@/lib/foundations/supabaseHealth';
import { colors, fontFamily, radius, spacing, typography } from '@/theme/tokens';

type HealthState = { status: 'loading' } | { status: 'done'; result: SupabaseHealthResult };

export default function HealthScreen() {
  const router = useRouter();
  const [state, setState] = useState<HealthState>({ status: 'loading' });

  const runCheck = useCallback(async () => {
    setState({ status: 'loading' });
    const result = await checkSupabaseHealth();
    setState({ status: 'done', result });
  }, []);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  const result = state.status === 'done' ? state.result : null;

  return (
    <View style={styles.screen} testID="b1-health-screen">
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="dark" />

      <View style={styles.header}>
        <Text style={styles.eyebrow}>B1 Foundations</Text>
        <Text style={styles.title}>Health Check</Text>
        <Text style={styles.subtitle}>Expo shell, environment, and Supabase anon REST round-trip.</Text>
      </View>

      <View style={styles.panel}>
        {state.status === 'loading' ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.body}>Checking Supabase...</Text>
          </View>
        ) : (
          <>
            <Text style={[styles.result, result?.ok ? styles.pass : styles.fail]}>
              {result?.ok ? 'READY' : 'ACTION NEEDED'}
            </Text>
            <Text style={styles.body}>{result?.ok ? 'Supabase responded with the anon key.' : result?.reason}</Text>
            <View style={styles.metaGrid}>
              <Meta label="Environment" value={result?.environment ?? 'local'} />
              <Meta label="Mock backend" value={result?.mockBackend ? 'on' : 'off'} />
              <Meta label="HTTP status" value={result?.status ? String(result.status) : 'n/a'} />
              <Meta label="Latency" value={result?.durationMs ? `${result.durationMs} ms` : 'n/a'} />
            </View>
          </>
        )}
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.primaryButton} onPress={runCheck} testID="b1-health-retry">
          <Text style={styles.primaryButtonText}>Retry</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
          <Text style={styles.secondaryButtonText}>Back</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.meta}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  header: { gap: spacing.xs },
  eyebrow: {
    color: colors.accent,
    fontFamily: fontFamily.semibold,
    fontSize: 13,
    textTransform: 'uppercase',
  },
  title: { ...typography.display, fontSize: 34, lineHeight: 38, color: colors.textPrimary },
  subtitle: { ...typography.subtitle, color: colors.textSecondary },
  panel: {
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: '#fff',
    padding: spacing.lg,
  },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  result: { fontFamily: fontFamily.display, fontSize: 18 },
  pass: { color: '#137A4B' },
  fail: { color: '#B42318' },
  body: { ...typography.subtitle, fontSize: 15, lineHeight: 21, color: colors.textPrimary },
  metaGrid: { gap: spacing.sm },
  meta: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  metaLabel: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: 13 },
  metaValue: { color: colors.textPrimary, fontFamily: fontFamily.semibold, fontSize: 13 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  primaryButton: {
    flex: 1,
    alignItems: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
  },
  primaryButtonText: { color: '#fff', fontFamily: fontFamily.semibold },
  secondaryButton: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
  },
  secondaryButtonText: { color: colors.textPrimary, fontFamily: fontFamily.semibold },
});
