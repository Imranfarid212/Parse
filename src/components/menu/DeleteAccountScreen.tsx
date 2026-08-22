/**
 * DeleteAccountScreen — the pre-delete interstitial (Blueprint §13.2 / D17).
 *
 * This screen exists to say one thing the user would otherwise get wrong:
 * **deleting the account does not cancel the subscription.** The store owns
 * billing, the app cannot stop it, and a user who deletes their account
 * believing it stopped the charges will be billed again next month. Store
 * reviewers check for exactly this.
 *
 * Both manage-subscription links are offered, not just the current platform's:
 * someone can subscribe on an iPhone and delete from an Android tablet, and the
 * app cannot always know which store is charging them.
 *
 * Every string comes from contracts. None is retyped here — the gate asserts the
 * exact text, because "roughly this warning" is how compliance copy erodes.
 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import {
  COPY_DELETE_ACCOUNT_BILLING_WARNING,
  COPY_DELETE_ACCOUNT_BODY,
  COPY_DELETE_ACCOUNT_CANCEL,
  COPY_DELETE_ACCOUNT_CONFIRM,
  COPY_DELETE_ACCOUNT_FAILED,
  COPY_DELETE_ACCOUNT_MANAGE_PROMPT,
  COPY_DELETE_ACCOUNT_RETENTION,
  COPY_DELETE_ACCOUNT_TITLE,
  COPY_MANAGE_SUBSCRIPTION_APPLE,
  COPY_MANAGE_SUBSCRIPTION_GOOGLE,
} from '@/../packages/contracts/src/copy';
import { Card, Divider } from '@/components/menu/primitives';
import { useAuth } from '@/lib/auth/auth-context';
import { MANAGE_SUBSCRIPTION_URLS } from '@/lib/billing/config';
import { deleteAccount } from '@/lib/billing/delete-account';
import { makeStyles, useColors } from '@/theme/appearance';
import { fontFamily, radius, spacing, typography } from '@/theme/tokens';

function ManageRow({ label, url }: { label: string; url: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable style={styles.manageRow} onPress={() => void Linking.openURL(url)}>
      <Feather name="external-link" size={16} color={colors.textSecondary} />
      <Text style={styles.manageText}>{label}</Text>
    </Pressable>
  );
}

export function DeleteAccountScreen({ onCancel }: { onCancel: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const [busy, setBusy] = useState(false);

  const confirm = useCallback(() => {
    // A second, native confirmation. The interstitial explains; this one makes
    // the irreversible step deliberate rather than a mis-tap on a red button.
    Alert.alert(COPY_DELETE_ACCOUNT_TITLE, COPY_DELETE_ACCOUNT_BODY, [
      { text: COPY_DELETE_ACCOUNT_CANCEL, style: 'cancel' },
      {
        text: COPY_DELETE_ACCOUNT_CONFIRM,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(true);
            try {
              await deleteAccount();
              // The server has already revoked every session. Signing out
              // locally clears the cached session and lands on the auth screen;
              // without it the app holds a token for an account that is gone.
              await auth.signOut();
            } catch (error) {
              if (__DEV__) console.warn('[delete-account] failed', error);
              Alert.alert(COPY_DELETE_ACCOUNT_TITLE, COPY_DELETE_ACCOUNT_FAILED);
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  }, [auth]);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.warningCard}>
        <Feather name="alert-triangle" size={20} color={colors.danger} />
        <Text style={styles.warningText}>{COPY_DELETE_ACCOUNT_BILLING_WARNING}</Text>
      </View>

      <Card style={styles.manageCard}>
        <Text style={styles.managePrompt}>{COPY_DELETE_ACCOUNT_MANAGE_PROMPT}</Text>
        <ManageRow label={COPY_MANAGE_SUBSCRIPTION_APPLE} url={MANAGE_SUBSCRIPTION_URLS.apple} />
        <Divider />
        <ManageRow label={COPY_MANAGE_SUBSCRIPTION_GOOGLE} url={MANAGE_SUBSCRIPTION_URLS.google} />
      </Card>

      <Text style={styles.body}>{COPY_DELETE_ACCOUNT_BODY}</Text>
      <Text style={styles.retention}>{COPY_DELETE_ACCOUNT_RETENTION}</Text>

      <Pressable
        disabled={busy}
        onPress={confirm}
        style={({ pressed }) => [styles.deleteBtn, busy && styles.deleteBtnOff, pressed && { opacity: 0.9 }]}
      >
        {busy ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.deleteText}>{COPY_DELETE_ACCOUNT_CONFIRM}</Text>
        )}
      </Pressable>

      <Pressable disabled={busy} onPress={onCancel} style={styles.keepBtn}>
        <Text style={styles.keepText}>{COPY_DELETE_ACCOUNT_CANCEL}</Text>
      </Pressable>
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

  warningCard: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.dangerSurface,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  warningText: { ...typography.label, flex: 1, lineHeight: 19, color: colors.danger },

  manageCard: { padding: spacing.md, gap: spacing.xs },
  managePrompt: { ...typography.eyebrow, color: colors.textSecondary, marginBottom: spacing.sm },
  manageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, paddingVertical: spacing.sm + 4 },
  manageText: { ...typography.label, fontSize: 14, color: colors.textPrimary },

  body: { ...typography.meta, fontSize: 14, lineHeight: 21, color: colors.textSecondary },
  retention: { ...typography.eyebrow, fontFamily: fontFamily.regular, lineHeight: 18, color: colors.textFaint },

  deleteBtn: {
    height: 52,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  deleteBtnOff: { opacity: 0.6 },
  deleteText: { ...typography.label, fontSize: 15, color: colors.ctaText },

  keepBtn: { alignItems: 'center', paddingVertical: spacing.sm + 4 },
  keepText: { ...typography.label, fontSize: 14, color: colors.textSecondary },
}));
