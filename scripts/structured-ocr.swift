#!/usr/bin/env swift

import CoreGraphics
import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
import ImageIO
import Vision

struct RawBlock: Codable {
    let kind: String
    let transcript: String
    let boundingBox: [Double]
    let confidence: Double
}

struct RawPass: Codable {
    let name: String
    let blocks: [RawBlock]
}

struct RawPage: Codable {
    let filePageNumber: Int
    let printedPageNumber: String?
    let imagePath: String
    let width: Int
    let height: Int
    let perspectiveCorrected: Bool
    let passes: [RawPass]
}

enum ExtractorError: Error, CustomStringConvertible {
    case usage
    case unreadableImage(String)
    case noDocument(String)

    var description: String {
        switch self {
        case .usage:
            return "Usage: swift scripts/structured-ocr.swift --input <image-dir> --output <checkpoint-dir> [--pages 9,17,36]"
        case .unreadableImage(let path): return "Could not read image: \(path)"
        case .noDocument(let path): return "No document was recognized in: \(path)"
        }
    }
}

func argument(_ name: String) -> String? {
    guard let index = CommandLine.arguments.firstIndex(of: name),
          CommandLine.arguments.indices.contains(index + 1) else { return nil }
    return CommandLine.arguments[index + 1]
}

func normalizedTopLeft(_ rect: NormalizedRect) -> [Double] {
    [Double(rect.origin.x), Double(1 - rect.origin.y - rect.height),
     Double(rect.width), Double(rect.height)]
}

func confidence(_ text: DocumentObservation.Container.Text) -> Double {
    let values = text.lines.compactMap { $0.topCandidates(1).first?.confidence }
    return values.isEmpty ? 0 : Double(values.reduce(0, +) / Float(values.count))
}

func textBlock(_ text: DocumentObservation.Container.Text, kind: String) -> RawBlock {
    RawBlock(kind: kind, transcript: text.transcript,
             boundingBox: normalizedTopLeft(text.boundingRegion.boundingBox),
             confidence: confidence(text))
}

func tableBlock(_ table: DocumentObservation.Container.Table) -> RawBlock {
    let transcript = table.rows.map { row in
        "| " + row.map { $0.content.text.transcript.replacingOccurrences(of: "\n", with: " ") }
            .joined(separator: " | ") + " |"
    }.joined(separator: "\n")
    let values = table.rows.flatMap { $0 }.map { confidence($0.content.text) }
    return RawBlock(kind: "table", transcript: transcript,
                    boundingBox: normalizedTopLeft(table.boundingRegion.boundingBox),
                    confidence: values.isEmpty ? 0 : values.reduce(0, +) / Double(values.count))
}

func listBlock(_ list: DocumentObservation.Container.List) -> RawBlock {
    let transcript = list.items.map { item in
        let marker = item.markerString.isEmpty ? "-" : item.markerString
        return "\(marker) \(item.itemString)"
    }.joined(separator: "\n")
    let values = list.items.map { confidence($0.content.text) }
    return RawBlock(kind: "list", transcript: transcript,
                    boundingBox: normalizedTopLeft(list.boundingRegion.boundingBox),
                    confidence: values.isEmpty ? 0 : values.reduce(0, +) / Double(values.count))
}

func documentPass(_ image: CIImage, name: String) async throws -> RawPass {
    var request = RecognizeDocumentsRequest()
    request.textRecognitionOptions.recognitionLanguages = [
        Locale.Language(identifier: "sv-SE"), Locale.Language(identifier: "en-US")
    ]
    request.textRecognitionOptions.automaticallyDetectLanguage = true
    request.textRecognitionOptions.useLanguageCorrection = true
    request.textRecognitionOptions.maximumCandidateCount = 3
    guard let document = try await request.perform(on: image).first?.document else {
        throw ExtractorError.noDocument(name)
    }
    var blocks = document.paragraphs.map { textBlock($0, kind: "paragraph") }
    if let title = document.title { blocks.append(textBlock(title, kind: "title")) }
    blocks.append(contentsOf: document.tables.map(tableBlock))
    blocks.append(contentsOf: document.lists.map(listBlock))
    return RawPass(name: name, blocks: blocks)
}

