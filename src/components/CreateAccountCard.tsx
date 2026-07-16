/**
 * CreateAccountCard — placeholder auth drawer: a floating frosted-glass sheet
 * holding just the three sign-up buttons. Every button calls onProceed
 * (→ onboarding). No real auth wired.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';

import { GoogleLogo } from '@/components/ui/GoogleLogo';
import { colors, palette, radius, spacing, typography } from '@/theme/tokens';

const BTN = palette.buttonDark;

export function CreateAccountCard({ onProceed }: { onProceed: () => void }) {
  return (
    // Outer wrapper carries the shadow (BlurView needs overflow:hidden, which clips shadows).
    <View style={styles.shadow}>
      <BlurView intensity={15} tint="light" style={styles.blur}>
        {/* Cool-grey tint over the frost (instead of pure white). */}
        <View style={styles.tintFill} pointerEvents="none" />

        <Text style={styles.title}>Your search ends here</Text>

        <Pressable style={({ pressed }) => [styles.btn, styles.dark, pressed && styles.pressed]} onPress={onProceed}>
          <GoogleLogo size={18} />
          <Text style={styles.labelLight}>Sign in with Google</Text>
        </Pressable>

        <Pressable style={({ pressed }) => [styles.btn, styles.white, pressed && styles.pressed]} onPress={onProceed}>
          <Ionicons name="logo-apple" size={20} color="#111" />
          <Text style={styles.labelDark}>Sign in with Apple</Text>
        </Pressable>

        <Pressable style={({ pressed }) => [styles.btn, styles.soft, pressed && styles.pressed]} onPress={onProceed}>
          <Feather name="mail" size={17} color="#111" />
          <Text style={styles.labelDark}>Use my email</Text>
        </Pressable>
      </BlurView>
    </View>
  );
}

const btnShadow = {
  shadowColor: '#000',
  shadowOpacity: 0.1,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 3 },
  elevation: 3,
};

const styles = StyleSheet.create({
  shadow: {
    alignSelf: 'stretch',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  tintFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(244,245,247,0.1)',
  },
  blur: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg + 6,
    gap: spacing.sm + 3,
  },

  title: {
    fontFamily: typography.display.fontFamily,
    fontSize: 20,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 50,
    borderRadius: radius.pill,
    ...btnShadow,
  },
  dark: { backgroundColor: BTN },
  white: { backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)' },
  soft: { backgroundColor: 'rgba(255,255,255,0.75)', borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  labelLight: { fontFamily: typography.button.fontFamily, fontSize: 15, color: '#fff' },
  labelDark: { fontFamily: typography.button.fontFamily, fontSize: 15, color: '#111' },

  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
