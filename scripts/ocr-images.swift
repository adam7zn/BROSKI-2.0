#!/usr/bin/env swift

import AppKit
import CoreImage
import Foundation
import ImageIO
import Vision

struct OCRLine: Codable {
  let text: String
  let confidence: Float
  let boundingBox: [CGFloat]
}

func overlapRatio(_ lhs: OCRLine, _ rhs: OCRLine) -> CGFloat {
  let lhsRect = CGRect(
    x: lhs.boundingBox[0], y: lhs.boundingBox[1],
    width: lhs.boundingBox[2], height: lhs.boundingBox[3]
  )
  let rhsRect = CGRect(
    x: rhs.boundingBox[0], y: rhs.boundingBox[1],
    width: rhs.boundingBox[2], height: rhs.boundingBox[3]
  )
  let intersection = lhsRect.intersection(rhsRect)
  guard !intersection.isNull else { return 0 }
  let smallerArea = min(lhsRect.width * lhsRect.height, rhsRect.width * rhsRect.height)
  guard smallerArea > 0 else { return 0 }
  return intersection.width * intersection.height / smallerArea
}

func textQuality(_ line: OCRLine) -> Float {
  let suspicious = line.text.unicodeScalars.filter {
    $0.value == 0xFFFE || $0.value == 0xFFFD
      || CharacterSet.controlCharacters.contains($0)
  }.count
  return line.confidence - Float(suspicious) * 0.2
}

func deduplicateAndOrder(_ input: [OCRLine]) -> [OCRLine] {
  var deduplicated: [OCRLine] = []
  for line in input {
    if let index = deduplicated.firstIndex(where: {
      overlapRatio($0, line) >= 0.72
    }) {
      // Later Vision observations are often the corrected pass when confidence ties.
      if textQuality(line) >= textQuality(deduplicated[index]) {
        deduplicated[index] = line
      }
    } else {
      deduplicated.append(line)
    }
  }

  return deduplicated.sorted {
    let lhsTop = $0.boundingBox[1] + $0.boundingBox[3]
    let rhsTop = $1.boundingBox[1] + $1.boundingBox[3]
    let lhsRow = Int(((1 - lhsTop) / 0.012).rounded())
    let rhsRow = Int(((1 - rhsTop) / 0.012).rounded())
    if lhsRow != rhsRow { return lhsRow < rhsRow }
    return $0.boundingBox[0] < $1.boundingBox[0]
  }
}

struct OCRPage: Codable {
  let filePageNumber: Int
  let printedPageNumber: String?
  let imagePath: String
  let extractedText: String
  let confidence: Float
  let cropApplied: Bool
  let cropConfidence: Float?
  let cropBoundingBox: [CGFloat]?
  let lines: [OCRLine]
}

let ciContext = CIContext(options: [.useSoftwareRenderer: false])

func makeUprightImage(
  _ image: CGImage,
  orientationRaw: UInt32
) -> CGImage? {
  let oriented = CIImage(cgImage: image).oriented(
    forExifOrientation: Int32(orientationRaw)
  )
  return ciContext.createCGImage(oriented, from: oriented.extent)
}

