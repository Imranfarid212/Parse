import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { MenuPanel } from '@/components/MenuPanel';
import { radius, spacing } from '@/theme/tokens';

type Mode = 'default' | 'oneclick';

// "Emphasized" easing: zero velocity at the start (a deliberate drag through
// the first third), fast acceleration through the middle, soft settle at the
// end. Makes the push read as an intentional, noticeable motion.
const EMPHASIZED = Easing.bezier(0.5, 0, 0.2, 1);

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
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>('default');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuProgress = useSharedValue(0);

  const openMenu = () => {
    setMenuOpen(true);
    menuProgress.value = withTiming(1, { duration: 620, easing: EMPHASIZED });
  };
  const closeMenu = () => {
    menuProgress.value = withTiming(0, { duration: 560, easing: EMPHASIZED }, (f) => {
      if (f) runOnJS(setMenuOpen)(false);
    });
  };

  // Slide the whole [camera | menu] strip left as the menu opens.
  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -width * menuProgress.value }] }));

  const onCapture = async () => {
    if (!cameraRef.current || busy) return;
    try {
      setBusy(true);
      const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
      console.log('[capture] mode', mode, 'photo at', photo?.uri);
      // TODO(next): compress → POST to /extract → confirmation screen.
    } catch (e) {
      console.warn('[capture] failed', e);
    } finally {
      setBusy(false);
    }
  };

  const onPickFromGallery = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (!res.canceled) console.log('[gallery] picked', res.assets[0]?.uri);
  };

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
        </View>

        {/* ── Menu half ── */}
        <View style={{ width }}>{menuOpen && <MenuPanel onClose={closeMenu} />}</View>
      </Animated.View>
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
});
