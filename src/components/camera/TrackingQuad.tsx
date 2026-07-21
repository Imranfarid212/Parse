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
import React, { useCallback, useEffect, useState } from 'react';
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

/** Drop detections below this confidence — phantom rectangles score low. */
const MIN_CONFIDENCE = 0.25;
/** Reject implausible pages: a big rectangle is a monitor/wall, tiny is noise. */
const MAX_AREA = 0.5;
const MIN_AREA = 0.04;
/**
 * Acquisition window. Before a lock exists, only a detection whose centre falls
 * within this much of the ANCHOR is accepted. The anchor is frame-centre by
 * default, or wherever the user last tapped — that's what makes a tap redirect
 * tracking: it moves the window, so the next detection near the tap becomes the
 * new lock. Once locked, this no longer applies; the continuity gate tracks the
 * card wherever it goes.
 */
const CENTER_X_TOL = 0.36;
const CENTER_Y_TOL = 0.42;
/** withTiming toward each accepted detection — this IS the smoothing. */
const TRACK_MS = 70;
/**
 * Continuity gate. Vision returns SOME rectangle every frame — often the wrong
 * one (screen, keyboard) as the receipt wavers. A detection whose centre jumps
 * more than REJECT_FRAC of the view width from the locked quad is IGNORED
 * outright (never blended), up to REJECT_MAX frames — after which a genuine
 * large move, or the receipt leaving, is finally accepted and re-locked.
 */
const REJECT_FRAC = 0.3;
const REJECT_MAX = 6;
/** How long the quad survives without a fresh detection. */
const LOST_MS = 260;

const YELLOW = '#FFD60A';