func cropToDetectedPage(_ image: CGImage) -> (CGImage, Float?, [CGFloat]?) {
  let rectangleRequest = VNDetectRectanglesRequest()
  rectangleRequest.maximumObservations = 8
  rectangleRequest.minimumAspectRatio = 0.5
  rectangleRequest.maximumAspectRatio = 0.95
  rectangleRequest.minimumSize = 0.35
  rectangleRequest.minimumConfidence = 0.35
  rectangleRequest.quadratureTolerance = 45

  let handler = VNImageRequestHandler(cgImage: image, orientation: .up)
  do {
    try handler.perform([rectangleRequest])
  } catch {
    return (image, nil, nil)
  }

  guard let rectangle = rectangleRequest.results?.max(by: {
    ($0.boundingBox.width * $0.boundingBox.height)
      < ($1.boundingBox.width * $1.boundingBox.height)
  }) else {
    return (image, nil, nil)
  }

  let bounds = rectangle.boundingBox
  let boundingArea = bounds.width * bounds.height
  guard bounds.width >= 0.58, bounds.height >= 0.72, boundingArea >= 0.46 else {
    return (image, nil, nil)
  }

  let width = CGFloat(image.width)
  let height = CGFloat(image.height)
  let point: (CGPoint) -> CIVector = {
    CIVector(x: $0.x * width, y: $0.y * height)
  }
  let source = CIImage(cgImage: image)
  guard let filter = CIFilter(name: "CIPerspectiveCorrection") else {
    return (image, nil, nil)
  }
  filter.setValue(source, forKey: kCIInputImageKey)
  filter.setValue(point(rectangle.topLeft), forKey: "inputTopLeft")
  filter.setValue(point(rectangle.topRight), forKey: "inputTopRight")
  filter.setValue(point(rectangle.bottomLeft), forKey: "inputBottomLeft")
  filter.setValue(point(rectangle.bottomRight), forKey: "inputBottomRight")

  guard let corrected = filter.outputImage else { return (image, nil, nil) }
  let insetX = corrected.extent.width * 0.008
  let insetY = corrected.extent.height * 0.008
  let insetExtent = corrected.extent.insetBy(dx: insetX, dy: insetY)
  guard let cropped = ciContext.createCGImage(corrected, from: insetExtent) else {
    return (image, nil, nil)
  }
  return (
    cropped,
    rectangle.confidence,
    [bounds.origin.x, bounds.origin.y, bounds.width, bounds.height]
  )
}

func likelyPrintedOnPaper(_ line: OCRLine, bitmap: NSBitmapImageRep) -> Bool {
  let width = CGFloat(bitmap.pixelsWide)
  let height = CGFloat(bitmap.pixelsHigh)
  let box = line.boundingBox
  var brightness: [CGFloat] = []
  var saturation: [CGFloat] = []

  for xStep in 0..<7 {
    for yStep in 0..<2 {
      let normalizedX = box[0] + box[2] * CGFloat(xStep + 1) / 8
      let normalizedY = yStep == 0
        ? box[1] - box[3] * 0.45
        : box[1] + box[3] * 1.45
      let x = min(max(Int(normalizedX * width), 0), bitmap.pixelsWide - 1)
      let y = min(max(Int(normalizedY * height), 0), bitmap.pixelsHigh - 1)
      guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB)
      else { continue }
      brightness.append(color.brightnessComponent)
      saturation.append(color.saturationComponent)
    }
  }

  guard !brightness.isEmpty else { return true }
  brightness.sort()
  saturation.sort()
  let medianBrightness = brightness[brightness.count / 2]
  let medianSaturation = saturation[saturation.count / 2]
  return medianBrightness >= 0.42 && medianSaturation <= 0.48
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data("\(message)\n".utf8))
  exit(1)
}

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
  fail("Usage: ocr-images.swift <image-directory> <output-json>")
}

let inputDirectory = URL(fileURLWithPath: arguments[1]).standardizedFileURL
let outputURL = URL(fileURLWithPath: arguments[2]).standardizedFileURL
let fileManager = FileManager.default

guard let enumerator = fileManager.enumerator(
  at: inputDirectory,
  includingPropertiesForKeys: [.isRegularFileKey],
  options: [.skipsHiddenFiles]
) else {
  fail("Could not enumerate \(inputDirectory.path)")
}

let supportedExtensions = Set(["jpg", "jpeg", "png", "tif", "tiff", "heic"])
let imageURLs = enumerator.compactMap { item -> URL? in
  guard let url = item as? URL,
        supportedExtensions.contains(url.pathExtension.lowercased()) else {
    return nil
  }
  return url
}.sorted {
  $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending
}

guard !imageURLs.isEmpty else {
  fail("No supported images found in \(inputDirectory.path)")
}

