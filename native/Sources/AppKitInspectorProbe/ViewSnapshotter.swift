import AppKit
import Foundation

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
        scope: ProbeCaptureScope = .windowFrame
    ) throws -> ProbeSnapshot {
        let context = try captureContext(scope: scope)
        let rootView = context.rootView
        rootView.displayIfNeeded()
        guard let bitmap = rootView.bitmapImageRepForCachingDisplay(in: rootView.bounds) else {
            throw ProbeError.captureFailed
        }
        rootView.cacheDisplay(in: rootView.bounds, to: bitmap)
        guard let png = bitmap.representation(using: .png, properties: [:]) else {
            throw ProbeError.captureFailed
        }

        return ProbeSnapshot(
            schemaVersion: 2,
            target: target,
            window: ProbeWindow(
                id: objectID(context.window),
                title: context.window.title,
                frame: ProbeRect(rootView.bounds),
                contentFrame: ProbeRect(context.contentView.convert(context.contentView.bounds, to: rootView)),
                captureScope: context.scope
            ),
            imageDataURL: "data:image/png;base64,\(png.base64EncodedString())",
            root: viewNode(rootView, relativeTo: rootView, window: context.window)
        )
    }

    static func inspectPoint(
        x: Double,
        y: Double,
        target: ProbeTarget,
        scope: ProbeCaptureScope = .windowFrame
    ) throws -> ProbeInspectResult {
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
            snapshot: try snapshot(target: target, scope: context.scope),
            node: viewNode(hitView, relativeTo: rootView, window: context.window),
            ancestorPath: ancestors.reversed()
        )
    }

    static func viewNode(_ view: NSView, relativeTo rootView: NSView, window: NSWindow) -> ProbeViewNode {
        let frame = view === rootView ? rootView.bounds : view.convert(view.bounds, to: rootView)
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
            subviews: view.subviews.map { viewNode($0, relativeTo: rootView, window: window) }
        )
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
    case socket(String)
    case invalidRequest
    case unauthorized

    var errorDescription: String? {
        switch self {
        case .noVisibleWindow: "No visible AppKit window is available"
        case .captureFailed: "Unable to capture the AppKit window"
        case let .socket(message): message
        case .invalidRequest: "Invalid probe request"
        case .unauthorized: "Probe request token is invalid"
        }
    }
}
