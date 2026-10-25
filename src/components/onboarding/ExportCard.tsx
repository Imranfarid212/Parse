/**
 * ExportCard — the THIRD onboarding receipt, and the one the "Let's go" button
 * sits under, so it closes on the payoff rather than another setup step.
 *
 * Two formats, because two is what the app has: ExportScreen states it as a
 * product rule — Excel and PDF, no CSV — so the card alternates between
 * exactly those and names them as that screen does.
 *
 * The motion deliberately rhymes with card 2: receipts travel DOWN into
 * something. There the destination was the folder, here it is the file.
 */
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { ReceiptFooter } from '@/components/ui/receiptTheme';
import { usePaper } from '@/theme/appearance';
import { fontFamily } from '@/theme/tokens';

/** No header on this card: 432.6 + 88.4 = 521, the body ReceiptCard gives its
 *  children. The headline carries the top instead of an eyebrow. */
const DESIGN_W = 340;
export const EXPORT_CARD_BODY_U = 432.6;

const GREEN = '#0e7043';
const GREEN_TINT = '#ECF5F0';
const RED = '#B42318'; // colors.danger — the hue ExportScreen gives the PDF segment
const RED_TINT = '#FEF3F2';

const WINDOW_U = 271;
const FILE_W_U = 210;
const FILE_H_U = 184;
const SLIP_W_U = 52;
const SLIP_H_U = 65;
const SLIP_FROM_U = -17;
const SLIP_TO_U = 91;

const SLIP_MS = 2400;
const SLIP_STAGGER_MS = 800;
const FORMAT_MS = 6000;

/** One falling receipt. Three of these, staggered, so something is always in
 *  flight — a single burst followed by four dead seconds read as broken. */
function Slip({ s, left, delay, active }: { s: number; left: number; delay: number; active: boolean }) {
  const paper = usePaper();
  const p = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      cancelAnimation(p);
      p.value = 0;
      return;
    }
    p.value = withDelay(delay, withRepeat(withTiming(1, { duration: SLIP_MS, easing: Easing.in(Easing.quad) }), -1, false));
    return () => cancelAnimation(p);
  }, [active, delay, p]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(p.value, [0, 1], [SLIP_FROM_U * s, SLIP_TO_U * s]) },
      { rotate: `${interpolate(p.value, [0, 1], [-3, 3])}deg` },
    ],
    opacity: interpolate(p.value, [0, 0.14, 0.72, 1], [0, 1, 1, 0], 'clamp'),
  }));

  const bar = (w: `${number}%`, mb: number) => (
    <View style={{ width: w, height: 4 * s, borderRadius: 2 * s, backgroundColor: paper.rule, marginBottom: mb * s }} />
  );

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: 0,
          left: left * s,
          width: SLIP_W_U * s,
          height: SLIP_H_U * s,
          borderRadius: 6 * s,
          backgroundColor: paper.body,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: paper.rule,
          paddingHorizontal: 6 * s,
          paddingTop: 7 * s,
        },
        style,
      ]}
    >
      <View style={{ alignItems: 'center' }}>{bar('70%', 5)}</View>
      {bar('100%', 4)}
      {bar('82%', 4)}
      {bar('58%', 0)}
    </Animated.View>
  );
}

export function ExportCard({ s, active }: { s: number; active: boolean }) {
  const paper = usePaper();
  const fmt = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      cancelAnimation(fmt);
      fmt.value = 0;
      return;
    }
    fmt.value = withRepeat(withTiming(1, { duration: FORMAT_MS, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(fmt);
  }, [active, fmt]);

  // One clock drives both faces and the pill, so the download can never pulse
  // for a format that is already fading out.
  const pdfStyle = useAnimatedStyle(() => ({
    opacity: interpolate(fmt.value, [0, 0.42, 0.52, 0.94, 1], [1, 1, 0, 0, 1], 'clamp'),
  }));
  const xlsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(fmt.value, [0, 0.42, 0.52, 0.94, 1], [0, 0, 1, 1, 0], 'clamp'),
  }));
  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(fmt.value, [0, 0.38, 0.46, 0.54, 1], [1, 1, 1.06, 1, 1], 'clamp') }],
  }));

  const face = (tint: string, ink: string, icon: 'file-text' | 'grid', label: string, body: React.ReactNode) => (
    <View style={styles.face}>
      <View style={{ width: 44 * s, height: 44 * s, borderRadius: 12 * s, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name={icon} size={23} color={ink} />
      </View>
      <Text style={{ fontFamily: fontFamily.semibold, fontSize: 15, color: paper.inkStrong, marginTop: 9 * s }}>{label}</Text>
      <View style={{ marginTop: 9 * s }}>{body}</View>
    </View>
  );

  const line = (w: number | `${number}%`, mb = 0) => (
    <View style={{ width: w, height: 8 * s, borderRadius: 4 * s, backgroundColor: paper.rule, marginBottom: mb * s }} />
  );

  return (
    <>
      <View style={{ height: EXPORT_CARD_BODY_U * s, alignItems: 'center', paddingTop: 30 * s, paddingHorizontal: 22 * s }}>
      <Text style={{ fontFamily: fontFamily.semibold, fontSize: 19, lineHeight: 25, color: paper.inkStrong, textAlign: 'center' }}>
        A year of receipts.{'\n'}One file.
      </Text>

      <View style={{ width: '100%', height: WINDOW_U * s, marginTop: 15 * s, overflow: 'hidden' }}>
        <Slip s={s} left={18} delay={0} active={active} />
        <Slip s={s} left={111} delay={SLIP_STAGGER_MS} active={active} />
        <Slip s={s} left={204} delay={SLIP_STAGGER_MS * 2} active={active} />

        <View
          style={{
            position: 'absolute',
            bottom: 0,
            left: 38 * s,
            width: FILE_W_U * s,
            height: FILE_H_U * s,
            borderRadius: 13 * s,
            backgroundColor: paper.body,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: paper.rule,
            overflow: 'hidden',
          }}
        >
          <Animated.View style={[StyleSheet.absoluteFill, pdfStyle]}>
            {face(RED_TINT, RED, 'file-text', 'PDF report', (
              <View style={{ width: 120 * s }}>
                {line('100%', 6)}
                {line('76%', 6)}
                {line('90%')}
              </View>
            ))}
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, xlsStyle]}>
            {face(GREEN_TINT, GREEN, 'grid', 'Excel sheet', (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: 118 * s, gap: 5 * s }}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <View key={i} style={{ width: 36 * s, height: 8 * s, borderRadius: 4 * s, backgroundColor: paper.rule }} />
                ))}
              </View>
            ))}
          </Animated.View>
        </View>
      </View>

      {/* Green, and smaller than it first was: black is reserved for "Let's go"
          directly below this card, and two dark pills made the wrong one look
          like the action. primitives.tsx states the rule — selection is forest,
          a primary action is the dark pill, and they are never swapped. */}
      <Animated.View
        style={[
          { flexDirection: 'row', alignItems: 'center', gap: 6 * s, backgroundColor: GREEN, borderRadius: 999, paddingHorizontal: 15 * s, paddingVertical: 8 * s, marginTop: 15 * s },
          pillStyle,
        ]}
      >
        <Feather name="download" size={14} color="#FFFFFF" />
        <Text style={{ fontFamily: fontFamily.semibold, fontSize: 13, color: '#FFFFFF' }}>Download</Text>
      </Animated.View>
      </View>

      <ReceiptFooter s={s} bandW={DESIGN_W * s} footerH={88.4 * s} />
    </>
  );
}

const styles = StyleSheet.create({
  face: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