func correctedImage(_ image: CIImage) async throws -> (CIImage, Bool) {
    let oriented = image.oriented(.up)
    guard let document = try await DetectDocumentSegmentationRequest().perform(on: oriented) else {
        return (oriented, false)
    }
    let size = oriented.extent.size
    let filter = CIFilter.perspectiveCorrection()
    filter.inputImage = oriented
    filter.topLeft = document.topLeft.toImageCoordinates(size)
    filter.topRight = document.topRight.toImageCoordinates(size)
    filter.bottomLeft = document.bottomLeft.toImageCoordinates(size)
    filter.bottomRight = document.bottomRight.toImageCoordinates(size)
    return (filter.outputImage ?? oriented, filter.outputImage != nil)
}

func enhance(_ image: CIImage) -> CIImage {
    let filter = CIFilter.colorControls()
    filter.inputImage = image
    filter.contrast = 1.35
    filter.brightness = 0.025
    filter.saturation = 0
    return filter.outputImage ?? image
}

func loadImage(_ url: URL) async throws -> CIImage {
    for attempt in 1...3 {
        if let image = CIImage(contentsOf: url, options: [.applyOrientationProperty: true]) {
            return image
        }
        if attempt < 3 {
            try await Task.sleep(for: .seconds(attempt))
        }
    }
    throw ExtractorError.unreadableImage(url.path)
}

func pageIdentity(_ url: URL, index: Int) -> (Int, String?) {
    let name = url.deletingPathExtension().lastPathComponent
    if name.hasPrefix("contents-") { return (index + 1, nil) }
    let printed = name.replacingOccurrences(of: "page-", with: "")
    return (index + 1, String(Int(printed) ?? index + 1))
}

func run() async throws {
    guard let inputValue = argument("--input"), let outputValue = argument("--output") else {
        throw ExtractorError.usage
    }
    let manager = FileManager.default
    let input = URL(fileURLWithPath: inputValue).standardizedFileURL
    let output = URL(fileURLWithPath: outputValue).standardizedFileURL
    try manager.createDirectory(at: output, withIntermediateDirectories: true)
    let selected = Set((argument("--pages") ?? "").split(separator: ",").map(String.init))
    guard let enumerator = manager.enumerator(at: input, includingPropertiesForKeys: nil) else {
        throw ExtractorError.unreadableImage(input.path)
    }
    let images = enumerator.compactMap { $0 as? URL }
        .filter { ["jpg", "jpeg", "png", "heic"].contains($0.pathExtension.lowercased()) }
        .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]

    for (index, url) in images.enumerated() {
        let identity = pageIdentity(url, index: index)
        let selectionKeys = [url.deletingPathExtension().lastPathComponent,
                             identity.1 ?? "contents-\(identity.0)"]
        if !selected.isEmpty && selected.isDisjoint(with: selectionKeys) { continue }
        let checkpoint = output.appendingPathComponent(
            String(format: "page-%03d.json", identity.0))
        if manager.fileExists(atPath: checkpoint.path) {
            print("resume \(url.lastPathComponent)")
            continue
        }
        let source = try await loadImage(url)
        let (corrected, perspectiveCorrected) = try await correctedImage(source)
        let original = try await documentPass(corrected, name: "original")
        let contrast = try await documentPass(enhance(corrected), name: "contrast")
        let page = RawPage(filePageNumber: identity.0, printedPageNumber: identity.1,
                           imagePath: url.path, width: Int(corrected.extent.width),
                           height: Int(corrected.extent.height),
                           perspectiveCorrected: perspectiveCorrected,
                           passes: [original, contrast])
        let temporary = checkpoint.appendingPathExtension("tmp")
        try encoder.encode(page).write(to: temporary, options: .atomic)
        try manager.moveItem(at: temporary, to: checkpoint)
        print("extracted \(url.lastPathComponent)")
    }
}

do {
    try await run()
} catch {
    FileHandle.standardError.write(Data("\(error)\n".utf8))
    exit(1)
}
