# 40 · Build & Release

> Scope: the electron-vite build, the typecheck gate, electron-builder packaging, tests, and CI. Last verified
> against `electron.vite.config.ts`, `electron-builder.yml`, `.github/workflows/ci.yml`, `package.json`,
> `vitest.config.ts` at v0.2.4.

## 1. electron-vite build

`electron.vite.config.ts` defines three targets:

- **main** — `externalizeDepsPlugin()`, alias `@shared`.
- **preload** — `externalizeDepsPlugin({ exclude: ['electron-log'] })` (electron-log must be bundled into
  preload rather than externalized).
- **renderer** — `tailwindcss()` + `react()`, with aliases `@` / `@renderer` → `src/renderer/src` and
  `@shared` → `src/shared`, and **two HTML rollup inputs**: `main → src/renderer/index.html` and
  `pet → src/renderer/pet.html`.

At the electron-vite process level there are three entries (main / preload / renderer); the renderer bundles two
HTML entries. These correspond to the two window kinds in [03 Process Model](./03-process-model.md).

## 2. Scripts and the typecheck gate

From `package.json`:

- `pnpm dev` = `electron-vite dev`; `pnpm start` = `electron-vite preview`.
- `pnpm build` = `node --run typecheck && electron-vite build` — the **typecheck is a hard gate** before any
  bundle is produced.
- `pnpm typecheck` = `typecheck:node` + `typecheck:web`, i.e. `tsc --noEmit -p tsconfig.node.json` and
  `tsconfig.web.json` (both `--composite false`).
- `pnpm lint` = `eslint --cache .`; `pnpm format` = `prettier --write .`.
- `pnpm build:{win,mac,linux}` = `node --run build && electron-builder --{win,mac,linux}`.
- `postinstall` = `electron-builder install-app-deps` (rebuilds native modules like better-sqlite3).

## 3. electron-builder packaging

`electron-builder.yml`: `appId: com.luminstudio.tanzo`, `productName: Tanzo`.

- **Windows** — NSIS installer (non-one-click, custom install dir, `installer.nsh`, always creates a desktop
  shortcut).
- **macOS** — DMG, with `entitlements.mac.plist` and camera/mic/documents/downloads usage strings;
  `notarize: false`.
- **Linux** — AppImage + deb; maintainer "Lumin Studio"; category "Utility".
- `asarUnpack: resources/**` (assets must be readable outside the asar); `npmRebuild: false`.

## 4. Tests

`vitest.config.ts`:

- Tests: `tests/unit/**/*.{test,spec}.*`, `environment: 'node'`, setup `tests/setup/electron-stub.ts`.
- Aliases mirror vite plus `@main → src/main`.
- Coverage (v8) is scoped to `src/main/**` + `src/shared/**` only — the **renderer is not covered** — and
  excludes `index.ts`, `window.ts`, and migration files.

There is also a `test:node` script running `spike/*.spike.ts` via `tsx` for exploratory checks (the `spike/`
directory is not part of the unit suite). `pnpm test:watch` and `pnpm test:coverage` are the usual variants.

## 5. CI (`.github/workflows/ci.yml`)

Triggers: push to `main` / `develop`, `v*` tags, and pull requests. Node 24, pnpm, with a pnpm-store cache.
Three jobs:

1. **quality** (ubuntu) — `pnpm install --frozen-lockfile`, then `pnpm typecheck`, `pnpm lint`, `pnpm test`.
   This is the same gate developers run locally.
2. **package** — `needs: quality`, only on `push`; a matrix of macOS / Windows / Linux running
   `pnpm build && pnpm exec electron-builder --{mac,win,linux} --publish never` (with
   `CSC_IDENTITY_AUTO_DISCOVERY: false`), uploading the artifacts.
3. **release** — `needs: package`, only on `v*` tags; downloads the artifacts and creates a GitHub release via
   `softprops/action-gh-release`, marking it a prerelease when the tag contains `-`.

So `main`/PR pushes gate on quality; only pushes build installers; only tags publish a release. See
[50 Cross-Cutting](./50-cross-cutting.md) for the error and logging model that surfaces in these builds.

Next → [50 Cross-Cutting](./50-cross-cutting.md)
