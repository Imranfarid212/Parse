package expo.modules.documentscan

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android stub.
 *
 * Deliberately present and deliberately inert. iOS has a document-segmentation
 * primitive (`VNDetectDocumentSegmentationRequest`) that hands back four page
 * corners; Android has no equivalent — ML Kit only ships a whole scanner UI,
 * not a per-image call — so a real implementation means OpenCV or a TFLite
 * model, which is its own piece of work.
 *
 * Existing so callers can invoke the same API on both platforms and branch on
 * `isAvailable()` rather than on `Platform.OS`. When the Android detector is
 * written it drops in here, and no JavaScript changes.
 */
class DocumentScanModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DocumentScan")

    Function("isAvailable") {
      false
    }

    AsyncFunction("detectAndCorrect") { _: String ->
      null
    }
  }
}
