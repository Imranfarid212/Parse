/**
 * DocumentScan — on-device document detection and perspective correction.
 *
 * iOS runs Apple's Vision document segmentation; Android is a stub that reports
 * unavailable (see the Kotlin module for why). Callers branch on
 * `isDocumentScanAvailable()` rather than on `Platform.OS`, so the Android
 * implementation can land later without touching any calling code.
 */
import { NativeModule, requireNativeModule } from 'expo';

/** A corner, normalised 0…1 in Vision's space: origin BOTTOM-LEFT. */
export type Corner = { x: number; y: number };

export type DocumentScanResult = {
  /** `file://` URI of the deskewed, cropped page. */
  uri: string;
  /** Vision's confidence in the detection, 0…1. */
  confidence: number;
  /** Page corners, clockwise from top-left. */
  corners: [Corner, Corner, Corner, Corner];
};

declare class DocumentScanNativeModule extends NativeModule<{}> {
  isAvailable(): boolean;
  detectAndCorrect(uri: string): Promise<DocumentScanResult | null>;
  recognizeText(uri: string): Promise<string | null>;
}

const DocumentScan = requireNativeModule<DocumentScanNativeModule>('DocumentScan');

export function isDocumentScanAvailable(): boolean {
  try {
    return DocumentScan.isAvailable();
  } catch {
    // Older build without the native module compiled in.
    return false;
  }
}

/**
 * Detect the document in `uri` and return a flattened copy.
 *
 * Resolves `null` when there's no document, the platform can't do it, or
 * anything goes wrong. A failed detection must never fail the scan — the caller
 * simply keeps the original photo, which is exactly what shipped before this
 * existed.
 */
export async function detectAndCorrect(uri: string): Promise<DocumentScanResult | null> {
  try {
    return await DocumentScan.detectAndCorrect(uri);
  } catch {
    return null;
  }
}

export async function recognizeText(uri: string): Promise<string | null> {
  try {
    return await DocumentScan.recognizeText(uri);
  } catch {
    return null;
  }
}
