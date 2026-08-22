import AppKit
import Foundation

@MainActor
enum ViewSnapshotter {
    static func snapshot(target: ProbeTarget) throws -> ProbeSnapshot {
        guard let window = NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first(where: { $0.isVisible }),
              let rootView = window.contentView
        else {
            throw ProbeError.noVisibleWindow
        }
        guard let bitmap = rootView.bitmapImageRepForCachingDisplay(in: rootView.bounds) else {
            throw ProbeError.captureFailed
        }
        rootView.cacheDisplay(in: rootView.bounds, to: bitmap)
        guard let png = bitmap.representation(using: .png, properties: [:]) else {
            throw ProbeError.captureFailed
        }

        return ProbeSnapshot(
            schemaVersion: 1,
            target: target,
            window: ProbeWindow(
                id: objectID(window),
                title: window.title,
                frame: ProbeRect(rootView.bounds)
            ),
            imageDataURL: "data:image/png;base64,\(png.base64EncodedString())",
            root: viewNode(rootView, relativeTo: rootView)
        )
    }

    static func inspectPoint(x: Double, y: Double, target: ProbeTarget) throws -> ProbeInspectResult {
        guard let window = NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first(where: { $0.isVisible }),
              let rootView = window.contentView
        else {
            throw ProbeError.noVisibleWindow
        }
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
            snapshot: try snapshot(target: target),
            node: viewNode(hitView, relativeTo: rootView),
            ancestorPath: ancestors.reversed()
        )
    }

    static func viewNode(_ view: NSView, relativeTo rootView: NSView) -> ProbeViewNode {
        let frame = view === rootView ? rootView.bounds : view.convert(view.bounds, to: rootView)
        return ProbeViewNode(
            id: objectID(view),
            className: NSStringFromClass(type(of: view)),
            frame: ProbeRect(frame),
            bounds: ProbeRect(view.bounds),
            hidden: view.isHidden,
            alpha: view.alphaValue,
            identifier: view.identifier?.rawValue,
            label: view.accessibilityLabel(),
            role: view.accessibilityRole()?.rawValue,
            subviews: view.subviews.map { viewNode($0, relativeTo: rootView) }
        )
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
        case .captureFailed: "Unable to capture the AppKit content view"
        case let .socket(message): message
        case .invalidRequest: "Invalid probe request"
        case .unauthorized: "Probe request token is invalid"
        }
    }
}
