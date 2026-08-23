# Third-Party Notices

The generated JavaScript under `plugins/appkit-inspector/dist/` contains bundled open-source npm
packages. `npm run build` derives the exact package inventory from esbuild's metafiles, writes it to
`plugins/appkit-inspector/dist/THIRD_PARTY_NOTICES.md`, and copies the complete corresponding license
texts into `plugins/appkit-inspector/dist/licenses/`.

The generated inventory is the source of truth for redistributed plugin bundles.