type RawQuad = {
  x1: number; y1: number; // top-left      (normalised, upright, top-left origin)
  x2: number; y2: number; // top-right
  x3: number; y3: number; // bottom-right
  x4: number; y4: number; // bottom-left
  fw: number; fh: number; // upright frame size, px
  conf: number;
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
  /** Live centre of the tracked box, view coords — for driving lens focus. */
  center: SharedValue<{ x: number; y: number }>;
  /** Drop the current lock and re-acquire near a tapped view point. */
  redirect: (x: number, y: number) => void;
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
  // Lock state carried between detections: the locked centre, the consecutive
  // outlier count, and whether we currently hold a lock.
  const track = useSharedValue({ cx: 0, cy: 0, rejects: 0, active: false });
  // Where re-acquisition is allowed to look (normalised view coords). Centre by
  // default; a tap moves it.
  const anchor = useSharedValue({ x: 0.5, y: 0.5 });
  // Live tracked-box centre (view coords), read on the JS thread to steer focus.
  const center = useSharedValue({ x: 0, y: 0 });
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
        if (q == null) return;
        const prev = raw.value;
        raw.value = {
          x1: q.topLeftX, y1: q.topLeftY,
          x2: q.topRightX, y2: q.topRightY,
          x3: q.bottomRightX, y3: q.bottomRightY,
          x4: q.bottomLeftX, y4: q.bottomLeftY,
          fw: q.uprightWidth, fh: q.uprightHeight,
          conf: q.confidence,
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

      if (q.conf < MIN_CONFIDENCE) return;

      // Reject implausible pages by area (shoelace on normalised corners): a
      // near-full-frame quad is the desk or wall, a speck is noise.
      //
      // Both axes are mirrored here — a 180° correction. The Swift's EXIF
      // orientation mapping lands the frame rotated half a turn from the
      // portrait preview, so a card moved left/up sends the box right/down.
      // (App is portrait-locked, so a constant flip is safe. The proper home
      // for this is the orientation mapping in HybridDocumentTracker.swift, to
      // be cleaned up on the next rebuild; here it's buildless.)
      const nx = [1 - q.x1, 1 - q.x2, 1 - q.x3, 1 - q.x4];
      const ny = [1 - q.y1, 1 - q.y2, 1 - q.y3, 1 - q.y4];
      let a2 = 0;
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        a2 += nx[i] * ny[j] - nx[j] * ny[i];
      }
      const area = Math.abs(a2) / 2;
      if (area > MAX_AREA || area < MIN_AREA) return;

      // Aspect-fill: what the preview shows is the frame scaled by the LARGER
      // view/frame ratio and centre-cropped; apply the same transform. Vision's
      // corner order (TL,TR,BR,BL) is a valid quad — trust it, don't reorder.
      const scale = Math.max(L.w / q.fw, L.h / q.fh);
      const dx = (q.fw * scale - L.w) / 2;
      const dy = (q.fh * scale - L.h) / 2;
      const vx = nx.map((v) => v * q.fw * scale - dx);
      const vy = ny.map((v) => v * q.fh * scale - dy);
      const cx = (vx[0] + vx[1] + vx[2] + vx[3]) / 4;
      const cy = (vy[0] + vy[1] + vy[2] + vy[3]) / 4;

      const st = track.value;
      if (!st.active) {
        // Acquisition: only lock onto a detection near the anchor (frame centre,
        // or the last tap). This is what rejects a background monitor and what
        // lets a tap choose the target.
        const a = anchor.value;
        if (Math.abs(cx / L.w - a.x) > CENTER_X_TOL || Math.abs(cy / L.h - a.y) > CENTER_Y_TOL) return;
      } else {
        // Tracking: a detection whose centre jumped too far is a mis-lock —
        // ignore it OUTRIGHT, never blend, unless it has insisted REJECT_MAX
        // frames, at which point re-lock to it.
        const jump = Math.hypot(cx - st.cx, cy - st.cy);
        if (jump > L.w * REJECT_FRAC && st.rejects < REJECT_MAX) {
          track.value = { cx: st.cx, cy: st.cy, rejects: st.rejects + 1, active: true };
          return;
        }
      }
      track.value = { cx, cy, rejects: 0, active: true };
      center.value = { x: cx, y: cy };

      // Fit a RIGID rotated rectangle to the detected corners. Average the two
      // horizontal edges (TL→TR, BL→BR) into one direction + width, the two
      // vertical edges into one height. The perspective trapezoid collapses to
      // a true rectangle, so the overlay only translates, rotates and scales —
      // never skews, so it never reads as a 3D tilt.
      const topx = vx[1] - vx[0], topy = vy[1] - vy[0];
      const botx = vx[2] - vx[3], boty = vy[2] - vy[3];
      let ang = Math.atan2(topy + boty, topx + botx);
      // Deadzone: a near-straight card stays perfectly upright.
      if (Math.abs(ang) < 0.05) ang = 0;
      const w = (Math.hypot(topx, topy) + Math.hypot(botx, boty)) / 2;
      const h =
        (Math.hypot(vx[3] - vx[0], vy[3] - vy[0]) + Math.hypot(vx[2] - vx[1], vy[2] - vy[1])) / 2;
      const hw = w / 2, hh = h / 2;
      const c = Math.cos(ang), s = Math.sin(ang);
      const rx = [-hw, hw, hw, -hw]; // TL,TR,BR,BL in the rect's own frame
      const ry = [-hh, -hh, hh, hh];

      // withTiming toward the rectangle corners is the whole smoother; first
      // lock snaps into place.
      const cfg = { duration: st.active ? TRACK_MS : 0 };
      for (let i = 0; i < 4; i++) {
        corners[i * 2].value = withTiming(cx + rx[i] * c - ry[i] * s, cfg);
        corners[i * 2 + 1].value = withTiming(cy + rx[i] * s + ry[i] * c, cfg);
      }

      // Show → hold → fade; every accepted detection restarts the clock.
      shown.value = withSequence(
        withTiming(1, { duration: 100 }),
        withDelay(LOST_MS, withTiming(0, { duration: 200 })),
      );
    },
  );

  // Tap → drop the lock and point the acquisition window at the tap, so the
  // next detection there becomes the new target.
  const redirect = useCallback(
    (x: number, y: number) => {
      const L = layout.value;
      if (L.w > 0 && L.h > 0) anchor.value = { x: x / L.w, y: y / L.h };
      track.value = { cx: track.value.cx, cy: track.value.cy, rejects: 0, active: false };
    },
    [layout, anchor, track],
  );

  return {
    output: boxed ? frameOutput : null,
    shown,
    layout,
    corners,
    available: boxed != null,
    center,
    redirect,
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
