import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { type Href, useIsFocused, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
  type CameraRef,
} from 'react-native-vision-camera';
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
import { TapToFocusLayer, useFocusReticle } from '@/components/camera/TapToFocus';
import { TrackingDebug, TrackingQuad, useDocumentTracking } from '@/components/camera/TrackingQuad';
import { RecentsFolder } from '@/components/receipt/RecentsFolder';
import { TOAST_REFERRAL_PROMPT, useAuth } from '@/lib/auth/auth-context';
import { markReferralPromptSeen, shouldShowReferralPrompt } from '@/lib/auth/referralPrompt';
import {
  confirm,
  flushCaptureMetrics,
  processCapture,
  retryPending,
  syncConfirmed,
  syncImageBackups,
  uploadCaptureMetrics,
  type CaptureOutcome,
  type PrecisePreflightWarning,
} from '@/lib/receipts/capture';
import { extractClient } from '@/lib/receipts/client';
import * as store from '@/lib/receipts/store';
import type { CaptureMode, DuplicateCandidate, ExtractionMode, LocalDuplicateCandidate, ReceiptFields } from '@/lib/receipts/types';
import { EMPHASIZED, EMPHASIZED_SETTLE, FOLDER_IN_MS, FOLDER_OUT_MS } from '@/theme/motion';
import { colors, fontFamily, radius, spacing } from '@/theme/tokens';

type Mode = 'default' | 'oneclick';
const PRECISE_SCREEN_VISIBLE_DEADLINE_MS = 4500;

function waitForVisibleDeadline(ms: number): Promise<'visible_deadline'> {
  return new Promise((resolve) => {
    setTimeout(() => resolve('visible_deadline'), ms);
  });
}

/**
 * Post-shutter phases.
 *  idle       — live camera
 *  review     — Default: frozen frame + card (loading → fields)
 *  processing — /extract never landed; the image is queued and will retry
 */
type Phase =
  | { k: 'idle' }
  | {
      k: 'review';
      photoUri: string;
      rowId: string | null;
      fields: ReceiptFields | null;
      loading: boolean;
      /**
       * When the shutter was pressed. The review card's entrance is choreo-
       * graphed against THIS, not against its own mount — capture + file write
       * sit between the two, so anchoring to mount would let the card drift
       * later on slower captures.
       */
      startedAt: number;
    }
  | { k: 'processing'; reason?: string };

const FOLDER_W = 82;

const toCaptureMode = (mode: Mode): CaptureMode => (mode === 'oneclick' ? 'one_click' : 'default');

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

