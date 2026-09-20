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

/**
 * Drop detections below this confidence — phantom rectangles score low.
 * Raised from 0.25: segmentation scores a real page well above this, and the
 * marginal frames it used to let through contributed most of the jitter.
 */
const MIN_CONFIDENCE = 0.5;
/** Reject implausible pages: a big rectangle is a monitor/wall, tiny is noise. */
const MAX_AREA = 0.5;
const MIN_AREA = 0.04;
/**
 * Shape gate, applied ONLY while acquiring. Area alone said nothing about
 * proportion, and every observed mis-lock — a palm plus the floor, a table edge
 * — came back markedly WIDE, where a receipt is essentially always tall. Above
 * this ratio a fresh detection is not eligible to become the lock.
 *
 * Acquisition-only is deliberate: once tracking a real page, the continuity
 * gate already owns the decision, so this cannot break a good lock if the page
 * is turned, and the cost of being wrong is no box rather than a confidently
 * wrong one. A receipt held deliberately sideways will not acquire; that is the
 * trade, and it is one constant to loosen if it ever matters.
 */
const MAX_ACQUIRE_ASPECT = 1.5;
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
/**
 * withTiming toward each accepted detection — this IS the smoothing. A touch
 * above the detection interval so overlapping eases low-pass the frame-to-
 * frame corner jitter (the wobble) a little more without slowing how fast a
 * genuine move gets caught — that's gated separately, by REJECT_FRAC/MAX below,
 * so this can't affect which corners get accepted, only how smoothly accepted
 * ones are drawn.
 */
const TRACK_MS = 140;
/**
 * The ACTUAL low-pass. `withTiming` above is a re-target tween, not a filter:
 * a fresh raw target arrives every DETECT_INTERVAL_S (90ms) and the 140ms ease
 * never converges before being retargeted, so the quad faithfully chased every
 * detection's noise — that was the wobble.
 *
 * Smoothing the five FITTED scalars (centre, size, angle) rather than the eight
 * corner coordinates is both cheaper and steadier: the rigid-rect fit below
 * already collapses the trapezoid, so these five fully describe the overlay,
 * and a segmentation mask that breathes at its edges can no longer pulse width
 * and height independently of one another.
 */
const EMA_ALPHA = 0.3;
/**
 * Dead-band, measured against what was last DRAWN rather than the last
 * smoothed value — otherwise suppressed movement accumulates invisibly and
 * then catches up in one jump. Below these the quad is not redrawn at all,
 * which is what makes a steady hand read as locked rather than merely slow.
 */
const DEADBAND_CENTER = 0.004; // fraction of view width
const DEADBAND_SIZE = 0.01; // fraction of view width
const DEADBAND_ANG = 0.0087; // ~0.5 degrees
/** A near-straight card stays perfectly upright. ~5.2 degrees. */
const ANG_DEADZONE = 0.09;
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
/**
 * Detection is throttled by FRAME TIMESTAMP, not frame count: run Apple Vision
 * at most once per DETECT_INTERVAL_S even though the preview streams at 30fps.
 * VNDetectDocumentSegmentationRequest on the Neural Engine is the app's main
 * heat cost. ~7fps was too sparse — the box stepped — so this sits at ~11fps:
 * still ~1/3 the original per-frame ML work, but smooth. Every skipped frame is
 * still disposed.
 */
const DETECT_INTERVAL_S = 0.09; // ~11 detections/sec

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
  /**
   * Geometry diagnostics. `fw/fh` is the UPRIGHT frame size native reports;
   * `nw/nh` is the detected quad's bounding box in Vision's normalised space.
   * Together they say whether a wrongly-shaped overlay came from the detector
   * finding a wrongly-shaped region, or from the frame being mapped into the
   * view with its axes transposed — which look identical on screen.
   */
  dbgFw: SharedValue<number>;
  dbgFh: SharedValue<number>;
  dbgNw: SharedValue<number>;
  dbgNh: SharedValue<number>;
};

