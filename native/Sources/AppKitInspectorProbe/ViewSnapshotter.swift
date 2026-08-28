import AppKit
import Foundation
@preconcurrency import ScreenCaptureKit

@MainActor
enum ViewSnapshotter {
    private struct CaptureContext {
        let window: NSWindow
        let contentView: NSView
        let rootView: NSView
        let scope: ProbeCaptureScope
    }

    static func snapshot(
        target: ProbeTarget,
        scope: ProbeCaptureScope = .windowFrame,
        mode: ProbeCaptureMode = .hybrid
    ) async throws -> ProbeSnapshot {
        let context = try captureContext(scope: scope)
        let rootView = context.rootView
        rootView.displayIfNeeded()
        guard let bitmap = rootView.bitmapImageRepForCachingDisplay(in: rootView.bounds) else {
            throw ProbeError.captureFailed
        }
        rootView.cacheDisplay(in: rootView.bounds, to: bitmap)
        let rootNode = viewNode(rootView, relativeTo: rootView, window: context.window)
        let capture = try await capturePNG(context: context, bitmap: bitmap, mode: mode)

        return ProbeSnapshot(
            schemaVersion: 4,
            target: target,
            window: ProbeWindow(
                id: objectID(context.window),
                title: context.window.title,
                frame: ProbeRect(rootView.bounds),
                contentFrame: ProbeRect(contentLayoutFrame(context: context)),
                captureScope: context.scope,
                requestedCaptureMode: mode,
                captureRendering: capture.rendering,
                captureFallbackReason: capture.fallbackReason
            ),
            imageDataURL: "data:image/png;base64,\(capture.png.base64EncodedString())",
            root: rootNode
        )
    }

    static func inspectPoint(
        x: Double,
        y: Double,
        target: ProbeTarget,
        scope: ProbeCaptureScope = .windowFrame,
        mode: ProbeCaptureMode = .hybrid
    ) async throws -> ProbeInspectResult {
        let context = try captureContext(scope: scope)
        let rootView = context.rootView
        let point = CGPoint(
            x: rootView.bounds.width * min(max(x, 0), 1),
            y: rootView.bounds.height * (1 - min(max(y, 0), 1))
        )
        let hitView = rootView.hitTest(point) ?? rootView
        var ancestors: [String] = []
        var cursor: NSView? = hitView
        while let view = cursor {
            ancestors.append(NSStringFromClass(type(of: view)))
            if view === rootView { break }
            cursor = view.superview
        }
        return ProbeInspectResult(
            snapshot: try await snapshot(target: target, scope: context.scope, mode: mode),
            node: viewNode(hitView, relativeTo: rootView, window: context.window),
            ancestorPath: ancestors.reversed()
        )
    }

    static func viewNode(_ view: NSView, relativeTo rootView: NSView, window: NSWindow) -> ProbeViewNode {
        let frame = view === rootView ? rootView.bounds : view.convert(view.bounds, to: rootView)
        var subviews = view.subviews.map { viewNode($0, relativeTo: rootView, window: window) }
        if let headerView = view as? NSTableHeaderView {
            subviews.append(contentsOf: tableHeaderCellNodes(headerView, relativeTo: rootView))
        }
        return ProbeViewNode(
            id: objectID(view),
            className: NSStringFromClass(type(of: view)),
            frame: ProbeRect(frame),
            bounds: ProbeRect(view.bounds),
            hidden: view.isHidden,
            alpha: view.alphaValue,
            identifier: view.identifier?.rawValue,
            label: semanticLabel(for: view, window: window) ?? view.accessibilityLabel(),
            role: view.accessibilityRole()?.rawValue,
            subviews: subviews
        )
    }

    static func tableHeaderCellNodes(
        _ headerView: NSTableHeaderView,
        relativeTo rootView: NSView
    ) -> [ProbeViewNode] {
        guard let tableView = headerView.tableView else { return [] }
        return tableView.tableColumns.enumerated().compactMap { element -> ProbeViewNode? in
            let (index, column) = element
            guard !column.isHidden else { return nil }
            let localFrame = headerView.headerRect(ofColumn: index)
            guard localFrame.width >= 2, localFrame.height >= 2 else { return nil }
            let frame = headerView.convert(localFrame, to: rootView)
            let identifier = column.identifier.rawValue
            return ProbeViewNode(
                id: "\(objectID(headerView)):header:\(index):\(identifier)",
                className: "NSTableHeaderCell",
                frame: ProbeRect(frame),
                bounds: ProbeRect(
                    x: 0,
                    y: 0,
                    width: localFrame.width,
                    height: localFrame.height
                ),
                hidden: false,
                alpha: Double(headerView.alphaValue),
                identifier: identifier.isEmpty ? nil : identifier,
                label: column.title.isEmpty ? identifier : column.title,
                role: "AXColumnHeader",
                subviews: []
            )
        }
    }

