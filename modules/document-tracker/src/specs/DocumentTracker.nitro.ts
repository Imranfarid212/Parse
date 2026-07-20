/**
 * DocumentTracker — per-frame document-corner detection for the live camera.
 *
 * The Nitro spec for the iOS plugin wrapping VNDetectDocumentSegmentationRequest.
 * `detect` is called from the camera's frame worklet with a VisionCamera Frame
 * and returns the page's four corners, or undefined when no page is seen.
 *
 * Corners are NORMALISED (0…1) in the frame's UPRIGHT space with a TOP-LEFT
 * origin — the native side applies the frame's orientation and flips Vision's
 * bottom-left Y, so JS can treat them as ordinary screen-like coordinates.
 * `uprightWidth`/`uprightHeight` are the frame's pixel dimensions AFTER that
 * rotation, which is what the aspect-fill mapping to view space needs.
 *
 * Flat numbers rather than nested Point structs: this crosses the JS↔native
 * boundary up to 60 times a second, so it stays one shallow struct.
 */
import type { HybridObject } from 'react-native-nitro-modules';
import type { Frame } from 'react-native-vision-camera';

export interface DetectedQuad {
  topLeftX: number;
  topLeftY: number;
  topRightX: number;
  topRightY: number;
  bottomRightX: number;
  bottomRightY: number;
  bottomLeftX: number;
  bottomLeftY: number;
  /** Frame pixel size after orientation is applied. */
  uprightWidth: number;
  uprightHeight: number;
  /** Vision's confidence in the detection, 0…1. */
  confidence: number;
}

export interface DocumentTracker extends HybridObject<{ ios: 'swift' }> {
  detect(frame: Frame): DetectedQuad | undefined;
}