export function useDocumentTracking(): DocumentTracking {
  const boxed = getBoxedDocumentTracker();

  const raw = useSharedValue<RawQuad | null>(null);
  const layout = useSharedValue({ w: 0, h: 0 });
  const shown = useSharedValue(0);
  const frames = useSharedValue(0);
  const hits = useSharedValue(0);
  const lastConf = useSharedValue(0);
  const dbgFw = useSharedValue(0);
  const dbgFh = useSharedValue(0);
  const dbgNw = useSharedValue(0);
  const dbgNh = useSharedValue(0);
  // Timestamp of the last frame we actually ran detection on (seconds).
  const lastDetectTs = useSharedValue(0);
  // Lock state carried between detections: the locked centre, the consecutive
  // outlier count, and whether we currently hold a lock.
  // Lock state carried between detections. cx/cy/w/h/ang are the SMOOTHED fit;
  // the d* pair is what was last drawn, which the dead-band compares against.
  const track = useSharedValue({
    cx: 0, cy: 0, w: 0, h: 0, ang: 0,
    dcx: 0, dcy: 0, dw: 0, dh: 0, dang: 0,
    rejects: 0, active: false,
  });
  // Where re-acquisition is allowed to look (normalised view coords). Centre by
  // default; a tap moves it.
  const anchor = useSharedValue({ x: 0.5, y: 0.5 });
  // Live tracked-box centre (view coords), read on the JS thread to steer focus.
  const center = useSharedValue({ x: 0, y: 0 });
  /* eslint-disable react-hooks/rules-of-hooks -- fixed-length list */
  const corners = [0, 0, 0, 0, 0, 0, 0, 0].map((v) => useSharedValue(v));
  /* eslint-enable react-hooks/rules-of-hooks */

  const frameOutput = useFrameOutput({
    // 720p for detection: 540p measurably hurt how reliably Vision found and
    // placed the document. The heat saving now comes from the ~11fps throttle
    // (below) and pausing the whole session when idle, not from starving the
    // detector of pixels. The captured PHOTO is a separate full-res output.
    targetResolution: { width: 1280, height: 720 },
    pixelFormat: 'yuv',
    dropFramesWhileBusy: true,
    onFrame: (frame: Frame) => {
      'worklet';
      try {
        if (boxed == null) return;
        // Throttle by presentation timestamp (seconds). A skipped frame falls
        // straight through to dispose() below — never left undisposed.
        const ts = frame.timestamp;
        if (ts <= 0 || ts - lastDetectTs.value < DETECT_INTERVAL_S) return;
        lastDetectTs.value = ts;
        frames.value += 1;
        const q = boxed.unbox().detect(frame);
        if (q != null) {
          hits.value += 1;
          lastConf.value = q.confidence;
          dbgFw.value = q.uprightWidth;
          dbgFh.value = q.uprightHeight;
          // Bounding box of the quad in Vision's own normalised space, before
          // any view mapping touches it.
          const xs = [q.topLeftX, q.topRightX, q.bottomRightX, q.bottomLeftX];
          const ys = [q.topLeftY, q.topRightY, q.bottomRightY, q.bottomLeftY];
          dbgNw.value = Math.max(...xs) - Math.min(...xs);
          dbgNh.value = Math.max(...ys) - Math.min(...ys);
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
      // No axis flip here anymore. HybridDocumentTracker.swift's EXIF
      // orientation mapping (.left/.right) was wrong, which is what made the
      // frame land rotated half a turn from the portrait preview — the 180°
      // mirror here was a buildless compensation for that. Now that the native
      // mapping is fixed, mirroring on top of already-correct data just
      // displaces an otherwise-right box (constant offset, same shape) rather
      // than correcting anything. If a genuine native regression brings the
      // 180° back, it belongs in Swift again, not here.
      const nx = [q.x1, q.x2, q.x3, q.x4];
      const ny = [q.y1, q.y2, q.y3, q.y4];
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
      // Axis-aligned bounds of the quad, for the acquisition shape gate below.
      const bbw = Math.max(vx[0], vx[1], vx[2], vx[3]) - Math.min(vx[0], vx[1], vx[2], vx[3]);
      const bbh = Math.max(vy[0], vy[1], vy[2], vy[3]) - Math.min(vy[0], vy[1], vy[2], vy[3]);

      const st = track.value;
      if (!st.active) {
        // Acquisition: only lock onto a detection near the anchor (frame centre,
        // or the last tap). This is what rejects a background monitor and what
        // lets a tap choose the target.
        const a = anchor.value;
        if (Math.abs(cx / L.w - a.x) > CENTER_X_TOL || Math.abs(cy / L.h - a.y) > CENTER_Y_TOL) return;
        // Too wide to be a receipt — almost certainly the hand, the desk or the
        // floor rather than the page.
        if (bbh <= 0 || bbw / bbh > MAX_ACQUIRE_ASPECT) return;
      } else {
        // Tracking: a detection whose centre jumped too far is a mis-lock —
        // ignore it OUTRIGHT, never blend, unless it has insisted REJECT_MAX
        // frames, at which point re-lock to it.
        const jump = Math.hypot(cx - st.cx, cy - st.cy);
        if (jump > L.w * REJECT_FRAC && st.rejects < REJECT_MAX) {
          track.value = { ...st, rejects: st.rejects + 1 };
          return;
        }
      }
      // Fit a RIGID rotated rectangle to the detected corners. Average the two
      // horizontal edges (TL→TR, BL→BR) into one direction + width, the two
      // vertical edges into one height. The perspective trapezoid collapses to
      // a true rectangle, so the overlay only translates, rotates and scales —
      // never skews, so it never reads as a 3D tilt.
      const topx = vx[1] - vx[0], topy = vy[1] - vy[0];
      const botx = vx[2] - vx[3], boty = vy[2] - vy[3];
      const rawAng = Math.atan2(topy + boty, topx + botx);
      const rawW = (Math.hypot(topx, topy) + Math.hypot(botx, boty)) / 2;
      const rawH =
        (Math.hypot(vx[3] - vx[0], vy[3] - vy[0]) + Math.hypot(vx[2] - vx[1], vy[2] - vy[1])) / 2;

      // Low-pass the fit. The first lock takes the raw values outright so the
      // quad snaps on rather than easing in from wherever it last sat.
      const first = !st.active;
      let sAng = rawAng;
      if (!first) {
        // Shortest-arc difference: a page held near half a turn must not smooth
        // the long way round.
        let d = rawAng - st.ang;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        sAng = st.ang + EMA_ALPHA * d;
      }
      const sCx = first ? cx : st.cx + EMA_ALPHA * (cx - st.cx);
      const sCy = first ? cy : st.cy + EMA_ALPHA * (cy - st.cy);
      const sW = first ? rawW : st.w + EMA_ALPHA * (rawW - st.w);
      const sH = first ? rawH : st.h + EMA_ALPHA * (rawH - st.h);

      // The deadzone applies to the SMOOTHED angle, not the raw one. On a raw
      // value hovering at the threshold it would otherwise flip between 0 and
      // ~5 degrees every detection, and the filter would average that flicker
      // into a permanent phantom tilt.
      const angD = Math.abs(sAng) < ANG_DEADZONE ? 0 : sAng;

      const still =
        !first &&
        Math.hypot(sCx - st.dcx, sCy - st.dcy) < L.w * DEADBAND_CENTER &&
        Math.abs(sW - st.dw) < L.w * DEADBAND_SIZE &&
        Math.abs(sH - st.dh) < L.w * DEADBAND_SIZE &&
        Math.abs(angD - st.dang) < DEADBAND_ANG;

      track.value = {
        cx: sCx, cy: sCy, w: sW, h: sH, ang: sAng,
        dcx: still ? st.dcx : sCx,
        dcy: still ? st.dcy : sCy,
        dw: still ? st.dw : sW,
        dh: still ? st.dh : sH,
        dang: still ? st.dang : angD,
        rejects: 0,
        active: true,
      };
      center.value = { x: sCx, y: sCy };

      if (!still) {
        const hw = sW / 2, hh = sH / 2;
        const c = Math.cos(angD), s = Math.sin(angD);
        const rx = [-hw, hw, hw, -hw]; // TL,TR,BR,BL in the rect's own frame
        const ry = [-hh, -hh, hh, hh];
        // The tween now only carries the quad between already-filtered targets;
        // first lock snaps into place.
        const cfg = { duration: first ? 0 : TRACK_MS };
        for (let i = 0; i < 4; i++) {
          corners[i * 2].value = withTiming(sCx + rx[i] * c - ry[i] * s, cfg);
          corners[i * 2 + 1].value = withTiming(sCy + rx[i] * s + ry[i] * c, cfg);
        }
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
      track.value = { ...track.value, rejects: 0, active: false };
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
    dbgFw,
    dbgFh,
    dbgNw,
    dbgNh,
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
  const [s, setS] = useState({ frames: 0, hits: 0, conf: 0, fw: 0, fh: 0, nw: 0, nh: 0 });
  useEffect(() => {
    const id = setInterval(() => {
      setS({
        frames: Math.round(tracking.frames.value),
        hits: Math.round(tracking.hits.value),
        conf: tracking.lastConf.value,
        fw: Math.round(tracking.dbgFw.value),
        fh: Math.round(tracking.dbgFh.value),
        nw: tracking.dbgNw.value,
        nh: tracking.dbgNh.value,
      });
    }, 400);
    return () => clearInterval(id);
  }, [tracking]);

  // Pixel aspect of the detected region: the normalised box scaled back up by
  // the frame it came from. Above 1 is landscape. Holding a portrait receipt,
  // this should read well below 1 — if it does and the overlay is still wide,
  // the fault is in the view mapping, not the detector.
  const px = s.fh > 0 && s.nh > 0 ? (s.nw * s.fw) / (s.nh * s.fh) : 0;

  return (
    <View style={styles.debug} pointerEvents="none">
      <Text style={styles.debugText}>
        plugin {tracking.available ? 'YES' : 'NO'} · frames {s.frames} · pages {s.hits} · conf{' '}
        {s.conf.toFixed(2)}
        {'\n'}frame {s.fw}x{s.fh} {s.fw > s.fh ? '(LANDSCAPE)' : '(portrait)'}
        {'\n'}norm {s.nw.toFixed(2)}x{s.nh.toFixed(2)} · px aspect {px.toFixed(2)}{' '}
        {px > 1 ? '(wide)' : '(tall)'}
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
