import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import * as Network from 'expo-network';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { MenuPanel } from '@/components/MenuPanel';
import { ReceiptReview } from '@/components/receipt/ReceiptReview';
import { RecentsFolder } from '@/components/receipt/RecentsFolder';
import { TOAST_REFERRAL_PROMPT, useAuth } from '@/lib/auth/auth-context';
import { markReferralPromptSeen, shouldShowReferralPrompt } from '@/lib/auth/referralPrompt';
import { confirm, processCapture, retryPending } from '@/lib/receipts/capture';
import * as store from '@/lib/receipts/store';
import type { ReceiptFields } from '@/lib/receipts/types';
import { EMPHASIZED, EMPHASIZED_SETTLE, FOLDER_IN_MS, FOLDER_OUT_MS } from '@/theme/motion';
import { colors, fontFamily, radius, spacing } from '@/theme/tokens';

type Mode = 'default' | 'oneclick';

/**
 * Post-shutter phases.
 *  idle       — live camera
 *  review     — Default: frozen frame + card (loading → fields)
 *  processing — /extract never landed; the image is queued and will retry
 */
type Phase =
  | { k: 'idle' }
  | { k: 'review'; photoUri: string; rowId: string | null; fields: ReceiptFields | null; loading: boolean }
  | { k: 'processing' };

