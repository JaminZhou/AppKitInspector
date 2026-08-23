// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "AppKitInspector",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "AppKitInspectorProbe", targets: ["AppKitInspectorProbe"]),
        .executable(name: "AppKitInspectorDemo", targets: ["AppKitInspectorDemo"]),
    ],
    targets: [
        .target(
            name: "AppKitInspectorProbe",
            path: "native/Sources/AppKitInspectorProbe"
        ),
        .executableTarget(
            name: "AppKitInspectorDemo",
            dependencies: ["AppKitInspectorProbe"],
            path: "native/Sources/AppKitInspectorDemo"
        ),
        .testTarget(
            name: "AppKitInspectorProbeTests",
            dependencies: ["AppKitInspectorProbe"],
            path: "native/Tests/AppKitInspectorProbeTests"
        ),
    ]
)
