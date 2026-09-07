# Build targets: mechanisms CLAUDE.md does not spell out

Commands and the target list live in `CLAUDE.md`; this holds only the how.

- Verifier is a Node SEA binary: `scripts/build-verifier.mjs` bundles `src/verifier/cli.ts`,
  runs `node --experimental-sea-config sea-config.json`, copies the host `node` binary, injects
  the blob with `postject`.
- Extension build is two-pass (`extension/vite.config.ts`): normal pass for popup/background,
  then a `BUILD_TARGET=content` pass emitting the content script as an IIFE. `dev:extension`
  runs both passes as watchers through `scripts/dev-extension.mjs`, which empties `extension/dist`
  once up front so neither watcher needs `emptyOutDir`.
- `postinstall` runs `scripts/ensure-electron.mjs` (Node-24 extraction backstop) then
  `scripts/rebuild-native.mjs` (better-sqlite3 against the Electron ABI).
- Packaging (electron-builder in `package.json`): `asarUnpack` must keep `**/node_modules/sharp/**`
  and `**/node_modules/@img/**` or the packaged Linux app crashes at runtime. Targets: win `nsis`,
  mac `dmg`, Linux AppImage+deb.