var pages: [OCRPage] = []

for (offset, imageURL) in imageURLs.enumerated() {
  let filePageNumber = offset + 1
  FileHandle.standardError.write(
    Data("OCR \(filePageNumber)/\(imageURLs.count): \(imageURL.lastPathComponent)\n".utf8)
  )

  guard let imageSource = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
        let cgImage = CGImageSourceCreateImageAtIndex(imageSource, 0, nil) else {
    fail("Could not decode \(imageURL.path)")
  }

  let properties = CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil)
    as? [CFString: Any]
  let orientationRaw = properties?[kCGImagePropertyOrientation] as? UInt32 ?? 1
  guard let uprightImage = makeUprightImage(cgImage, orientationRaw: orientationRaw) else {
    fail("Could not orient \(imageURL.path)")
  }
  let (ocrImage, cropConfidence, cropBoundingBox) = cropToDetectedPage(uprightImage)

  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.recognitionLanguages = ["sv-SE", "en-US"]
  request.usesLanguageCorrection = true
  request.automaticallyDetectsLanguage = true
  request.minimumTextHeight = 0.004
  request.customWords = [
    "polynom", "polynomekvation", "polynomfunktion", "faktorisera",
    "rationella", "gränsvärde", "definitionsmängd", "värdemängd",
    "nollställe", "konjugatregeln", "kvadreringsreglerna"
  ]

  let handler = VNImageRequestHandler(cgImage: ocrImage, orientation: .up)
  do {
    try handler.perform([request])
  } catch {
    fail("Vision OCR failed for \(imageURL.path): \(error)")
  }

  let observations = request.results ?? []
  let rawLines = observations.compactMap { observation -> OCRLine? in
    guard let candidate = observation.topCandidates(1).first else { return nil }
    let box = observation.boundingBox
    return OCRLine(
      text: candidate.string,
      confidence: candidate.confidence,
      boundingBox: [box.origin.x, box.origin.y, box.size.width, box.size.height]
    )
  }
  // The collection contains two contents pages followed by printed pages 6-63.
  let printedPageNumber = filePageNumber <= 2 ? nil : String(filePageNumber + 3)
  let pageLines: [OCRLine]
  if cropConfidence == nil {
    let bitmap = NSBitmapImageRep(cgImage: ocrImage)
    pageLines = rawLines.filter { line in
      guard likelyPrintedOnPaper(line, bitmap: bitmap) else { return false }
      guard let printedPage = printedPageNumber.flatMap(Int.init) else { return true }
      let horizontalCenter = line.boundingBox[0] + line.boundingBox[2] / 2
      return printedPage.isMultiple(of: 2)
        ? horizontalCenter <= 0.88
        : horizontalCenter >= 0.12
    }
  } else {
    pageLines = rawLines
  }
  let lines = deduplicateAndOrder(pageLines)

  let totalCharacters = lines.reduce(0) { $0 + $1.text.count }
  let weightedConfidence: Float
  if totalCharacters == 0 {
    weightedConfidence = 0
  } else {
    weightedConfidence = lines.reduce(Float(0)) {
      $0 + $1.confidence * Float($1.text.count)
    } / Float(totalCharacters)
  }

  pages.append(
    OCRPage(
      filePageNumber: filePageNumber,
      printedPageNumber: printedPageNumber,
      imagePath: imageURL.path,
      extractedText: lines.map(\.text).joined(separator: "\n"),
      confidence: weightedConfidence,
      cropApplied: cropConfidence != nil,
      cropConfidence: cropConfidence,
      cropBoundingBox: cropBoundingBox,
      lines: lines
    )
  )
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
do {
  let data = try encoder.encode(pages)
  try fileManager.createDirectory(
    at: outputURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  try data.write(to: outputURL, options: .atomic)
} catch {
  fail("Could not write \(outputURL.path): \(error)")
}

print("Wrote OCR for \(pages.count) pages to \(outputURL.path)")
