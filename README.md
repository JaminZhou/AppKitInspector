# AppKit Inspector

AppKit Inspector is a debug-only bridge between a native macOS AppKit application and Codex. It
provides an embedded MCP App where a developer can view the running application, click a view,
inspect its AppKit hierarchy and geometry, add a note, and send the precise context back to Codex.

The project is independent from any inspected application. Product repositories only add the
`AppKitInspectorProbe` package to Debug builds and start it during development; Release and App
Store builds do not contain the probe.

## Repository layout

- `native/` — reusable Swift package plus a small AppKit demo application.
- `packages/mcp/` — local MCP server and target discovery/transport.
- `packages/app/` — embedded Codex MCP App.
- `plugins/appkit-inspector/` — installable Codex plugin and workflow skill.

## Develop

```bash
npm install
npm run check
swift run --package-path native AppKitInspectorDemo
```

In a second terminal, install the repository marketplace and plugin:

```bash
codex plugin marketplace add /Users/JaminZhou/Developer/AppKitInspector
codex plugin add appkit-inspector@appkit-inspector-dev
open 'codex://plugins/appkit-inspector?marketplacePath=%2FUsers%2FJaminZhou%2FDeveloper%2FAppKitInspector%2F.agents%2Fplugins%2Fmarketplace.json'
```

Continue in the same Codex task on the next turn, then ask it to list AppKit targets, connect to the
demo, and open AppKit Inspector. The desktop App Server reloads MCP configuration for loaded tasks;
a new task is not required. When no native target is running, the embedded app opens a deterministic
mock snapshot so the Codex integration can still be exercised.

## Security boundary

The native probe binds only to `127.0.0.1`, generates a random bearer token, writes discovery
metadata into a user-only cache directory, and is compiled only in Debug. The MCP server never
uses Accessibility, Screen Recording, private frameworks, or injection.
