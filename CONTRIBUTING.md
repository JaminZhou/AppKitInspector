# Contributing

Contributions are welcome during the public preview. AppKit Inspector intentionally stays small,
Debug-only, local, and based on public AppKit and Foundation APIs.

## Development setup

Requirements:

- macOS 14 or later;
- Xcode 26 or later with Swift 6.2;
- Node.js 22 or later;
- Codex for end-to-end plugin testing.

```bash
npm ci
npm run check
swift build -c release
```

Run `make demo` in one terminal and `npm run test:live` in another for a live bridge check.

## Pull requests

- Use a focused branch such as `fix/browser-launch` or `feat/view-metadata`.
- Keep commits concise and prefixed with `feat:`, `fix:`, `docs:`, `test:`, or another conventional
  type.
- Add or update tests for behavioral changes.
- Run `npm run build` after changing `packages/app/` or `packages/mcp/` and include the generated
  `plugins/appkit-inspector/dist/` output.
- Keep the probe out of Release, archive, TestFlight, and App Store builds.
- Do not introduce code injection, private frameworks, Accessibility automation, Screen Recording,
  non-loopback listeners, or unauthenticated transport.

Report vulnerabilities through [SECURITY.md](SECURITY.md), not a public issue.

Unless stated otherwise, submitted contributions are licensed under Apache License 2.0 as described
in section 5 of [LICENSE](LICENSE).
