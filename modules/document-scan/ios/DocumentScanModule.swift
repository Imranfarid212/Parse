import CoreImage
import ExpoModulesCore
import UIKit
import Vision

/**
 * DocumentScan — finds the document in a still and flattens it.
 *
 * Runs `VNDetectDocumentSegmentationRequest`, Apple's on-device document
 * segmentation. It returns the four corners of the page as a quadrilateral, not
 * an axis-aligned box, which is what makes perspective correction possible: a
 * receipt is almost never photographed square-on, and a deskewed, cropped page
 * is dramatically easier for /extract to read than a trapezoid floating in a
 * photo of a table.
 *
 * Everything here is on-device — no network, no per-scan cost.
 *
 * COORDINATE SPACES, because they bite:
 *  · Vision returns corners NORMALISED (0...1) with a BOTTOM-LEFT origin.
 *  · CIPerspectiveCorrection also works bottom-left, in PIXELS.
 * So corners multiply straight through by extent, with no Y flip — UIKit's
 * top-left origin never enters into it. The normalised corners handed back to
 * JS stay in Vision's space so a future live overlay can reuse them.
 */
public class DocumentScanModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DocumentScan")

    /** Whether document detection exists on this device. */
    Function("isAvailable") { () -> Bool in
      if #available(iOS 15.0, *) { return true }
      return false
    }

    /**
     * Detect the document in `uri` and return a flattened copy.
     * Resolves `nil` when no document is found, so callers fall back to the
     * original frame rather than failing the scan.
     */
    AsyncFunction("detectAndCorrect") { (uri: String, promise: Promise) in
      guard #available(iOS 15.0, *) else {
        promise.resolve(nil)
        return
      }
      guard let url = URL(string: uri) ?? URL(string: "file://\(uri)") else {
        promise.reject("ERR_BAD_URI", "Could not parse \(uri)")
        return
      }

      DispatchQueue.global(qos: .userInitiated).async {
        do {
          guard let data = try? Data(contentsOf: url),
                let uiImage = UIImage(data: data),
                let cgImage = uiImage.cgImage else {
            promise.reject("ERR_LOAD", "Could not decode image at \(uri)")
            return
          }

          // Hand Vision the EXIF orientation, then bake that same orientation
          // into the CIImage. If those two disagree, the corners come back
          // rotated relative to the pixels and the warp is garbage.
          let orientation = Self.propertyOrientation(from: uiImage.imageOrientation)
          let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])

          let request = VNDetectDocumentSegmentationRequest()
          try handler.perform([request])

          guard let page = request.results?.first as? VNRectangleObservation else {
            promise.resolve(nil) // no document — caller keeps the original
            return
          }

          let source = CIImage(cgImage: cgImage).oriented(orientation)
          let extent = source.extent

          func denormalise(_ p: CGPoint) -> CIVector {
            CIVector(x: extent.origin.x + p.x * extent.width,
                     y: extent.origin.y + p.y * extent.height)
          }

          guard let filter = CIFilter(name: "CIPerspectiveCorrection") else {
            promise.reject("ERR_FILTER", "CIPerspectiveCorrection unavailable")
            return
          }
          filter.setValue(source, forKey: kCIInputImageKey)
          filter.setValue(denormalise(page.topLeft), forKey: "inputTopLeft")
          filter.setValue(denormalise(page.topRight), forKey: "inputTopRight")
          filter.setValue(denormalise(page.bottomLeft), forKey: "inputBottomLeft")
          filter.setValue(denormalise(page.bottomRight), forKey: "inputBottomRight")

          guard let output = filter.outputImage else {
            promise.reject("ERR_WARP", "Perspective correction produced no image")
            return
          }

          let context = CIContext(options: [.useSoftwareRenderer: false])
          guard let outCG = context.createCGImage(output, from: output.extent) else {
            promise.reject("ERR_RENDER", "Could not rasterise corrected image")
            return
          }

          // 0.95: this crop is about to be downscaled for /extract, and JPEG
          // ringing on small print is the one artefact that costs us accuracy.
          guard let jpeg = UIImage(cgImage: outCG).jpegData(compressionQuality: 0.95) else {
            promise.reject("ERR_ENCODE", "Could not encode corrected image")
            return
          }

          let out = FileManager.default.temporaryDirectory
            .appendingPathComponent("scan-\(UUID().uuidString).jpg")
          try jpeg.write(to: out)

          promise.resolve([
            "uri": out.absoluteString,
            "confidence": page.confidence,
            "corners": [
              ["x": page.topLeft.x, "y": page.topLeft.y],
              ["x": page.topRight.x, "y": page.topRight.y],
              ["x": page.bottomRight.x, "y": page.bottomRight.y],
              ["x": page.bottomLeft.x, "y": page.bottomLeft.y],
            ],
          ])
        } catch {
          promise.reject("ERR_DETECT", error.localizedDescription)
        }
      }
    }
  }

  private static func propertyOrientation(from orientation: UIImage.Orientation) -> CGImagePropertyOrientation {
    switch orientation {
    case .up: return .up
    case .down: return .down
    case .left: return .left
    case .right: return .right
    case .upMirrored: return .upMirrored
    case .downMirrored: return .downMirrored
    case .leftMirrored: return .leftMirrored
    case .rightMirrored: return .rightMirrored
    @unknown default: return .up
    }
  }
}
