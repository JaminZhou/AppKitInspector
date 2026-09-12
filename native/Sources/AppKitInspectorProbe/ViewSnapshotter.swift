import AppKit
import Foundation
@preconcurrency import ScreenCaptureKit

@MainActor
enum ViewSnapshotter {
    private struct CaptureContext {
        let window: NSWindow
        let kind: ProbeWindowKind
        let contentView: NSView
        let frameView: NSView
        let rootView: NSView
        let scope: ProbeCaptureScope
    }

    static func snapshot(
        target: ProbeTarget,
        scope: ProbeCaptureScope = .windowFrame,
        mode: ProbeCaptureMode = .exact,
        activation: ProbeCaptureActivation = .current,
        windowID: String? = nil
    ) async throws -> ProbeSnapshot {
        let context = try captureContext(scope: scope, windowID: windowID)
        return try await withCaptureActivation(activation, context: context) {
            try await makeSnapshot(
                target: target,
                context: context,
                mode: mode,
                activation: activation
            )
        }
    }

    private static func makeSnapshot(
        target: ProbeTarget,
        context: CaptureContext,
        mode: ProbeCaptureMode,
        activation: ProbeCaptureActivation
    ) async throws -> ProbeSnapshot {
        let rootView = context.rootView
        rootView.displayIfNeeded()
        guard let bitmap = rootView.bitmapImageRepForCachingDisplay(in: rootView.bounds) else {
            throw ProbeError.captureFailed
        }
        rootView.cacheDisplay(in: rootView.bounds, to: bitmap)
        let rootNode = viewNode(rootView, relativeTo: rootView, window: context.window)
        let capture = try await capturePNG(context: context, bitmap: bitmap, mode: mode)

        return ProbeSnapshot(
            schemaVersion: 6,
            target: target,
            window: ProbeWindow(
                id: objectID(context.window),
                title: windowTitle(context.window, kind: context.kind),
                kind: context.kind,
                frame: ProbeRect(rootView.bounds),
                contentFrame: ProbeRect(contentLayoutFrame(context: context)),
                captureScope: context.scope,
                requestedCaptureMode: mode,
                requestedCaptureActivation: activation,
                capturedWindowWasActive: NSApp.isActive && (
                    context.window.isKeyWindow ||
                    ((context.kind == .popover || context.kind == .panel) && context.window.isVisible)
                ),
                captureRendering: capture.rendering,
                captureFallbackReason: capture.fallbackReason
            ),
            availableWindows: windowList().windows,
            imageDataURL: "data:image/png;base64,\(capture.png.base64EncodedString())",
            root: rootNode
        )
    }

    static func inspectPoint(
        x: Double,
        y: Double,
        target: ProbeTarget,
        scope: ProbeCaptureScope = .windowFrame,
        mode: ProbeCaptureMode = .exact,
        activation: ProbeCaptureActivation = .current,
        windowID: String? = nil
    ) async throws -> ProbeInspectResult {
        let context = try captureContext(scope: scope, windowID: windowID)
        return try await withCaptureActivation(activation, context: context) {
            let rootView = context.rootView
            let point = CGPoint(
                x: rootView.bounds.width * min(max(x, 0), 1),
                y: rootView.bounds.height * (1 - min(max(y, 0), 1))
            )
            let hitView = standardWindowControl(
                at: point,
                in: rootView,
                window: context.window
            ) ?? rootView.hitTest(point) ?? rootView
            var ancestors: [String] = []
            var cursor: NSView? = hitView
            while let view = cursor {
                ancestors.append(NSStringFromClass(type(of: view)))
                if view === rootView { break }
                cursor = view.superview
            }
            return ProbeInspectResult(
                snapshot: try await makeSnapshot(
                    target: target,
                    context: context,
                    mode: mode,
                    activation: activation
                ),
                node: viewNode(hitView, relativeTo: rootView, window: context.window),
                ancestorPath: ancestors.reversed()
            )
        }
    }

