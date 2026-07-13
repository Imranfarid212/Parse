import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';

import { radius, spacing } from '@/theme/tokens';

export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);

  const onCapture = async () => {
    if (!cameraRef.current || busy) return;
    try {
      setBusy(true);
      // Flash Auto: fires only when it's genuinely dark. No on-screen toggle.
      const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
      console.log('[capture] photo at', photo?.uri);
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
    // TODO(next): same downstream as capture.
  };

  // Permission still loading
  if (!permission) {
    return (
      <View style={styles.gate}>
        <StatusBar style="light" />
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  // Permission not granted
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
      <StatusBar style="light" />
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" flash="auto" />

      {/* Top-right menu pill-card (settings/menu — action TBD) */}
      <Pressable style={[styles.menuCard, { top: insets.top + spacing.sm }]} onPress={() => {}}>
        <Ionicons name="menu" size={22} color="#fff" />
        <Text style={styles.menuLabel}>Menu</Text>
      </Pressable>

      {/* Center guide frame (static alignment guide) */}
      <View style={styles.guideWrap} pointerEvents="none">
        <View style={styles.guide} />
      </View>

      {/* Bottom controls */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Pressable style={styles.sideBtn} onPress={onPickFromGallery} hitSlop={12}>
          <Ionicons name="images-outline" size={26} color="#fff" />
        </Pressable>

        <Pressable style={[styles.capture, busy && styles.captureBusy]} onPress={onCapture} disabled={busy}>
          <View style={styles.captureInner} />
        </Pressable>

        {/* Right side — empty placeholder (future front/back flip) */}
        <View style={styles.sideBtn} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
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
  guide: {
    width: '70%',
    aspectRatio: 0.72,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.6)',
    borderRadius: radius.md,
  },

  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
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
});
