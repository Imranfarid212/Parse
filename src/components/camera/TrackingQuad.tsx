/**
 * TrackingQuad — the live yellow outline that follows the document.
 *
 * Vision (native, per frame) → 4 corners → Reanimated shared values → a Skia
 * quad. Three runtimes cooperate and NONE of them is React state:
 *
 *  camera worklet  runs the Nitro tracker on each frame and writes the raw
 *                  quad to a shared value. Never calls setState — 30-60
 *                  renders/sec would wreck the preview. Detection also gets
 *                  cheaper input: 720p frames, YUV (docs: ~2.6x less bandwidth
 *                  than RGB), and dropFramesWhileBusy so a slow frame drops
 *                  instead of queueing — detection always sees "now".
 *  UI runtime      a reaction maps frame-space corners into view space and
 *                  eases the display values toward them (the glide that makes
 *                  jittery per-frame detections read as tracking). Animations
 *                  must start HERE — the camera worklet only writes raw data.
 *  Skia            derives its path from the display values.
 *
 * The frame→view mapping is the aspect-fill (cover) transform: the preview
 * crops the frame, so multiplying normalised corners by view size — the
 * obvious move — puts the quad visibly off the document. Scale by
 * max(view/frame) about the centre, like the preview does.
 *
 * Visibility is a hold-then-fade: every detection restarts show→hold→fade, so
 * losing the page fades the quad out ~LOST_MS later instead of strobing it on
 * single missed frames.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Canvas, Circle, Group, Path, Skia } from '@shopify/react-native-skia';
import { useFrameOutput, type CameraFrameOutput, type Frame } from 'react-native-vision-camera';
import {
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { getBoxedDocumentTracker } from '@/lib/vision/documentTracker';

/** Below this Vision confidence a "page" is noise, not a receipt. */
const MIN_CONFIDENCE = 0.3;
/** Glide between detections. */
const TRACK_MS = 90;
/** How long the quad survives without a fresh detection. */
const LOST_MS = 260;

const YELLOW = '#FFD60A';

type RawQuad = {
  x1: number; y1: number; // top-left      (normalised, upright, top-left origin)
  x2: number; y2: number; // top-right
  x3: number; y3: number; // bottom-right
  x4: number; y4: number; // bottom-left
  fw: number; fh: number; // upright frame size, px
  seq: number;
};

export type DocumentTracking = {
  /** Attach to the Camera's `outputs` — null when the plugin isn't in this build. */
  output: CameraFrameOutput | null;
  /** 0…1 — how visible the quad is. Doubles as "the guide should yield". */
  shown: SharedValue<number>;
  layout: SharedValue<{ w: number; h: number }>;
  corners: SharedValue<number>[]; // x1,y1 … x4,y4 in view space
  /** True when the native plugin is present in THIS build. */
  available: boolean;
  /** Diagnostics: frames seen, pages found, last confidence. */
  frames: SharedValue<number>;
  hits: SharedValue<number>;
  lastConf: SharedValue<number>;
};

