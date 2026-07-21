//
//  HybridDocumentTracker.swift
//  DocumentTracker
//
//  Per-frame document-corner detection: VNDetectDocumentSegmentationRequest on
//  a VisionCamera Frame's pixel buffer. Runs on the camera's frame thread —
//  synchronous, allocation-light, no dispatch.
//

import AVFoundation
import Foundation
import NitroModules
import Vision
import VisionCamera

final class HybridDocumentTracker: HybridDocumentTrackerSpec {
  // One request, reused across frames. The request object is stateless between
  // performs (its `results` are overwritten each time), so allocating a fresh
  // one per frame was pure churn — this trims per-frame work on the hot path.
  private let request = VNDetectDocumentSegmentationRequest()

  func detect(frame: any HybridFrameSpec) throws -> DetectedQuad? {
    // The spec protocol exposes width/height/orientation directly; only the
    // raw buffer needs the NativeFrame downcast (VisionCamera's public seam
    // for exactly this).
    guard let native = frame as? any NativeFrame,
          let sampleBuffer = native.sampleBuffer,
          let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      return nil
    }

    let orientation = Self.exifOrientation(for: frame.orientation)
    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: orientation, options: [:])

    do {
      try handler.perform([request])
    } catch {
      return nil // a failed frame is just "nothing seen" — never crash the camera thread
    }

    guard let page = request.results?.first else {
      return nil
    }

    // Because the handler was given the orientation, Vision's corners are
    // normalised in the UPRIGHT image space (bottom-left origin). Report the
    // upright pixel size for the JS-side aspect-fill mapping: a 90° rotation
    // swaps the buffer's width and height.
    let rotated = frame.orientation == .left || frame.orientation == .right
    let uprightWidth = rotated ? frame.height : frame.width
    let uprightHeight = rotated ? frame.width : frame.height

    // Flip Y so JS receives ordinary top-left-origin coordinates.
    return DetectedQuad(
      topLeftX: page.topLeft.x,
      topLeftY: 1.0 - page.topLeft.y,
      topRightX: page.topRight.x,
      topRightY: 1.0 - page.topRight.y,
      bottomRightX: page.bottomRight.x,
      bottomRightY: 1.0 - page.bottomRight.y,
      bottomLeftX: page.bottomLeft.x,
      bottomLeftY: 1.0 - page.bottomLeft.y,
      uprightWidth: uprightWidth,
      uprightHeight: uprightHeight,
      confidence: Double(page.confidence)
    )
  }

  /**
   * VisionCamera's CameraOrientation → the EXIF orientation Vision needs.
   *
   * NB: this mapping is the one place a device test can prove me wrong — if
   * the live quad comes back rotated 90°, swap `.left` and `.right` here and
   * nothing else.
   */
  private static func exifOrientation(for orientation: CameraOrientation) -> CGImagePropertyOrientation {
    switch orientation {
    case .up: return .up
    case .right: return .right
    case .down: return .down
    case .left: return .left
    }
  }
}
