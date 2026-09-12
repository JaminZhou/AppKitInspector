import Foundation

public struct ProbeRect: Codable, Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

public struct ProbeTarget: Codable, Equatable, Sendable {
    public let pid: Int32
    public let name: String
    public let bundleIdentifier: String
    public let port: UInt16
    public let startedAt: String
}

struct ProbeDiscoveryRecord: Codable, Sendable {
    let pid: Int32
    let name: String
    let bundleIdentifier: String
    let port: UInt16
    let token: String
    let startedAt: String

    var publicTarget: ProbeTarget {
        ProbeTarget(
            pid: pid,
            name: name,
            bundleIdentifier: bundleIdentifier,
            port: port,
            startedAt: startedAt
        )
    }
}

public struct ProbeViewNode: Codable, Equatable, Sendable {
    public let id: String
    public let className: String
    public let frame: ProbeRect
    public let bounds: ProbeRect
    public let hidden: Bool
    public let alpha: Double
    public let identifier: String?
    public let label: String?
    public let role: String?
    public let subviews: [ProbeViewNode]
}

public enum ProbeCaptureScope: String, Codable, Equatable, Sendable {
    case content
    case windowFrame
}

public enum ProbeCaptureMode: String, Codable, Equatable, Sendable {
    case hybrid
    case exact
}

public enum ProbeCaptureActivation: String, Codable, Equatable, Sendable {
    case current
    case active
}

public enum ProbeCaptureRendering: String, Codable, Equatable, Sendable {
    case viewCache
    case windowFrameHybrid
    case windowServerExact
}

public enum ProbeWindowKind: String, Codable, Equatable, Sendable {
    case main
    case popover
    case sheet
    case panel
    case window
}

public struct ProbeWindowOption: Codable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let className: String
    public let kind: ProbeWindowKind
    public let frame: ProbeRect
    public let isKeyWindow: Bool
    public let isMainWindow: Bool
}

public struct ProbeWindowList: Codable, Equatable, Sendable {
    public let windows: [ProbeWindowOption]
    public let preferredWindowID: String?
}

public struct ProbeWindow: Codable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let kind: ProbeWindowKind
    public let frame: ProbeRect
    public let contentFrame: ProbeRect
    public let captureScope: ProbeCaptureScope
    public let requestedCaptureMode: ProbeCaptureMode
    public let requestedCaptureActivation: ProbeCaptureActivation
    public let capturedWindowWasActive: Bool
    public let captureRendering: ProbeCaptureRendering
    public let captureFallbackReason: String?
}

public struct ProbeSnapshot: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let target: ProbeTarget
    public let window: ProbeWindow
    public let availableWindows: [ProbeWindowOption]
    public let imageDataURL: String
    public let root: ProbeViewNode
}

public struct ProbeInspectResult: Codable, Equatable, Sendable {
    public let snapshot: ProbeSnapshot
    public let node: ProbeViewNode
    public let ancestorPath: [String]
}

extension ProbeRect {
    init(_ rect: CGRect) {
        self.init(
            x: rect.origin.x,
            y: rect.origin.y,
            width: rect.size.width,
            height: rect.size.height
        )
    }
}