export function useDocumentTracking(): DocumentTracking {
  const boxed = getBoxedDocumentTracker();

  const raw = useSharedValue<RawQuad | null>(null);
  const layout = useSharedValue({ w: 0, h: 0 });
  const shown = useSharedValue(0);
  const frames = useSharedValue(0);
  const hits = useSharedValue(0);
  const lastConf = useSharedValue(0);
  /* eslint-disable react-hooks/rules-of-hooks -- fixed-length list */
  const corners = [0, 0, 0, 0, 0, 0, 0, 0].map((v) => useSharedValue(v));
  /* eslint-enable react-hooks/rules-of-hooks */

  const frameOutput = useFrameOutput({
    targetResolution: { width: 1280, height: 720 },
    pixelFormat: 'yuv',
    dropFramesWhileBusy: true,
    onFrame: (frame: Frame) => {
      'worklet';
      try {
        if (boxed == null) return;
        frames.value += 1;
        const q = boxed.unbox().detect(frame);
        if (q != null) {
          hits.value += 1;
          lastConf.value = q.confidence;
        }
        if (q == null || q.confidence < MIN_CONFIDENCE) return;
        const prev = raw.value;
        raw.value = {
          x1: q.topLeftX, y1: q.topLeftY,
          x2: q.topRightX, y2: q.topRightY,
          x3: q.bottomRightX, y3: q.bottomRightY,
          x4: q.bottomLeftX, y4: q.bottomLeftY,
          fw: q.uprightWidth, fh: q.uprightHeight,
          seq: (prev?.seq ?? 0) + 1,
        };
      } finally {
        // Mandatory: an undisposed Frame stalls the camera pipeline.
        frame.dispose();
      }
    },
  });

  useAnimatedReaction(
    () => raw.value,
    (q, prev) => {
      if (q === null || q.seq === prev?.seq) return;
      const L = layout.value;
      if (L.w === 0 || q.fw === 0 || q.fh === 0) return;

      // Aspect-fill: what the preview shows is the frame scaled by the LARGER
      // view/frame ratio and centre-cropped; apply the same transform.
      const scale = Math.max(L.w / q.fw, L.h / q.fh);
      const dx = (q.fw * scale - L.w) / 2;
      const dy = (q.fh * scale - L.h) / 2;

      // First sighting snaps; after that it glides.
      const cfg = { duration: shown.value < 0.05 ? 0 : TRACK_MS };
      const xs = [q.x1, q.x2, q.x3, q.x4];
      const ys = [q.y1, q.y2, q.y3, q.y4];
      for (let i = 0; i < 4; i++) {
        corners[i * 2].value = withTiming(xs[i] * q.fw * scale - dx, cfg);
        corners[i * 2 + 1].value = withTiming(ys[i] * q.fh * scale - dy, cfg);
      }

      // Show → hold → fade; every fresh detection restarts the clock.
      shown.value = withSequence(
        withTiming(1, { duration: 100 }),
        withDelay(LOST_MS, withTiming(0, { duration: 200 })),
      );
    },
  );

  return {
    output: boxed ? frameOutput : null,
    shown,
    layout,
    corners,
    available: boxed != null,
    frames,
    hits,
    lastConf,
  };
}

/**
 * Dev-only readout of the tracking chain, so "no yellow" becomes a specific
 * failure point rather than a mystery. Polls the shared values on the JS thread
 * every 400ms — cheap, and only mounted in __DEV__.
 *
 *  available false        → the plugin isn't in this build (rebuild)
 *  available true, frames stuck at 0 → the frame output isn't streaming
 *  frames climbing, hits 0            → detection never finds a page
 *  hits climbing, conf low            → found something below MIN_CONFIDENCE
 *  hits + good conf, still no quad     → the view mapping / render is at fault
 */
export function TrackingDebug({ tracking }: { tracking: DocumentTracking }) {
  const [s, setS] = useState({ frames: 0, hits: 0, conf: 0 });
  useEffect(() => {
    const id = setInterval(() => {
      setS({
        frames: Math.round(tracking.frames.value),
        hits: Math.round(tracking.hits.value),
        conf: tracking.lastConf.value,
      });
    }, 400);
    return () => clearInterval(id);
  }, [tracking]);

  return (
    <View style={styles.debug} pointerEvents="none">
      <Text style={styles.debugText}>
        plugin {tracking.available ? 'YES' : 'NO'} · frames {s.frames} · pages {s.hits} · conf{' '}
        {s.conf.toFixed(2)}
      </Text>
    </View>
  );
}

export function TrackingQuad({ tracking }: { tracking: DocumentTracking }) {
  const { corners, shown, layout } = tracking;

  const path = useDerivedValue(() => {
    const p = Skia.Path.Make();
    p.moveTo(corners[0].value, corners[1].value);
    p.lineTo(corners[2].value, corners[3].value);
    p.lineTo(corners[4].value, corners[5].value);
    p.lineTo(corners[6].value, corners[7].value);
    p.close();
    return p;
  });

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) => {
        tracking.layout.value = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
      }}
    >
      <Canvas style={StyleSheet.absoluteFill}>
        <Group opacity={shown}>
          <Path path={path} style="stroke" strokeWidth={3} strokeJoin="round" color={YELLOW} />
          <Circle cx={corners[0]} cy={corners[1]} r={5} color={YELLOW} />
          <Circle cx={corners[2]} cy={corners[3]} r={5} color={YELLOW} />
          <Circle cx={corners[4]} cy={corners[5]} r={5} color={YELLOW} />
          <Circle cx={corners[6]} cy={corners[7]} r={5} color={YELLOW} />
        </Group>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  debug: {
    position: 'absolute',
    top: 100,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  debugText: { color: '#FFD60A', fontSize: 12, fontVariant: ['tabular-nums'] },
});
