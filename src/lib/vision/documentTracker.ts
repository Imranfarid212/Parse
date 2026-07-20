/**
 * The JS seam for live document tracking.
 *
 * `document-tracker` is the iOS-only Nitro plugin wrapping Apple's document
 * segmentation (see modules/document-tracker). Callers branch on availability
 * rather than Platform.OS, so the Android implementation can land natively
 * later with zero changes here — same seam pattern as document-scan.
 *
 * Availability is genuinely dynamic: on Android, and on any iOS build made
 * before the plugin existed, the hybrid object isn't registered and this
 * resolves null. The camera then simply keeps the static guide.
 *
 * The tracker is handed out BOXED because it's consumed inside the camera's
 * frame worklet — a different JS runtime. A HybridObject can only cross
 * runtimes through NitroModules.box(); the worklet calls .unbox() on its side.
 */
import { NitroModules, type BoxedHybridObject } from 'react-native-nitro-modules';

import type { DocumentTracker } from '../../../modules/document-tracker/src/specs/DocumentTracker.nitro';

export type { DetectedQuad, DocumentTracker } from '../../../modules/document-tracker/src/specs/DocumentTracker.nitro';

let cached: BoxedHybridObject<DocumentTracker> | null | undefined;

export function getBoxedDocumentTracker(): BoxedHybridObject<DocumentTracker> | null {
  if (cached === undefined) {
    try {
      cached = NitroModules.hasHybridObject('DocumentTracker')
        ? NitroModules.box(NitroModules.createHybridObject<DocumentTracker>('DocumentTracker'))
        : null;
    } catch {
      cached = null;
    }
  }
  return cached;
}