const FOLDER_W = 82;

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <View style={styles.toggle}>
      {(['default', 'oneclick'] as const).map((m) => {
        const active = mode === m;
        return (
          <Pressable key={m} onPress={() => onChange(m)} style={[styles.toggleSeg, active && styles.toggleSegActive]}>
            <Text style={[styles.toggleText, active && styles.toggleTextActive]}>
              {m === 'default' ? 'Default' : 'One click'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function CameraScreen() {
  const router = useRouter();
  const auth = useAuth();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>('default');
  const [menuOpen, setMenuOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ k: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  const menuProgress = useSharedValue(0);

  // One-click's folder: slides in when the mode is chosen and stays; the
  // digest pop fires each time a scan lands.
  const digest = useSharedValue(1);
  const folderIn = useSharedValue(0);
  const abortRef = useRef<AbortController | null>(null);
  const referralPromptChecked = useRef(false);

  const folderTop = insets.top + spacing.sm;
  // Parked just past the left edge, at its resting height — it slides straight
  // in, left to right.
  const folderOffX = -(spacing.lg + FOLDER_W + 12);

  // In on One-click, out on Default — same motion either way.
  useEffect(() => {
    const show = mode === 'oneclick';
    folderIn.value = withTiming(show ? 1 : 0, {
      duration: show ? FOLDER_IN_MS : FOLDER_OUT_MS,
      easing: EMPHASIZED,
    });
  }, [mode, folderIn]);

  // Retry queued scans whenever the network comes back — this is what makes
  // "Your receipt is being processed" true rather than a green check over a
  // dropped receipt.
  useEffect(() => {
    const sub = Network.addNetworkStateListener((s) => {
      if (s.isInternetReachable) void retryPending();
    });
    void retryPending();
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (auth.loading) return;
    if (!auth.session) {
      router.replace('/');
      return;
    }
    if (auth.profile && !auth.profile.onboarding_complete) router.replace('/onboarding' as Href);
  }, [auth.loading, auth.profile, auth.session, router]);

  const openMenu = () => {
    setMenuOpen(true);
    menuProgress.value = withTiming(1, { duration: 620, easing: EMPHASIZED_SETTLE });
  };
  const closeMenu = () => {
    menuProgress.value = withTiming(0, { duration: 560, easing: EMPHASIZED_SETTLE }, (f) => {
      if (f) runOnJS(setMenuOpen)(false);
    });
  };

  // Slide the whole [camera | menu] strip left as the menu opens.
  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -width * menuProgress.value }] }));
  const folderStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(folderIn.value, [0, 1], [folderOffX, 0]) },
      { scale: digest.value },
    ],
  }));

  const flashNotice = useCallback((msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 2200);
  }, []);

  useEffect(() => {
    const userId = auth.user?.id;
    if (!userId || referralPromptChecked.current || !auth.profile?.onboarding_complete) return;
    const promptUserId = userId;
    referralPromptChecked.current = true;

    async function showOnce() {
      if (await shouldShowReferralPrompt(promptUserId)) {
        flashNotice(TOAST_REFERRAL_PROMPT);
        await markReferralPromptSeen(promptUserId);
      }
    }

    void showOnce();
  }, [auth.profile?.onboarding_complete, auth.user?.id, flashNotice]);

  /** Shrink, overshoot, settle — the folder "digesting" a scan. */
  const popFolder = useCallback(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    digest.value = withSequence(
      withTiming(0.9, { duration: 110 }),
      withTiming(1.12, { duration: 170 }),
      withSpring(1, { damping: 9, stiffness: 220 }),
    );
  }, [digest]);

  const showProcessing = useCallback(() => {
    setPhase({ k: 'processing' });
    setTimeout(() => setPhase({ k: 'idle' }), 1800);
  }, []);

  const onCapture = async () => {
    if (!cameraRef.current || busy) return;
    try {
      setBusy(true);
      const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (!photo?.uri) return;

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      if (mode === 'default') {
        // Card appears immediately as a skeleton; fields fill in when they land.
        setPhase({ k: 'review', photoUri: photo.uri, rowId: null, fields: null, loading: true });
        const out = await processCapture(photo.uri, ac.signal);

        if (out.kind === 'extracted') {
          setPhase({ k: 'review', photoUri: photo.uri, rowId: out.row.id, fields: out.fields, loading: false });
        } else if (out.kind === 'not_a_receipt') {
          setPhase({ k: 'idle' });
          flashNotice('Please scan only documents and receipts');
        } else {
          showProcessing();
        }
      } else {
        // One-click: no card. The folder digests it and you shoot again.
        const out = await processCapture(photo.uri, ac.signal);

        if (out.kind === 'extracted') {
          await confirm(out.row.id, out.fields);
          popFolder();
        } else if (out.kind === 'not_a_receipt') {
          flashNotice('Please scan only documents and receipts');
        } else {
          showProcessing();
        }
      }
    } catch (e) {
      console.warn('[capture] failed', e);
    } finally {
      setBusy(false);
    }
  };

  const onPickFromGallery = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (res.canceled || !res.assets[0]?.uri) return;
    const uri = res.assets[0].uri;

    setPhase({ k: 'review', photoUri: uri, rowId: null, fields: null, loading: true });
    const out = await processCapture(uri);
    if (out.kind === 'extracted') {
      setPhase({ k: 'review', photoUri: uri, rowId: out.row.id, fields: out.fields, loading: false });
    } else if (out.kind === 'not_a_receipt') {
      setPhase({ k: 'idle' });
      flashNotice('Please scan only documents and receipts');
    } else {
      showProcessing();
    }
  };

  /** Swipe-up. Optimistic: the local write lands, the flight already played. */
  const onConfirmed = useCallback(
    async (fields: ReceiptFields) => {
      if (phase.k === 'review' && phase.rowId) await confirm(phase.rowId, fields);
      setPhase({ k: 'idle' });
      popFolder();
    },
    [phase, popFolder],
  );

  /** Retake: cancel any in-flight extract and drop the row. */
  const onRetake = useCallback(async () => {
    abortRef.current?.abort();
    if (phase.k === 'review' && phase.rowId) await store.remove(phase.rowId);
    setPhase({ k: 'idle' });
  }, [phase]);

  const onFieldsChange = useCallback((fields: ReceiptFields) => {
    setPhase((prev) => (prev.k === 'review' ? { ...prev, fields } : prev));
  }, []);

  if (auth.loading) {
    return (
      <View style={styles.gate}>
        <StatusBar style="light" />
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={styles.gate}>
        <StatusBar style="light" />
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.gate}>
        <StatusBar style="light" />
        <Text style={styles.gateText}>Camera access is needed to scan receipts.</Text>
        <Pressable
          style={styles.gateBtn}
          onPress={permission.canAskAgain ? requestPermission : () => Linking.openSettings()}
        >
          <Text style={styles.gateBtnText}>{permission.canAskAgain ? 'Allow camera' : 'Open Settings'}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style={menuOpen ? 'dark' : 'light'} />

      <Animated.View style={[styles.strip, { width: width * 2 }, stripStyle]}>
        {/* ── Camera half ── */}
        <View style={{ width }}>
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" flash="auto" />

          {/* One-click's folder. Always mounted — it has to stay around to
              animate out when you switch to Default; it just parks off-screen.
              Default's own folder lives in the review overlay. */}
          <Animated.View style={[styles.folder, { left: spacing.lg, top: folderTop }, folderStyle]} pointerEvents="none">
            <RecentsFolder width={FOLDER_W} />
          </Animated.View>

          <Pressable style={[styles.menuCard, { top: insets.top + spacing.sm }]} onPress={openMenu}>
            <Ionicons name="menu" size={22} color="#fff" />
            <Text style={styles.menuLabel}>Menu</Text>
          </Pressable>

          <View style={styles.guideWrap} pointerEvents="none">
            <View style={styles.guide} />
          </View>

          <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.lg }]}>
            <Pressable style={[styles.capture, busy && styles.captureBusy]} onPress={onCapture} disabled={busy}>
              <View style={styles.captureInner} />
            </Pressable>

            <View style={styles.controlsRow}>
              <Pressable style={styles.sideBtn} onPress={onPickFromGallery} hitSlop={12}>
                <Ionicons name="images-outline" size={26} color="#fff" />
              </Pressable>

              <ModeToggle mode={mode} onChange={setMode} />

              <View style={styles.sideBtn} />
            </View>
          </View>

          {notice && (
            <View style={[styles.notice, { bottom: insets.bottom + 150 }]} pointerEvents="none">
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          )}
        </View>

        {/* ── Menu half ── */}
        <View style={{ width }}>{menuOpen && <MenuPanel onClose={closeMenu} />}</View>
      </Animated.View>

      {phase.k === 'review' && (
        <ReceiptReview
          photoUri={phase.photoUri}
          fields={phase.fields}
          loading={phase.loading}
          onConfirmed={onConfirmed}
          onRetake={onRetake}
          onFieldsChange={onFieldsChange}
        />
      )}

      {phase.k === 'processing' && (
        <View style={styles.processing}>
          <Text style={styles.processingText}>Your receipt is being processed</Text>
          <View style={styles.check}>
            <Feather name="check" size={22} color="#fff" />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  strip: { flexDirection: 'row', height: '100%' },

  gate: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
  gateText: { color: '#fff', fontSize: 16, textAlign: 'center' },
  gateBtn: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, backgroundColor: '#fff', borderRadius: radius.pill },
  gateBtnText: { color: '#000', fontWeight: '600' },

  folder: { position: 'absolute', zIndex: 6 },

  menuCard: {
    position: 'absolute',
    right: spacing.md,
    width: 56,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    gap: 2,
  },
  menuLabel: { color: '#fff', fontSize: 11 },

  guideWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  guide: { width: '70%', aspectRatio: 0.72, borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)', borderRadius: radius.md },

  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: spacing.lg },
  controlsRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
  },
  sideBtn: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  capture: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#fff',
  },
  captureBusy: { opacity: 0.5 },
  captureInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },

  toggle: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: radius.pill, padding: 3 },
  toggleSeg: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill },
  toggleSegActive: { backgroundColor: 'rgba(255,255,255,0.95)' },
  toggleText: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
  toggleTextActive: { color: '#111', fontWeight: '600' },

  notice: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  noticeText: { color: '#fff', fontFamily: fontFamily.semibold, fontSize: 13 },

  processing: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  processingText: { color: '#fff', fontFamily: fontFamily.semibold, fontSize: 17 },
  check: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
