import XCTest
@testable import AppKitInspectorProbe

final class ProbeModelsTests: XCTestCase {
    func testDiscoveryRecordOmitsTokenFromPublicTarget() throws {
        let record = ProbeDiscoveryRecord(
            pid: 42,
            name: "Demo",
            bundleIdentifier: "dev.demo",
            port: 47831,
            token: "secret-token-that-must-not-leak",
            startedAt: "2026-01-01T00:00:00Z"
        )
        let encoded = try JSONEncoder().encode(record.publicTarget)
        let json = try XCTUnwrap(String(data: encoded, encoding: .utf8))
        XCTAssertFalse(json.contains("secret-token"))
        XCTAssertTrue(json.contains("dev.demo"))
    }

    func testRectRoundTrips() throws {
        let rect = ProbeRect(x: 1, y: 2, width: 300, height: 200)
        let data = try JSONEncoder().encode(rect)
        XCTAssertEqual(try JSONDecoder().decode(ProbeRect.self, from: data), rect)
    }

    func testCaptureScopesRoundTrip() throws {
        for scope in [ProbeCaptureScope.windowFrame, .content] {
            let data = try JSONEncoder().encode(scope)
            XCTAssertEqual(try JSONDecoder().decode(ProbeCaptureScope.self, from: data), scope)
        }
    }
}