function ExtractionModeToggle({
  mode,
  onChange,
}: {
  mode: ExtractionMode;
  onChange: (m: ExtractionMode) => void;
}) {
  return (
    <View style={styles.extractionToggle}>
      {(['balanced', 'precise'] as const).map((m) => {
        const active = mode === m;
        return (
          <Pressable key={m} onPress={() => onChange(m)} style={[styles.extractionSeg, active && styles.extractionSegActive]}>
            <Text style={[styles.extractionText, active && styles.extractionTextActive]}>
              {m === 'balanced' ? 'Balanced' : 'Precise'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function showNotReceiptAlert(message = 'This image does not look like a receipt, invoice, or bill.'): void {
  Alert.alert('Could not read a receipt', message, [{ text: 'OK' }]);
}

export default function CameraScreen() {
  const router = useRouter();
  const auth = useAuth();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { hasPermission, requestPermission, canRequestPermission } = useCameraPermission();
  const cameraRef = useRef<CameraRef>(null);
  const device = useCameraDevice('back');
  // Full quality — the receipt gets downscaled to ~1024px for /extract anyway,
  // so the only thing resolution buys us here is legible small print.
  const photoOutput = usePhotoOutput({ qualityPrioritization: 'quality' });
  // Live document tracking (iOS builds carrying the document-tracker plugin;
  // inert everywhere else — `output` is null and the static guide stays).
  const tracking = useDocumentTracking();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [mode, setMode] = useState<Mode>('default');
  const [extractionMode, setExtractionMode] = useState<ExtractionMode>('balanced');
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuInitialTab, setMenuInitialTab] = useState(0);
  const [phase, setPhase] = useState<Phase>({ k: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  const focus = useFocusReticle();
  const menuProgress = useSharedValue(0);

  // Camera lifecycle: run the sensor + Vision detection ONLY when it's actually
  // needed — this route focused, the app foregrounded, the menu closed, and no
  // capture in flight. Anything else stops the session, which is the single
  // biggest thermal win (an idle-but-live camera + ML is what cooks the phone).
  const isFocused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);
  /**
   * Set the moment a review swipe is confirmed, so the sensor comes back while
   * the card is still flying to the folder instead of after the animation ends.
   * Without this the frozen frame clears onto a stopped preview and the shutter
   * is dead until teardown — the session, not just detection, is gated below.
   *
   * Costs the tail of the flight (~1s) of camera time per confirmed scan. The
   * thermal win — sensor off through the whole read — is untouched.
   */
  const [wakeEarly, setWakeEarly] = useState(false);
  const cameraActive = isFocused && appActive && !menuOpen && (phase.k === 'idle' || wakeEarly);

  // One-click's folder: slides in when the mode is chosen and stays; the
  // digest pop fires each time a scan lands.
  const digest = useSharedValue(1);
  const folderIn = useSharedValue(0);
  const abortRef = useRef<AbortController | null>(null);
  const referralPromptChecked = useRef(false);
  const balancedWarmupAt = useRef(0);
  const preciseWarmupAt = useRef(0);

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
  const flushBackgroundQueues = useCallback(() => {
    if (busyRef.current) return;
    void retryPending();
    void syncConfirmed();
    void syncImageBackups();
    void flushCaptureMetrics();
  }, []);

  useEffect(() => {
    const sub = Network.addNetworkStateListener((s) => {
      if (s.isInternetReachable) flushBackgroundQueues();
    });
    flushBackgroundQueues();
    return () => sub.remove();
  }, [flushBackgroundQueues]);

  useEffect(() => {
    if (!isFocused || !appActive || !auth.session) return;
    const now = Date.now();
    if (extractionMode === 'balanced') {
      if (now - balancedWarmupAt.current < 30_000) return;
      balancedWarmupAt.current = now;
      extractClient.warmUpBalanced?.();
      return;
    }
    if (now - preciseWarmupAt.current < 30_000) return;
    preciseWarmupAt.current = now;
    extractClient.warmUpPrecise?.();
  }, [appActive, auth.session, extractionMode, isFocused]);

  useEffect(() => {
    if (auth.loading) return;
    if (!auth.session) {
      router.replace('/');
      return;
    }
    if (auth.profile && !auth.profile.onboarding_complete) router.replace('/onboarding' as Href);
  }, [auth.loading, auth.profile, auth.session, router]);

  const openMenu = (initialTab = 0) => {
    setMenuInitialTab(initialTab);
    setMenuOpen(true);
    menuProgress.value = withTiming(1, { duration: 620, easing: EMPHASIZED_SETTLE });
  };
  const openRecents = () => openMenu(1);
  const closeMenu = () => {
    menuProgress.value = withTiming(0, { duration: 560, easing: EMPHASIZED_SETTLE }, (f) => {
      if (f) runOnJS(setMenuOpen)(false);
    });
  };

  // Slide the whole [camera | menu] strip left as the menu opens.
  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -width * menuProgress.value }] }));
  const guideStyle = useAnimatedStyle(() => ({ opacity: 1 - tracking.shown.value }));
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

  const showProcessing = useCallback((reason?: string) => {
    setPhase({ k: 'processing', reason: __DEV__ ? reason : undefined });
    setTimeout(() => {
      setPhase((prev) => (prev.k === 'processing' ? { k: 'idle' } : prev));
    }, 1800);
  }, []);

  const showPreciseProcessingAlert = useCallback(() => {
    setPhase({ k: 'idle' });
    Alert.alert(
      'Receipt is being processed',
      "This receipt may take a little longer. We'll finish processing it in the background and it will appear in Recents when ready.",
      [{ text: 'OK' }],
    );
  }, []);

  const defaultCurrency = auth.profile?.default_currency ?? auth.bootstrapLocale.defaultCurrency;

  const showExistingLocalReceipt = useCallback((candidate: LocalDuplicateCandidate, fallbackPhotoUri: string, startedAt: number) => {
    setPhase({
      k: 'review',
      photoUri: candidate.matchedImageUri || fallbackPhotoUri,
      rowId: candidate.matchedLocalRowId,
      fields: candidate.fields,
      loading: false,
      startedAt,
    });
  }, []);

  const promptLocalDuplicateCandidate = useCallback(
    (candidate: LocalDuplicateCandidate, draft: ReceiptFields, fallbackPhotoUri: string, startedAt: number) =>
      new Promise<'view_existing' | 'save_anyway'>((resolve) => {
        let settled = false;
        const settle = (decision: 'view_existing' | 'save_anyway') => {
          if (settled) return;
          settled = true;
          resolve(decision);
        };
        setPhase({
          k: 'review',
          photoUri: fallbackPhotoUri,
          rowId: null,
          fields: draft,
          loading: false,
          startedAt,
        });
        const total =
          candidate.currency && typeof candidate.total === 'number'
            ? `${candidate.currency} ${candidate.total.toFixed(2)}`
            : 'the same total';
        setTimeout(() => {
          Alert.alert(
            'Possible duplicate',
            `This looks similar to a receipt already saved from ${candidate.merchant ?? 'this merchant'} for ${total}.`,
            [
              {
                text: 'View Existing',
                onPress: () => {
                  showExistingLocalReceipt(candidate, fallbackPhotoUri, startedAt);
                  settle('view_existing');
                },
              },
              {
                text: 'Save Anyway',
                style: 'cancel',
                onPress: () => settle('save_anyway'),
              },
            ],
            { cancelable: true, onDismiss: () => settle('save_anyway') },
          );
        }, 120);
      }),
    [showExistingLocalReceipt],
  );

  const promptPrecisePreflightWarning = useCallback(
    (warning: PrecisePreflightWarning) =>
      new Promise<'continue' | 'cancel'>((resolve) => {
        const detail =
          warning.confidence === 'low'
            ? 'We could not find enough receipt-like text or amounts in this image.'
            : 'This image has weak receipt signals, so extraction may be inaccurate.';
        Alert.alert(
          'This may not be a receipt',
          `${detail}\n\nContinue anyway if the receipt is handwritten, blurry, or unusual. Precise processing can take a little longer.`,
          [
            { text: 'Retake', style: 'cancel', onPress: () => resolve('cancel') },
            { text: 'Continue Anyway', onPress: () => resolve('continue') },
          ],
          { cancelable: true, onDismiss: () => resolve('cancel') },
        );
      }),
    [],
  );

  const showDuplicateCandidatePrompt = useCallback(
    (candidate: DuplicateCandidate | null | undefined, currentRowId: string, currentPhotoUri: string, startedAt: number) => {
      if (!candidate || candidate.matchStrength !== 'weak') return;
      const merchant = candidate.merchant ? `${candidate.merchant}` : 'this merchant';
      const total =
        candidate.currency && typeof candidate.total === 'number'
          ? `${candidate.currency} ${candidate.total.toFixed(2)}`
          : 'the same total';
      Alert.alert(
        'Possible duplicate',
        `This looks similar to a receipt already saved from ${merchant} for ${total}.`,
        [
          {
            text: 'View Existing',
            onPress: () => {
              void (async () => {
                await store.remove(currentRowId);
                const existing = await store.getByReceiptId(candidate.matchedReceiptId);
                if (existing?.fields) {
                  showExistingLocalReceipt(
                    {
                      ...candidate,
                      matchedLocalRowId: existing.id,
                      matchedImageUri: existing.imageUri,
                      fields: existing.fields,
                    },
                    currentPhotoUri,
                    startedAt,
                  );
                } else {
                  setPhase({ k: 'idle' });
                  flashNotice('Existing receipt is already saved');
                }
              })();
            },
          },
          { text: 'Save Anyway', style: 'cancel' },
        ],
        { cancelable: true },
      );
    },
    [flashNotice, showExistingLocalReceipt],
  );

  const handleDefaultCaptureOutcome = useCallback(
    (out: CaptureOutcome, photoUri: string, startedAt: number) => {
      if (out.kind === 'extracted') {
        if (out.row.extractionMode === 'precise') {
          setPhase((prev) => (prev.k === 'review' || prev.k === 'processing' ? { k: 'idle' } : prev));
          flashNotice('Receipt saved to Recents');
          return;
        }
        setPhase({ k: 'review', photoUri, rowId: out.row.id, fields: out.fields, loading: false, startedAt });
        uploadCaptureMetrics({
          captureId: out.row.id,
          receiptId: null,
          captureMode: out.row.captureMode,
          extractionMode: out.row.extractionMode,
          metrics: { ...out.metrics, total_to_ui_ms: out.metrics.total_to_response_ms },
          attempts: out.attempts,
        });
        showDuplicateCandidatePrompt(out.duplicateCandidate, out.row.id, photoUri, startedAt);
      } else if (out.kind === 'not_a_receipt') {
        setPhase({ k: 'idle' });
        showNotReceiptAlert();
      } else if (out.kind === 'duplicate') {
        setPhase({ k: 'idle' });
        flashNotice('This receipt is already saved');
      } else if (out.kind === 'local_duplicate') {
        // The prompt already opened the existing local receipt.
      } else if (out.kind === 'preflight_rejected') {
        setPhase({ k: 'idle' });
      } else {
        if (out.row.extractionMode !== 'precise') showProcessing(out.reason);
        if (out.deferred) {
          void out.deferred.then((finalOut) => {
            if (__DEV__) console.log('[camera] queued deferred outcome ready', { kind: finalOut.kind });
            handleDefaultCaptureOutcome(finalOut, photoUri, startedAt);
          });
        }
      }
    },
    [flashNotice, showDuplicateCandidatePrompt, showProcessing],
  );

  const handleOneClickCaptureOutcome = useCallback(
    (out: CaptureOutcome, photoUri: string, startedAt: number) => {
      if (out.kind === 'extracted') {
        void (async () => {
          await confirm(out.row.id, out.fields, auth.user?.id);
          uploadCaptureMetrics({
            captureId: out.row.id,
            receiptId: null,
            captureMode: out.row.captureMode,
            extractionMode: out.row.extractionMode,
            metrics: { ...out.metrics, total_to_ui_ms: out.metrics.total_to_response_ms },
            attempts: out.attempts,
          });
          showDuplicateCandidatePrompt(out.duplicateCandidate, out.row.id, photoUri, startedAt);
          setPhase({ k: 'idle' });
          popFolder();
          flashNotice('Receipt saved to Recents');
        })();
      } else if (out.kind === 'not_a_receipt') {
        setPhase({ k: 'idle' });
        showNotReceiptAlert();
      } else if (out.kind === 'duplicate') {
        setPhase({ k: 'idle' });
        flashNotice('This receipt is already saved');
      } else if (out.kind === 'local_duplicate') {
        // The prompt already opened the existing local receipt.
      } else if (out.kind === 'preflight_rejected') {
        setPhase({ k: 'idle' });
      } else {
        if (out.row.extractionMode !== 'precise') {
          showProcessing(out.reason);
          return;
        }
        setPhase({ k: 'idle' });
        if (out.deferred) {
          void out.deferred.then((finalOut) => {
            if (__DEV__) console.log('[camera] one-click precise deferred outcome ready', { kind: finalOut.kind });
            handleOneClickCaptureOutcome(finalOut, photoUri, startedAt);
          });
        }
      }
    },
    [auth.user?.id, flashNotice, popFolder, showDuplicateCandidatePrompt, showProcessing],
  );

  const onCapture = async () => {
    if (!cameraRef.current || busy) return;
    const startedAt = Date.now(); // the shutter moment — see Phase.startedAt
    try {
      setBusy(true);
      setWakeEarly(false); // a new scan re-arms the gate
      busyRef.current = true;
      if (extractionMode === 'precise') extractClient.warmUpPrecise?.();
      // VisionCamera hands back a native Photo object rather than a URI. Spill
      // it to a temp file for the pipeline, then dispose — the underlying
      // buffer is native memory and won't be reclaimed by GC.
      const captured = await photoOutput.capturePhoto({ flashMode: 'auto' }, {});
      const path = await captured.saveToTemporaryFileAsync();
      captured.dispose();
      const photo = { uri: path.startsWith('file://') ? path : `file://${path}` };
      if (!photo.uri) return;

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      if (mode === 'default') {
        if (extractionMode === 'balanced') {
          // Card appears immediately as a skeleton; fields fill in when they land.
          setPhase({ k: 'review', photoUri: photo.uri, rowId: null, fields: null, loading: true, startedAt });
        }
        const outPromise = processCapture(photo.uri, toCaptureMode(mode), extractionMode, {
          defaultCurrency,
          userId: auth.user?.id,
          signal: ac.signal,
          onDraft: (draft, meta) => {
            setPhase((prev) =>
              prev.k === 'review' && prev.loading
                ? { ...prev, rowId: meta.captureId, fields: draft, loading: true, startedAt }
                : prev,
            );
          },
          onLocalDuplicateCandidate: (candidate, draft) => promptLocalDuplicateCandidate(candidate, draft, photo.uri, startedAt),
          onPrecisePreflightWarning: promptPrecisePreflightWarning,
          onPrecisePreflightAccepted: showPreciseProcessingAlert,
        });
        const out =
          extractionMode === 'precise'
            ? await Promise.race([outPromise, waitForVisibleDeadline(PRECISE_SCREEN_VISIBLE_DEADLINE_MS)])
            : await outPromise;

        if (out === 'visible_deadline') {
          if (__DEV__) {
            console.warn('[camera] precise screen deadline reached; capture continues in background', {
              visibleDeadlineMs: PRECISE_SCREEN_VISIBLE_DEADLINE_MS,
            });
          }
          setPhase({ k: 'idle' });
          void outPromise
            .then((lateOut) => {
              if (__DEV__) console.log('[camera] precise background capture completed', { kind: lateOut.kind });
              if (lateOut.kind === 'queued' && lateOut.deferred) {
                void lateOut.deferred.then((finalOut) => {
                  if (__DEV__) console.log('[camera] precise deferred outcome ready', { kind: finalOut.kind });
                  handleDefaultCaptureOutcome(finalOut, photo.uri, startedAt);
                });
                return;
              }
              if (lateOut.kind !== 'queued') handleDefaultCaptureOutcome(lateOut, photo.uri, startedAt);
            })
            .catch((error) => {
              if (__DEV__) console.warn('[camera] precise background capture stayed queued', error instanceof Error ? error.message : String(error));
            });
          return;
        }
        handleDefaultCaptureOutcome(out, photo.uri, startedAt);
      } else {
        // One-click: no card. The folder digests it and you shoot again.
        const outPromise = processCapture(photo.uri, toCaptureMode(mode), extractionMode, {
          defaultCurrency,
          userId: auth.user?.id,
          signal: ac.signal,
          onLocalDuplicateCandidate: (candidate, draft) => promptLocalDuplicateCandidate(candidate, draft, photo.uri, startedAt),
          onPrecisePreflightWarning: promptPrecisePreflightWarning,
          onPrecisePreflightAccepted: showPreciseProcessingAlert,
        });
        const out =
          extractionMode === 'precise'
            ? await Promise.race([outPromise, waitForVisibleDeadline(PRECISE_SCREEN_VISIBLE_DEADLINE_MS)])
            : await outPromise;

        if (out === 'visible_deadline') {
          setPhase({ k: 'idle' });
          void outPromise
            .then((lateOut) => handleOneClickCaptureOutcome(lateOut, photo.uri, startedAt))
            .catch((error) => {
              if (__DEV__) console.warn('[camera] one-click precise background capture stayed queued', error instanceof Error ? error.message : String(error));
            });
          return;
        }
        handleOneClickCaptureOutcome(out, photo.uri, startedAt);
      }
    } catch (e) {
      console.warn('[capture] failed', e);
    } finally {
      busyRef.current = false;
      setBusy(false);
      setTimeout(flushBackgroundQueues, 600);
    }
  };

  const onPickFromGallery = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      flashNotice('Photo library access is needed to choose a receipt');
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (res.canceled || !res.assets[0]?.uri) return;
    const uri = res.assets[0].uri;

    const startedAt = Date.now();
    try {
      setBusy(true);
      busyRef.current = true;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      if (mode === 'default') {
        if (extractionMode === 'balanced') {
          setPhase({ k: 'review', photoUri: uri, rowId: null, fields: null, loading: true, startedAt });
        }
        const out = await processCapture(uri, 'default', extractionMode, {
          defaultCurrency,
          userId: auth.user?.id,
          signal: ac.signal,
          onDraft: (draft, meta) => {
            setPhase((prev) =>
              prev.k === 'review' && prev.loading
                ? { ...prev, rowId: meta.captureId, fields: draft, loading: true, startedAt }
                : prev,
            );
          },
          onLocalDuplicateCandidate: (candidate, draft) => promptLocalDuplicateCandidate(candidate, draft, uri, startedAt),
          onPrecisePreflightWarning: promptPrecisePreflightWarning,
          onPrecisePreflightAccepted: showPreciseProcessingAlert,
        });
        handleDefaultCaptureOutcome(out, uri, startedAt);
      } else {
        const outPromise = processCapture(uri, 'one_click', extractionMode, {
          defaultCurrency,
          userId: auth.user?.id,
          signal: ac.signal,
          onLocalDuplicateCandidate: (candidate, draft) => promptLocalDuplicateCandidate(candidate, draft, uri, startedAt),
          onPrecisePreflightWarning: promptPrecisePreflightWarning,
          onPrecisePreflightAccepted: showPreciseProcessingAlert,
        });
        const out =
          extractionMode === 'precise'
            ? await Promise.race([outPromise, waitForVisibleDeadline(PRECISE_SCREEN_VISIBLE_DEADLINE_MS)])
            : await outPromise;

        if (out === 'visible_deadline') {
          setPhase({ k: 'idle' });
          void outPromise
            .then((lateOut) => handleOneClickCaptureOutcome(lateOut, uri, startedAt))
            .catch((error) => {
              if (__DEV__) console.warn('[camera] one-click gallery precise background capture stayed queued', error instanceof Error ? error.message : String(error));
            });
          return;
        }
        handleOneClickCaptureOutcome(out, uri, startedAt);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      setTimeout(flushBackgroundQueues, 600);
    }
  };

  /**
   * Swipe-up. Optimistic: the local write lands, the flight already played.
   *
   * Fires when the receipt is home (90% of the flight), not when the overlay
   * tears down — from that moment the camera is usable again, so a second
   * capture can replace this phase while the folder is still animating. Writing
   * on teardown instead would drop the receipt in exactly that case.
   */
  const onConfirmed = useCallback(
    async (fields: ReceiptFields) => {
      if (phase.k === 'review' && phase.rowId) await confirm(phase.rowId, fields, auth.user?.id);
      popFolder();
    },
    [auth.user?.id, phase, popFolder],
  );

  /** The flight has finished playing; drop the overlay if it's still ours. */
  const onReviewDone = useCallback(() => {
    setWakeEarly(false); // phase.k === 'idle' takes over from here
    setPhase((prev) => (prev.k === 'review' ? { k: 'idle' } : prev));
  }, []);

  /** Swipe confirmed — wake the sensor now, mid-flight, not at teardown. */
  const onReviewRelease = useCallback(() => setWakeEarly(true), []);

  /** Retake: cancel any in-flight extract and drop the row. */
  const onRetake = useCallback(async () => {
    abortRef.current?.abort();
    setWakeEarly(false);
    if (phase.k === 'review' && phase.rowId) await store.remove(phase.rowId);
    setPhase({ k: 'idle' });
  }, [phase]);

  const onFieldsChange = useCallback((fields: ReceiptFields) => {
    setPhase((prev) => (prev.k === 'review' ? { ...prev, fields } : prev));
  }, []);

  /** Aim the lens where the user tapped, mark the spot, and retarget tracking. */
  const showReticle = focus.show;
  const redirectTracking = tracking.redirect;
  const focusAt = useCallback(
    (x: number, y: number) => {
      showReticle(x, y);
      // Point the document tracker at the tap too — drop any stale lock and
      // re-acquire on whatever's there (e.g. the card the user is indicating).
      redirectTracking(x, y);
      // Throws if the session isn't ready yet; a failed focus is not worth
      // interrupting the user over.
      void cameraRef.current?.focusTo({ x, y }).catch(() => {});
    },
    [showReticle, redirectTracking],
  );

  // Back at the live preview: hand focus back to continuous. A new scan is a
  // new document, and inheriting the last one's focus point would hold the lens
  // at the wrong distance for it.
  const clearReticle = focus.clear;
  useEffect(() => {
    if (phase.k !== 'idle') return;
    clearReticle();
    void cameraRef.current?.resetFocus().catch(() => {});
  }, [phase.k, clearReticle]);

  // Keep the tracked card in focus: nudge the lens to the box centre when it has
  // moved enough, rate-limited so the lens settles instead of hunting. Only on
  // the live preview, and only while a box is actually shown.
  const trackCenter = tracking.center;
  const trackShown = tracking.shown;
  useEffect(() => {
    if (!cameraActive) return; // nothing to focus when the sensor is stopped
    let last = { x: 0, y: 0, t: 0 };
    // Poll ~every 800ms (not 350) — the lens still only refocuses at most once
    // per 1.2s, so faster polling just spun the CPU for nothing.
    const id = setInterval(() => {
      if (trackShown.value < 0.6) return; // no confident box → leave continuous AF alone
      const c = trackCenter.value;
      const now = Date.now();
      const moved = Math.hypot(c.x - last.x, c.y - last.y);
      if (now - last.t < 1200 || moved < width * 0.06) return;
      last = { x: c.x, y: c.y, t: now };
      void cameraRef.current?.focusTo({ x: c.x, y: c.y }).catch(() => {});
    }, 800);
    return () => clearInterval(id);
  }, [trackCenter, trackShown, cameraActive, width]);

  // Auth still resolving — hold on a spinner before any routing decision.
  if (auth.loading) {
    return (
      <View style={styles.gate}>
        <StatusBar style="light" />
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  // No device yet means the camera list is still enumerating (or this is a
  // simulator with no camera at all).
  if (hasPermission && !device) {
    return (
      <View style={styles.gate}>
        <StatusBar style="light" />
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View style={styles.gate}>
        <StatusBar style="light" />
        <Text style={styles.gateText}>Camera access is needed to scan receipts.</Text>
        <Pressable
          style={styles.gateBtn}
          onPress={canRequestPermission ? () => void requestPermission() : () => Linking.openSettings()}
        >
          <Text style={styles.gateBtnText}>{canRequestPermission ? 'Allow camera' : 'Open Settings'}</Text>
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
          {device && (
            <Camera
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              device={device}
              outputs={tracking.output ? [photoOutput, tracking.output] : [photoOutput]}
              // 30fps is plenty for framing a receipt; 60 just doubles the
              // detection/preview work for no scanning benefit.
              constraints={[{ fps: 30 }]}
              // Live only when actually scanning — see `cameraActive`. Stopping
              // during review/menu/background is the main thermal saving. The
              // trade is a short resume when you return to the live preview.
              isActive={cameraActive}
            />
          )}

          {/* Tap bare preview to focus THERE. Sits directly on the camera so
              every control below paints above it. */}
          <TapToFocusLayer point={focus.point} onFocus={focusAt} enabled={!busy} />

          {/* Live document outline, riding the tracker's shared values. */}
          <TrackingQuad tracking={tracking} />
          {/* Diagnostics HUD refreshes React state on a timer, so it's opt-in
              (set EXPO_PUBLIC_TRACKING_HUD=1 in .env), not always-on in dev. */}
          {__DEV__ && process.env.EXPO_PUBLIC_TRACKING_HUD === '1' && <TrackingDebug tracking={tracking} />}

          {/* One-click's folder. Always mounted — it has to stay around to
              animate out when you switch to Default; it just parks off-screen.
              Default's own folder lives in the review overlay. */}
          <Animated.View style={[styles.folder, { left: spacing.lg, top: folderTop }, folderStyle]}>
            <Pressable onPress={openRecents} hitSlop={12}>
              <RecentsFolder width={FOLDER_W} />
            </Pressable>
          </Animated.View>

          <Pressable style={[styles.menuCard, { top: insets.top + spacing.sm }]} onPress={() => openMenu()}>
            <Ionicons name="menu" size={22} color="#fff" />
            <Text style={styles.menuLabel}>Menu</Text>
          </Pressable>

          {/* The static framing hint yields while the live outline is on the
              document — two rectangles at once reads as a bug. Where tracking
              isn't available, `shown` never leaves 0 and the guide just stays. */}
          <Animated.View style={[styles.guideWrap, guideStyle]} pointerEvents="none">
            <View style={styles.guide} />
          </Animated.View>

          <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.lg }]}>
            <ExtractionModeToggle mode={extractionMode} onChange={setExtractionMode} />

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
        <View style={{ width }}>{menuOpen && <MenuPanel onClose={closeMenu} initialTab={menuInitialTab} />}</View>
      </Animated.View>

      {phase.k === 'review' && (
        <ReceiptReview
          photoUri={phase.photoUri}
          fields={phase.fields}
          loading={phase.loading}
          startedAt={phase.startedAt}
          onConfirmed={onConfirmed}
          onRelease={onReviewRelease}
          onDone={onReviewDone}
          onRetake={onRetake}
          onFieldsChange={onFieldsChange}
        />
      )}

      {phase.k === 'processing' && (
        <View style={styles.processing}>
          <Text style={styles.processingText}>Your receipt is being processed</Text>
          {phase.reason && <Text style={styles.processingReason}>{phase.reason}</Text>}
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

  extractionToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: radius.pill,
    padding: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  extractionSeg: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: radius.pill },
  extractionSegActive: { backgroundColor: '#fff' },
  extractionText: { color: 'rgba(255,255,255,0.82)', fontSize: 13, fontFamily: fontFamily.semibold },
  extractionTextActive: { color: '#111' },

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
  processingReason: {
    maxWidth: '82%',
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
  check: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
