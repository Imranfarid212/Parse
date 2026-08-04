import AppKit
import Foundation

struct Receipt: Decodable {
  let id: String
  let text: String
}

let outputDirectory = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "")
let input = FileHandle.standardInput.readDataToEndOfFile()
let receipts = try JSONDecoder().decode([Receipt].self, from: input)
let bodyFont = NSFont.monospacedSystemFont(ofSize: 31, weight: .regular)
let strongFont = NSFont.monospacedSystemFont(ofSize: 33, weight: .bold)
let dark = NSColor(calibratedWhite: 0.06, alpha: 1)
let background = NSColor(calibratedWhite: 0.90, alpha: 1)
let paper = NSColor(calibratedRed: 1, green: 0.996, blue: 0.98, alpha: 1)

try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
for receipt in receipts {
  let lines = receipt.text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
  let height = max(760, 120 + lines.count * 48 + 72)
  let size = NSSize(width: 1240, height: height)
  let image = NSImage(size: size)
  image.lockFocus()
  background.setFill()
  NSRect(origin: .zero, size: size).fill()
  paper.setFill()
  let receiptRect = NSRect(x: 56, y: 34, width: 1128, height: height - 68)
  let paperPath = NSBezierPath(roundedRect: receiptRect, xRadius: 5, yRadius: 5)
  paperPath.fill()
  NSColor(calibratedWhite: 0.72, alpha: 1).setStroke()
  paperPath.lineWidth = 3
  paperPath.stroke()
  for (index, line) in lines.enumerated() {
    let emphasized = index == 0 || line.contains("TOTAL") || line.contains("AMOUNT DUE") || line.contains("GESAMT") || line.contains("PAID ")
    let attributes: [NSAttributedString.Key: Any] = [.font: emphasized ? strongFont : bodyFont, .foregroundColor: dark]
    let y = height - 112 - index * 48
    line.draw(at: NSPoint(x: 92, y: y), withAttributes: attributes)
  }
  image.unlockFocus()
  guard let tiff = image.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiff),
        let jpeg = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.90]) else {
    throw NSError(domain: "ReceiptFlow", code: 1, userInfo: [NSLocalizedDescriptionKey: "could not encode \(receipt.id)"])
  }
  try jpeg.write(to: outputDirectory.appendingPathComponent("\(receipt.id).jpg"))
}
