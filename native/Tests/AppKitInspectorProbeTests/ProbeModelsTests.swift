import AppKit
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

    func testCaptureRenderingModesRoundTrip() throws {
        for rendering in [ProbeCaptureRendering.viewCache, .windowFrameHybrid, .windowServerExact] {
            let data = try JSONEncoder().encode(rendering)
            XCTAssertEqual(try JSONDecoder().decode(ProbeCaptureRendering.self, from: data), rendering)
        }
    }

    func testCaptureModesRoundTrip() throws {
        for mode in [ProbeCaptureMode.hybrid, .exact] {
            let data = try JSONEncoder().encode(mode)
            XCTAssertEqual(try JSONDecoder().decode(ProbeCaptureMode.self, from: data), mode)
        }
    }

    func testCaptureActivationsRoundTrip() throws {
        for activation in [ProbeCaptureActivation.current, .active] {
            let data = try JSONEncoder().encode(activation)
            XCTAssertEqual(try JSONDecoder().decode(ProbeCaptureActivation.self, from: data), activation)
        }
    }

    @MainActor
    func testExactContentCropRectMapsAppKitCoordinatesToImageCoordinates() {
        let crop = ViewSnapshotter.exactContentCropRect(
            frameBounds: NSRect(x: 0, y: 0, width: 1000, height: 700),
            contentFrame: NSRect(x: 0, y: 0, width: 1000, height: 648),
            imageSize: CGSize(width: 2000, height: 1400)
        )

        XCTAssertEqual(crop, CGRect(x: 0, y: 104, width: 2000, height: 1296))
    }

    @MainActor
    func testExactContentCropRectClampsToCapturedImage() {
        let crop = ViewSnapshotter.exactContentCropRect(
            frameBounds: NSRect(x: 0, y: 0, width: 100, height: 100),
            contentFrame: NSRect(x: -5, y: -5, width: 110, height: 110),
            imageSize: CGSize(width: 200, height: 200)
        )

        XCTAssertEqual(crop, CGRect(x: 0, y: 0, width: 200, height: 200))
    }

    @MainActor
    func testTableHeaderCellsAreExposedAsPreciseSemanticNodes() throws {
        let tableView = NSTableView(frame: NSRect(x: 0, y: 0, width: 300, height: 200))
        let nameColumn = NSTableColumn(identifier: .init("name"))
        nameColumn.title = "Name"
        nameColumn.width = 180
        let eventsColumn = NSTableColumn(identifier: .init("events"))
        eventsColumn.title = "Events"
        eventsColumn.width = 120
        tableView.addTableColumn(nameColumn)
        tableView.addTableColumn(eventsColumn)

        let headerView = NSTableHeaderView(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        tableView.headerView = headerView
        let clipView = NSClipView(frame: NSRect(x: 0, y: 0, width: 220, height: 24))
        clipView.documentView = headerView
        clipView.scroll(to: .zero)
        let unclippedEventsRect = headerView.headerRect(ofColumn: 1)
        let semanticHeaders = ViewSnapshotter.tableHeaderCellNodes(
            headerView,
            relativeTo: headerView
        )

        XCTAssertEqual(semanticHeaders.map(\.label), ["Name", "Events"])
        XCTAssertEqual(semanticHeaders.map(\.identifier), ["name", "events"])
        XCTAssertEqual(semanticHeaders.map(\.role), ["AXColumnHeader", "AXColumnHeader"])
        let nameRect = headerView.headerRect(ofColumn: 0)
        let eventsRect = headerView.headerRect(ofColumn: 1).intersection(headerView.visibleRect)
        XCTAssertEqual(semanticHeaders[0].frame.x, nameRect.minX, accuracy: 0.5)
        XCTAssertEqual(semanticHeaders[0].frame.width, nameRect.width, accuracy: 0.5)
        XCTAssertEqual(semanticHeaders[1].frame.x, eventsRect.minX, accuracy: 0.5)
        XCTAssertEqual(semanticHeaders[1].frame.width, eventsRect.width, accuracy: 0.5)
        XCTAssertLessThan(semanticHeaders[1].frame.width, unclippedEventsRect.width)
        XCTAssertTrue(semanticHeaders.allSatisfy { $0.frame.height >= 20 })
    }
}