    private static func withCaptureActivation<Value>(
        _ activation: ProbeCaptureActivation,
        context: CaptureContext,
        operation: () async throws -> Value
    ) async throws -> Value {
        guard activation == .active else {
            return try await operation()
        }

        let applicationWasActive = NSApp.isActive
        let previousFrontmostApplication = NSWorkspace.shared.frontmostApplication
        let previousKeyWindow = NSApp.keyWindow
        let windowWasKey = context.window.isKeyWindow
        let requiresKeyWindow = context.kind != .popover && context.kind != .panel

        if !applicationWasActive || (requiresKeyWindow && !windowWasKey) {
            if requiresKeyWindow {
                context.window.makeKeyAndOrderFront(nil)
            }
            if let previousFrontmostApplication,
               previousFrontmostApplication.processIdentifier != ProcessInfo.processInfo.processIdentifier {
                _ = NSRunningApplication.current.activate(
                    from: previousFrontmostApplication,
                    options: []
                )
            } else {
                NSApp.activate()
            }

            guard await waitForActiveWindow(
                context.window,
                requiresKeyWindow: requiresKeyWindow
            ) else {
                await restoreActivation(
                    applicationWasActive: applicationWasActive,
                    previousFrontmostApplication: previousFrontmostApplication,
                    previousKeyWindow: previousKeyWindow,
                    windowWasKey: windowWasKey
                )
                throw ProbeError.activeCaptureUnavailable
            }
            context.window.displayIfNeeded()
            await Task.yield()
        }

        do {
            let value = try await operation()
            await restoreActivation(
                applicationWasActive: applicationWasActive,
                previousFrontmostApplication: previousFrontmostApplication,
                previousKeyWindow: previousKeyWindow,
                windowWasKey: windowWasKey
            )
            return value
        } catch {
            await restoreActivation(
                applicationWasActive: applicationWasActive,
                previousFrontmostApplication: previousFrontmostApplication,
                previousKeyWindow: previousKeyWindow,
                windowWasKey: windowWasKey
            )
            throw error
        }
    }

    private static func waitForActiveWindow(
        _ window: NSWindow,
        requiresKeyWindow: Bool
    ) async -> Bool {
        for _ in 0..<60 {
            if NSApp.isActive && (!requiresKeyWindow || window.isKeyWindow) && window.isVisible {
                return true
            }
            try? await Task.sleep(for: .milliseconds(16))
        }
        return NSApp.isActive && (!requiresKeyWindow || window.isKeyWindow) && window.isVisible
    }

