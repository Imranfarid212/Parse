import React, { useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { AnimatedGridBackground } from '@/components/ui/AnimatedGridBackground';
import { useAuth } from '@/lib/auth/auth-context';
import { colors, fontFamily, radius, spacing, typography } from '@/theme/tokens';

const OTP_LENGTH = 6;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeCode(value: string) {
  return value.replace(/\D/g, '').slice(0, OTP_LENGTH);
}

function getOtpErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.toLowerCase().includes('internal server error') || message.includes('"status":500')) {
    return 'The sign-in service had a temporary issue. Please try again.';
  }
  return error instanceof Error ? error.message : 'Please try again.';
}

export default function OtpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const requestCode = async () => {
    const nextEmail = normalizeEmail(email);
    if (!nextEmail.includes('@')) {
      Alert.alert('Email needed', 'Enter the email address you want to use for Parse.');
      return;
    }

    try {
      setBusy(true);
      await auth.signInWithOtp(nextEmail);
      setEmail(nextEmail);
      setCode('');
      setSent(true);
    } catch (error) {
      Alert.alert('Code not sent', getOtpErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    const nextCode = normalizeCode(code);
    if (nextCode.length < OTP_LENGTH) {
      Alert.alert('Code needed', `Enter the ${OTP_LENGTH}-digit code from your email.`);
      return;
    }

    try {
      Keyboard.dismiss();
      setBusy(true);
      const profile = await auth.verifyOtp(normalizeEmail(email), nextCode);
      router.replace((profile?.onboarding_complete ? '/camera' : '/welcome') as Href);
    } catch (error) {
      Alert.alert('Code not accepted', getOtpErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatedGridBackground>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.screen, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}
        testID="otp-screen"
      >
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={16}>
          <Feather name="arrow-left" size={22} color={colors.textPrimary} />
        </Pressable>

        <View style={styles.panel}>
          <Text style={styles.eyebrow}>EMAIL SIGN IN</Text>
          <Text style={styles.title}>{sent ? 'Check your inbox' : 'Start with email'}</Text>
          <Text style={styles.copy}>
            {sent ? `Enter the ${OTP_LENGTH}-digit code Supabase sent you.` : 'We will send a one-time code. No password to remember.'}
          </Text>

          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="you@company.com"
            editable={!busy && !sent}
            style={styles.input}
            testID="otp-email-input"
          />

          {sent && (
            <TextInput
              value={code}
              onChangeText={(value) => setCode(normalizeCode(value))}
              autoComplete="one-time-code"
              keyboardType="number-pad"
              placeholder="12345678"
              maxLength={OTP_LENGTH}
              editable={!busy}
              style={styles.input}
              testID="otp-code-input"
            />
          )}

          <Pressable
            onPress={sent ? verifyCode : requestCode}
            disabled={busy}
            style={({ pressed }) => [styles.cta, (pressed || busy) && styles.pressed]}
            testID={sent ? 'otp-verify-button' : 'otp-request-button'}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>{sent ? 'Verify code' : 'Send code'}</Text>}
          </Pressable>

          {sent && (
            <Pressable
              onPress={() => {
                setSent(false);
                setCode('');
              }}
              disabled={busy}
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>Use a different email or resend</Text>
            </Pressable>
          )}
        </View>
        {busy && <View style={styles.busyBlocker} pointerEvents="auto" />}
      </KeyboardAvoidingView>
    </AnimatedGridBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  back: { position: 'absolute', left: spacing.lg, top: spacing.xl, zIndex: 1 },
  panel: {
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    padding: spacing.lg,
    gap: spacing.md,
  },
  eyebrow: { color: colors.textFaint, fontFamily: fontFamily.semibold, fontSize: 12 },
  title: { ...typography.display, fontSize: 34, lineHeight: 38, color: colors.textPrimary },
  copy: { ...typography.subtitle, color: colors.textSecondary },
  input: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    paddingHorizontal: spacing.md,
    fontFamily: fontFamily.regular,
    fontSize: 16,
    color: colors.textPrimary,
  },
  cta: {
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.ctaBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { ...typography.button, color: colors.ctaText },
  secondary: { alignItems: 'center', paddingVertical: spacing.xs },
  secondaryText: { color: colors.textSecondary, fontFamily: fontFamily.semibold },
  pressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  busyBlocker: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 10 },
});