    private static func captureContext(scope: ProbeCaptureScope) throws -> CaptureContext {
        guard let window = NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first(where: { $0.isVisible }),
              let contentView = window.contentView
        else {
            throw ProbeError.noVisibleWindow
        }
        let rootView: NSView
        let actualScope: ProbeCaptureScope
        if scope == .windowFrame, let frameView = contentView.superview, frameView.window === window {
            rootView = frameView
            actualScope = .windowFrame
        } else {
            rootView = contentView
            actualScope = .content
        }
        return CaptureContext(
            window: window,
            contentView: contentView,
            rootView: rootView,
            scope: actualScope
        )
    }

    private static func contentLayoutFrame(context: CaptureContext) -> NSRect {
        guard context.scope == .windowFrame else { return context.contentView.bounds }
        return context.rootView.convert(context.window.contentLayoutRect, from: nil)
    }

    private struct CaptureResult {
        let png: Data
        let rendering: ProbeCaptureRendering
        let fallbackReason: String?
    }

    private static func capturePNG(
        context: CaptureContext,
        bitmap: NSBitmapImageRep,
        mode: ProbeCaptureMode
    ) async throws -> CaptureResult {
        if context.scope == .windowFrame, mode == .exact {
            do {
                let png = try await exactWindowFramePNG(context: context)
                return CaptureResult(
                    png: png,
                    rendering: .windowServerExact,
                    fallbackReason: nil
                )
            } catch {
                guard let png = hybridWindowFramePNG(context: context, cachedBitmap: bitmap) else {
                    throw error
                }
                let reason = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                return CaptureResult(
                    png: png,
                    rendering: .windowFrameHybrid,
                    fallbackReason: reason
                )
            }
        }
        if context.scope == .windowFrame,
           let png = hybridWindowFramePNG(context: context, cachedBitmap: bitmap) {
            return CaptureResult(
                png: png,
                rendering: .windowFrameHybrid,
                fallbackReason: nil
            )
        }
        guard let png = bitmap.representation(using: .png, properties: [:]) else {
            throw ProbeError.captureFailed
        }
        return CaptureResult(png: png, rendering: .viewCache, fallbackReason: nil)
    }

    private static func exactWindowFramePNG(context: CaptureContext) async throws -> Data {
        guard #available(macOS 14.4, *) else {
            throw ProbeError.exactCaptureUnavailable("Exact Window requires macOS 14.4 or later")
        }

        let content = try await currentProcessShareableContent()
        let windowID = CGWindowID(context.window.windowNumber)
        guard let capturedWindow = content.windows.first(where: { $0.windowID == windowID }) else {
            throw ProbeError.exactCaptureUnavailable("The current AppKit window is not available to ScreenCaptureKit")
        }

        let configuration = SCStreamConfiguration()
        let scale = max(1, context.window.backingScaleFactor)
        configuration.width = max(1, Int((context.rootView.bounds.width * scale).rounded()))
        configuration.height = max(1, Int((context.rootView.bounds.height * scale).rounded()))
        configuration.scalesToFit = true
        configuration.preservesAspectRatio = true
        configuration.showsCursor = false
        configuration.ignoreShadowsSingleWindow = true
        configuration.captureResolution = .best