    private static func restoreActivation(
        applicationWasActive: Bool,
        previousFrontmostApplication: NSRunningApplication?,
        previousKeyWindow: NSWindow?,
        windowWasKey: Bool
    ) async {
        if applicationWasActive {
            if !windowWasKey, let previousKeyWindow {
                previousKeyWindow.makeKey()
            }
            return
        }
        guard let previousFrontmostApplication,
              previousFrontmostApplication.processIdentifier != ProcessInfo.processInfo.processIdentifier
        else { return }

        let currentApplication = NSRunningApplication.current
        NSApp.yieldActivation(to: previousFrontmostApplication)
        _ = previousFrontmostApplication.activate(
            from: currentApplication,
            options: []
        )

        for _ in 0..<30 {
            if NSWorkspace.shared.frontmostApplication?.processIdentifier
                == previousFrontmostApplication.processIdentifier {
                return
            }
            try? await Task.sleep(for: .milliseconds(16))
        }
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
                .intersection(headerView.visibleRect)
            guard !localFrame.isNull,
                  localFrame.width >= 2,
                  localFrame.height >= 2
            else { return nil }
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

    static func windowList() -> ProbeWindowList {
        let windows = inspectableWindows()
        let options = windows.map(windowOption)
        return ProbeWindowList(
            windows: options,
            preferredWindowID: preferredWindowID(in: options)
        )
    }

    static func preferredWindowID(in options: [ProbeWindowOption]) -> String? {
        options.enumerated().min { left, right in
            let leftPriority = windowPriority(left.element)
            let rightPriority = windowPriority(right.element)
            return leftPriority == rightPriority ? left.offset < right.offset : leftPriority < rightPriority
        }?.element.id
    }

    private static func captureContext(
        scope: ProbeCaptureScope,
        windowID: String?
    ) throws -> CaptureContext {
        let windows = inspectableWindows()
        let window: NSWindow?
        if let windowID {
            window = windows.first { objectID($0) == windowID }
            guard window != nil else { throw ProbeError.windowUnavailable }
        } else if let preferredID = preferredWindowID(in: windows.map(windowOption)) {
            window = windows.first { objectID($0) == preferredID }
        } else {
            window = nil
        }
        guard let window, let contentView = window.contentView else {
            throw ProbeError.noVisibleWindow
        }
        let frameView = contentView.superview ?? contentView
        let rootView: NSView
        let actualScope: ProbeCaptureScope
        if scope == .windowFrame,
           let windowFrameView = contentView.superview,
           windowFrameView.window === window {
            rootView = windowFrameView
            actualScope = .windowFrame
        } else {
            rootView = contentView
            actualScope = .content
        }
        return CaptureContext(
            window: window,
            kind: windowKind(window),
            contentView: contentView,
            frameView: frameView,
            rootView: rootView,
            scope: actualScope
        )
    }

    private static func inspectableWindows() -> [NSWindow] {
        var seen = Set<ObjectIdentifier>()
        return (NSApp.orderedWindows + NSApp.windows).filter { window in
            let identifier = ObjectIdentifier(window)
            let className = NSStringFromClass(type(of: window))
            guard seen.insert(identifier).inserted,
                  !isCaptureInfrastructureWindow(className: className),
                  window.isVisible,
                  !window.isMiniaturized,
                  window.alphaValue > 0,
                  window.frame.width >= 2,
                  window.frame.height >= 2,
                  window.contentView != nil
            else { return false }
            return true
        }
    }

    static func isCaptureInfrastructureWindow(className: String) -> Bool {
        className.localizedCaseInsensitiveContains("LocalWindowSharingWindow")
    }

    private static func windowOption(_ window: NSWindow) -> ProbeWindowOption {
        let kind = windowKind(window)
        return ProbeWindowOption(
            id: objectID(window),
            title: windowTitle(window, kind: kind),
            className: NSStringFromClass(type(of: window)),
            kind: kind,
            frame: ProbeRect(window.frame),
            isKeyWindow: window.isKeyWindow,
            isMainWindow: window.isMainWindow
        )
    }

    private static func windowKind(_ window: NSWindow) -> ProbeWindowKind {
        let className = NSStringFromClass(type(of: window)).lowercased()
        if className.contains("popover") { return .popover }
        if window.isSheet || window.sheetParent != nil { return .sheet }
        if window is NSPanel { return .panel }
        if window.isMainWindow || window.canBecomeMain { return .main }
        return .window
    }

    private static func windowTitle(_ window: NSWindow, kind: ProbeWindowKind) -> String {
        let title = window.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard title.isEmpty else { return title }
        switch kind {
        case .main: return "Main Window"
        case .popover: return "Popover"
        case .sheet: return "Sheet"
        case .panel: return "Panel"
        case .window: return "Window"
        }
    }

    private static func windowPriority(_ option: ProbeWindowOption) -> Int {
        switch option.kind {
        case .popover: return 0
        case .sheet: return 1
        case .panel: return 2
        case .main: return option.isKeyWindow ? 3 : 4
        case .window: return option.isKeyWindow ? 3 : 5
        }
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
        if mode == .exact {
            do {
                let png = try await exactPNG(context: context)
                return CaptureResult(
                    png: png,
                    rendering: .windowServerExact,
                    fallbackReason: nil
                )
            } catch {
                let reason = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                if context.scope == .windowFrame,
                   let png = hybridWindowFramePNG(context: context, cachedBitmap: bitmap) {
                    return CaptureResult(
                        png: png,
                        rendering: .windowFrameHybrid,
                        fallbackReason: reason
                    )
                }
                guard let png = bitmap.representation(using: .png, properties: [:]) else {
                    throw error
                }
                return CaptureResult(png: png, rendering: .viewCache, fallbackReason: reason)
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

    private static func exactPNG(context: CaptureContext) async throws -> Data {
        guard #available(macOS 14.4, *) else {
            throw ProbeError.exactCaptureUnavailable("Exact Window requires macOS 14.4 or later")
        }
        guard supportsExactCapture(kind: context.kind) else {
            throw ProbeError.exactCaptureUnavailable(
                "AppKit popovers require a geometry-matched AppKit snapshot"
            )
        }

        let content = try await currentProcessShareableContent()
        let windowID = CGWindowID(context.window.windowNumber)
        guard let capturedWindow = content.windows.first(where: { $0.windowID == windowID }) else {
            throw ProbeError.exactCaptureUnavailable("The current AppKit window is not available to ScreenCaptureKit")
        }
        guard captureFrameMatches(
            expected: context.frameView.bounds.size,
            captured: capturedWindow.frame.size
        ) else {
            throw ProbeError.exactCaptureUnavailable(
                "ScreenCaptureKit returned a different native window; using the matching AppKit snapshot"
            )
        }

        let configuration = SCStreamConfiguration()
        let scale = max(1, context.window.backingScaleFactor)
        configuration.width = max(1, Int((context.frameView.bounds.width * scale).rounded()))
        configuration.height = max(1, Int((context.frameView.bounds.height * scale).rounded()))
        configuration.scalesToFit = true
        configuration.preservesAspectRatio = true
        configuration.showsCursor = false
        configuration.ignoreShadowsSingleWindow = true
        configuration.captureResolution = .best

        let filter = SCContentFilter(desktopIndependentWindow: capturedWindow)
        let windowImage = try await captureImage(filter: filter, configuration: configuration)
        let image: CGImage
        if context.scope == .content {
            let contentFrame = context.contentView.convert(context.contentView.bounds, to: context.frameView)
            let cropRect = exactContentCropRect(
                frameBounds: context.frameView.bounds,
                contentFrame: contentFrame,
                imageSize: CGSize(width: windowImage.width, height: windowImage.height)
            )
            guard cropRect.width > 0,
                  cropRect.height > 0,
                  let croppedImage = windowImage.cropping(to: cropRect)
            else {
                throw ProbeError.exactCaptureUnavailable("The application content could not be cropped from the exact window image")
            }
            image = croppedImage
        } else {
            image = windowImage
        }
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let png = bitmap.representation(using: .png, properties: [:]) else {
            throw ProbeError.captureFailed
        }
        return png
    }

    static func exactContentCropRect(
        frameBounds: NSRect,
        contentFrame: NSRect,
        imageSize: CGSize
    ) -> CGRect {
        guard frameBounds.width > 0,
              frameBounds.height > 0,
              imageSize.width > 0,
              imageSize.height > 0
        else { return .zero }

        let scaleX = imageSize.width / frameBounds.width
        let scaleY = imageSize.height / frameBounds.height
        let proposed = CGRect(
            x: (contentFrame.minX - frameBounds.minX) * scaleX,
            y: (frameBounds.maxY - contentFrame.maxY) * scaleY,
            width: contentFrame.width * scaleX,
            height: contentFrame.height * scaleY
        ).integral
        let imageBounds = CGRect(origin: .zero, size: imageSize)
        return proposed.intersection(imageBounds)
    }

    static func captureFrameMatches(
        expected: CGSize,
        captured: CGSize,
        tolerance: CGFloat = 4
    ) -> Bool {
        guard expected.width > 0,
              expected.height > 0,
              captured.width > 0,
              captured.height > 0
        else { return false }
        return abs(expected.width - captured.width) <= tolerance
            && abs(expected.height - captured.height) <= tolerance
    }

    static func supportsExactCapture(kind: ProbeWindowKind) -> Bool {
        kind != .popover
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

    private static func standardWindowControl(
        at point: CGPoint,
        in rootView: NSView,
        window: NSWindow
    ) -> NSButton? {
        let buttonTypes: [NSWindow.ButtonType] = [
            .closeButton,
            .miniaturizeButton,
            .zoomButton,
            .toolbarButton,
        ]
        return buttonTypes.compactMap(window.standardWindowButton).first { button in
            !button.isHidden
                && button.alphaValue > 0
                && button.convert(button.bounds, to: rootView).contains(point)
        }
    }

    private static func objectID(_ object: AnyObject) -> String {
        String(UInt(bitPattern: ObjectIdentifier(object)), radix: 16)
    }
}

enum ProbeError: LocalizedError {
    case noVisibleWindow
    case windowUnavailable
    case captureFailed
    case exactCaptureUnavailable(String)
    case activeCaptureUnavailable
    case socket(String)
    case invalidRequest
    case unauthorized

    var errorDescription: String? {
        switch self {
        case .noVisibleWindow: "No visible AppKit window is available"
        case .windowUnavailable: "The selected AppKit window is no longer available"
        case .captureFailed: "Unable to capture the AppKit window"
        case let .exactCaptureUnavailable(message): message
        case .activeCaptureUnavailable: "The inspected window did not become active before capture"
        case let .socket(message): message
        case .invalidRequest: "Invalid probe request"
        case .unauthorized: "Probe request token is invalid"
        }
    }
}
