/**
 * Last line of defence for a render-phase crash.
 *
 * React unmounts the whole tree when a render throws, so without a boundary the
 * app becomes a blank screen — indistinguishable, to the person holding the
 * phone, from a freeze or a logout. Both previous incidents were reported as
 * "it just went back to the login page", which is precisely the kind of
 * description a blank screen produces.
 *
 * So the fallback's job is not to apologise. It is to display a support code
 * short enough to read out over a phone call, and to offer one retry.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Application from 'expo-application';

import { getCachedSupportCode, logSafeError, trackAnonymousBreadcrumb } from '@/lib/monitoring';
import { makeStyles, useColors } from '@/theme/appearance';
import { spacing, typography } from '@/theme/tokens';

function ErrorFallback({ onRetry }: { onRetry: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  // Synchronous by necessity: there is no awaiting inside a fallback render.
  // `initMonitoring` resolves this within milliseconds of launch, so a null here
  // means the crash happened during startup itself.
  const code = getCachedSupportCode();
  const version = Application.nativeApplicationVersion ?? '—';
  const build = Application.nativeBuildVersion ?? '—';

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.body}>
        Parse hit an unexpected error. Your receipts are saved on this device and nothing has been lost.
      </Text>

      {code ? (
        <View style={styles.codeBlock}>
          <Text style={styles.codeLabel}>Support code</Text>
          <Text style={styles.code} selectable accessibilityLabel={`Support code ${code.split('').join(' ')}`}>
            {code}
          </Text>
          <Text style={styles.codeHint}>Quote this if you contact us. It identifies this install, not you.</Text>
        </View>
      ) : null}

      <Pressable
        style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
        onPress={onRetry}
        accessibilityRole="button"
      >
        <Text style={styles.primaryText}>Try again</Text>
      </Pressable>

      <Text style={styles.meta} selectable>
        Version {version} ({build})
      </Text>
      {/* colors is read so the fallback re-renders on a theme change like every
          other screen; without it a crash in dark mode could render light. */}
      <View style={{ height: 0, backgroundColor: colors.background }} />
    </View>
  );
}

type Props = { children: React.ReactNode };
type State = { hasError: boolean };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logSafeError(error, 'react.render');
    // The component stack is the single most useful artefact here, and it is
    // structural — component names, no props and no values — but it still goes
    // through the sanitiser, because "no values" is an assumption about React
    // rather than a guarantee we control.
    trackAnonymousBreadcrumb(`react.stack ${info.componentStack ?? 'unavailable'}`);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return <ErrorFallback onRetry={() => this.setState({ hasError: false })} />;
  }
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.background,
  },
  title: {
    fontFamily: typography.display.fontFamily,
    fontSize: 26,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    fontFamily: typography.subtitle.fontFamily,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  codeBlock: {
    marginTop: spacing.lg,
    alignItems: 'center',
    alignSelf: 'stretch',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    backgroundColor: colors.surface ?? colors.background,
    borderWidth: 1,
    borderColor: colors.border ?? colors.textSecondary,
  },
  codeLabel: {
    fontFamily: typography.button.fontFamily,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  code: {
    fontFamily: typography.display.fontFamily,
    fontSize: 32,
    letterSpacing: 4,
    color: colors.textPrimary,
    marginTop: 2,
  },
  codeHint: {
    fontFamily: typography.subtitle.fontFamily,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs ?? 4,
  },
  primary: {
    marginTop: spacing.lg,
    minWidth: 220,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ctaBackground,
    borderRadius: 6,
  },
  primaryText: { fontFamily: typography.button.fontFamily, fontSize: 16, color: colors.ctaText },
  pressed: { opacity: 0.7 },
  meta: {
    fontFamily: typography.subtitle.fontFamily,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: spacing.lg,
  },
}));