        let filter = SCContentFilter(desktopIndependentWindow: capturedWindow)
        let image = try await captureImage(filter: filter, configuration: configuration)
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let png = bitmap.representation(using: .png, properties: [:]) else {
            throw ProbeError.captureFailed
        }
        return png
    }

    @available(macOS 14.4, *)
    private static func currentProcessShareableContent() async throws -> SCShareableContent {
        try await withCheckedThrowingContinuation { continuation in
            SCShareableContent.getCurrentProcessShareableContent { content, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let content {
                    continuation.resume(returning: content)
                } else {
                    continuation.resume(
                        throwing: ProbeError.exactCaptureUnavailable(
                            "ScreenCaptureKit returned no current-process content"
                        )
                    )
                }
            }
        }
    }

    @available(macOS 14.4, *)
    private static func captureImage(
        filter: SCContentFilter,
        configuration: SCStreamConfiguration
    ) async throws -> CGImage {
        try await withCheckedThrowingContinuation { continuation in
            SCScreenshotManager.captureImage(
                contentFilter: filter,
                configuration: configuration
            ) { image, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let image {
                    continuation.resume(returning: image)
                } else {
                    continuation.resume(
                        throwing: ProbeError.exactCaptureUnavailable(
                            "ScreenCaptureKit returned no window image"
                        )
                    )
                }
            }
        }
    }

    private static func hybridWindowFramePNG(
        context: CaptureContext,
        cachedBitmap: NSBitmapImageRep
    ) -> Data? {
        let rootView = context.rootView
        let bounds = rootView.bounds
        let contentLayoutFrame = contentLayoutFrame(context: context)
        let frameArea = NSRect(
            x: bounds.minX,
            y: max(bounds.minY, contentLayoutFrame.maxY),
            width: bounds.width,
            height: max(0, bounds.maxY - contentLayoutFrame.maxY)
        )
        guard frameArea.height > 0,
              let pdfImage = NSImage(data: context.window.dataWithPDF(inside: bounds))
        else {
            return nil
        }

        let cachedImage = NSImage(size: bounds.size)
        cachedImage.addRepresentation(cachedBitmap)
        let output = NSImage(size: bounds.size)
        output.lockFocus()
        cachedImage.draw(in: bounds)
        pdfImage.draw(in: frameArea, from: frameArea, operation: .copy, fraction: 1)
        restoreToolbarControlContent(
            window: context.window,
            rootView: rootView,
            frameArea: frameArea
        )
        restoreStandardWindowButtons(
            window: context.window,
            rootView: rootView,
            cachedImage: cachedImage
        )
        output.unlockFocus()

        guard let tiff = output.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff)
        else {
            return nil
        }
        return bitmap.representation(using: .png, properties: [:])
    }

    private static func restoreToolbarControlContent(
        window: NSWindow,
        rootView: NSView,
        frameArea: NSRect
    ) {
        let standardButtons = Set(
            [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton, .toolbarButton]
                .compactMap { window.standardWindowButton($0).map(ObjectIdentifier.init) }
        )
        for view in descendants(of: rootView) {
            guard let button = view as? NSButton,
                  !standardButtons.contains(ObjectIdentifier(button)),
                  !button.isHidden,
                  button.alphaValue > 0,
                  !hasSearchFieldAncestor(button),
                  let image = button.image
            else {
                continue
            }
            let frame = button.convert(button.bounds, to: rootView)
            guard frame.intersects(frameArea) else { continue }
            let side = min(18, max(8, min(frame.width, frame.height) - 8))
            let imageFrame = NSRect(
                x: frame.midX - side / 2,
                y: frame.midY - side / 2,
                width: side,
                height: side
            )
            let renderedImage = image.isTemplate
                ? image.withSymbolConfiguration(.init(hierarchicalColor: .labelColor)) ?? image
                : image
            renderedImage.draw(
                in: imageFrame,
                from: .zero,
                operation: .sourceOver,
                fraction: button.alphaValue,
                respectFlipped: false,
                hints: [.interpolation: NSImageInterpolation.high]
            )
        }
    }

    private static func descendants(of view: NSView) -> [NSView] {
        view.subviews + view.subviews.flatMap(descendants)
    }

    private static func hasSearchFieldAncestor(_ view: NSView) -> Bool {
        var cursor = view.superview
        while let ancestor = cursor {
            if ancestor is NSSearchField { return true }
            cursor = ancestor.superview
        }
        return false
    }

    private static func restoreStandardWindowButtons(
        window: NSWindow,
        rootView: NSView,
        cachedImage: NSImage
    ) {
        let buttonTypes: [NSWindow.ButtonType] = [.closeButton, .miniaturizeButton, .zoomButton]
        for buttonType in buttonTypes {
            guard let button = window.standardWindowButton(buttonType), !button.isHidden else { continue }
            let frame = button.convert(button.bounds, to: rootView)
            NSGraphicsContext.saveGraphicsState()
            NSBezierPath(ovalIn: frame).addClip()
            cachedImage.draw(in: frame, from: frame, operation: .copy, fraction: 1)
            NSGraphicsContext.restoreGraphicsState()
        }
    }

    private static func semanticLabel(for view: NSView, window: NSWindow) -> String? {
        if view === window.standardWindowButton(.closeButton) { return "Close Window" }
        if view === window.standardWindowButton(.miniaturizeButton) { return "Minimize Window" }
        if view === window.standardWindowButton(.zoomButton) { return "Zoom Window" }
        if view === window.standardWindowButton(.toolbarButton) { return "Show or Hide Toolbar" }
        return nil
    }

    private static func objectID(_ object: AnyObject) -> String {
        String(UInt(bitPattern: ObjectIdentifier(object)), radix: 16)
    }
}

enum ProbeError: LocalizedError {
    case noVisibleWindow
    case captureFailed
    case exactCaptureUnavailable(String)
    case socket(String)
    case invalidRequest
    case unauthorized

    var errorDescription: String? {
        switch self {
        case .noVisibleWindow: "No visible AppKit window is available"
        case .captureFailed: "Unable to capture the AppKit window"
        case let .exactCaptureUnavailable(message): message
        case let .socket(message): message
        case .invalidRequest: "Invalid probe request"
        case .unauthorized: "Probe request token is invalid"
        }
    }
}
