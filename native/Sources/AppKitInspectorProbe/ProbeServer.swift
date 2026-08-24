import AppKit
import Darwin
import Foundation

public enum AppKitInspectorProbe {
#if DEBUG
    @MainActor private static var server: ProbeServer?
#endif

    @MainActor
    @discardableResult
    public static func start() throws -> Bool {
#if DEBUG
        if server != nil { return true }
        let newServer = ProbeServer()
        try newServer.start()
        server = newServer
        return true
#else
        return false
#endif
    }

    @MainActor
    public static func stop() {
#if DEBUG
        server?.stop()
        server = nil
#endif
    }
}

#if DEBUG
private struct ProbeRequest: Decodable {
    let method: String
    let token: String
    let x: Double?
    let y: Double?
    let scope: ProbeCaptureScope?
    let mode: ProbeCaptureMode?
}

private struct SuccessResponse<Value: Encodable>: Encodable {
    let ok = true
    let result: Value
}

private struct FailureResponse: Encodable {
    let ok = false
    let error: String
}

private final class ProbeServer: @unchecked Sendable {
    private let queue = DispatchQueue(label: "dev.appkit-inspector.probe", qos: .userInitiated)
    private let responseQueue = DispatchQueue(
        label: "dev.appkit-inspector.probe.responses",
        qos: .userInitiated,
        attributes: .concurrent
    )
    private let token = "\(UUID().uuidString)\(UUID().uuidString)"
    private let startedAt = ISO8601DateFormatter().string(from: Date())
    private var socketDescriptor: Int32 = -1
    private var metadataURL: URL?
    private var terminationObserver: NSObjectProtocol?
    private var target: ProbeTarget?

    deinit {
        stop()
    }

    func start() throws {
        socketDescriptor = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        guard socketDescriptor >= 0 else { throw socketError("Unable to create probe socket") }

        var reuse: Int32 = 1
        guard setsockopt(socketDescriptor, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout.size(ofValue: reuse))) == 0 else {
            throw socketError("Unable to configure probe socket")
        }

        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = 0
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let bindResult = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(socketDescriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindResult == 0 else { throw socketError("Unable to bind probe to loopback") }
        guard Darwin.listen(socketDescriptor, 8) == 0 else { throw socketError("Unable to listen for probe requests") }

        var boundAddress = sockaddr_in()
        var boundLength = socklen_t(MemoryLayout<sockaddr_in>.size)
        let nameResult = withUnsafeMutablePointer(to: &boundAddress) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getsockname(socketDescriptor, $0, &boundLength)
            }
        }
        guard nameResult == 0 else { throw socketError("Unable to read probe port") }

        let bundle = Bundle.main
        let record = ProbeDiscoveryRecord(
            pid: ProcessInfo.processInfo.processIdentifier,
            name: bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
                ?? bundle.object(forInfoDictionaryKey: "CFBundleName") as? String
                ?? ProcessInfo.processInfo.processName,
            bundleIdentifier: bundle.bundleIdentifier ?? "local.\(ProcessInfo.processInfo.processName)",
            port: UInt16(bigEndian: boundAddress.sin_port),
            token: token,
            startedAt: startedAt
        )
        target = record.publicTarget
        metadataURL = try writeDiscoveryRecord(record)
        terminationObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.willTerminateNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.stop()
        }

        queue.async { [weak self] in self?.acceptLoop() }
    }

    func stop() {
        if socketDescriptor >= 0 {
            Darwin.shutdown(socketDescriptor, SHUT_RDWR)
            Darwin.close(socketDescriptor)
            socketDescriptor = -1
        }
        if let metadataURL {
            try? FileManager.default.removeItem(at: metadataURL)
            self.metadataURL = nil
        }
        if let terminationObserver {
            NotificationCenter.default.removeObserver(terminationObserver)
            self.terminationObserver = nil
        }
    }

    private func acceptLoop() {
        while socketDescriptor >= 0 {
            let client = Darwin.accept(socketDescriptor, nil, nil)
            if client < 0 {
                if socketDescriptor < 0 { return }
                continue
            }
            handle(client)
        }
    }

    private func handle(_ client: Int32) {
        do {
            let request = try decodeRequest(client)
            guard request.token == token else { throw ProbeError.unauthorized }
            guard let target else { throw ProbeError.invalidRequest }
            Task { @MainActor [weak self] in
                guard let self else {
                    Darwin.close(client)
                    return
                }
                let response: Data
                do {
                    switch request.method {
                    case "snapshot":
                        response = try JSONEncoder().encode(
                            SuccessResponse(
                                result: try await ViewSnapshotter.snapshot(
                                    target: target,
                                    scope: request.scope ?? .windowFrame,
                                    mode: request.mode ?? .hybrid
                                )
                            )
                        )
                    case "inspectPoint":
                        guard let x = request.x, let y = request.y else { throw ProbeError.invalidRequest }
                        response = try JSONEncoder().encode(
                            SuccessResponse(
                                result: try await ViewSnapshotter.inspectPoint(
                                    x: x,
                                    y: y,
                                    target: target,
                                    scope: request.scope ?? .windowFrame,
                                    mode: request.mode ?? .hybrid
                                )
                            )
                        )
                    default:
                        throw ProbeError.invalidRequest
                    }
                } catch {
                    response = self.failureResponse(for: error)
                }
                self.responseQueue.async { [weak self] in
                    self?.write(response + Data([0x0A]), to: client)
                    Darwin.close(client)
                }
            }
        } catch {
            let response = failureResponse(for: error)
            write(response + Data([0x0A]), to: client)
            Darwin.close(client)
        }
    }

    private func failureResponse(for error: Error) -> Data {
        let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        return (try? JSONEncoder().encode(FailureResponse(error: message))) ?? Data()
    }

    private func decodeRequest(_ client: Int32) throws -> ProbeRequest {
        var data = Data()
        var bytes = [UInt8](repeating: 0, count: 8_192)
        while data.count <= 1_048_576 {
            let count = Darwin.read(client, &bytes, bytes.count)
            guard count > 0 else { break }
            data.append(bytes, count: count)
            if let newline = data.firstIndex(of: 0x0A) {
                return try JSONDecoder().decode(ProbeRequest.self, from: data[..<newline])
            }
        }
        throw ProbeError.invalidRequest
    }

    private func write(_ data: Data, to client: Int32) {
        data.withUnsafeBytes { rawBuffer in
            guard let baseAddress = rawBuffer.baseAddress else { return }
            var offset = 0
            while offset < data.count {
                let count = Darwin.write(client, baseAddress.advanced(by: offset), data.count - offset)
                guard count > 0 else { return }
                offset += count
            }
        }
    }

    private func writeDiscoveryRecord(_ record: ProbeDiscoveryRecord) throws -> URL {
        let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appending(path: "AppKitInspector/targets", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        let safeBundleID = record.bundleIdentifier.replacingOccurrences(
            of: "[^A-Za-z0-9._-]",
            with: "-",
            options: .regularExpression
        )
        let url = directory.appending(path: "\(safeBundleID)-\(record.pid).json")
        let data = try JSONEncoder().encode(record)
        try data.write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        return url
    }

    private func socketError(_ message: String) -> ProbeError {
        ProbeError.socket("\(message): \(String(cString: strerror(errno)))")
    }
}
#endif
