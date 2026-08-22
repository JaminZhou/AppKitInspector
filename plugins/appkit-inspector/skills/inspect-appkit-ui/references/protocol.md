# Probe protocol

## Discovery

Debug targets write a mode `0600` JSON record to:

`~/Library/Caches/AppKitInspector/targets/<bundle-id>-<pid>.json`

The record contains process id, app name, bundle identifier, loopback port, random token, and start
time. The MCP server ignores group/world-readable, malformed, and stale records.

## Transport

The probe listens only on `127.0.0.1` and accepts one newline-delimited JSON request per connection.
Every request includes the discovery token. Responses are bounded to 64 MiB by the MCP client.

Supported methods:

- `snapshot`: capture the key window content view and recursively serialize its `NSView` tree.
- `inspectPoint`: convert a normalized top-left image point to AppKit coordinates and return the
  deepest hit-tested view plus its ancestor path.

## Geometry

AppKit view frames use bottom-left coordinates. The embedded app converts them to CSS top-left
percentages using the captured window content size. Refresh after moving or resizing the target.

## Capture scope

The probe uses `cacheDisplay(in:to:)` inside the inspected process. It captures the application
content without Screen Recording permission and normally excludes WindowServer title-bar chrome,
shadows, other apps, and occlusion state.
