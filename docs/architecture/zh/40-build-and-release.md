# 40 · 构建与发布

> 适用范围：electron-vite 构建、typecheck 门禁、electron-builder 打包、测试、CI。最后核对：`electron.vite.config.ts`、`electron-builder.yml`、`.github/workflows/ci.yml`、`package.json`、`vitest.config.ts`（v0.2.4）。

## 1. electron-vite 构建

`electron.vite.config.ts` 定义三个目标：

- **main** —— `externalizeDepsPlugin()`，别名 `@shared`。
- **preload** —— `externalizeDepsPlugin({ exclude: ['electron-log'] })`（electron-log 须打进 preload 而非外置）。
- **renderer** —— `tailwindcss()` + `react()`，别名 `@` / `@renderer` → `src/renderer/src`、`@shared` → `src/shared`，并有**两个 HTML rollup 输入**：`main → src/renderer/index.html`、`pet → src/renderer/pet.html`。

electron-vite 进程层是三入口（main / preload / renderer）；renderer 打两个 HTML 入口。它们对应 [03 进程模型](./03-process-model.md) 的两类窗口。

## 2. 脚本与 typecheck 门禁

来自 `package.json`：

- `pnpm dev` = `electron-vite dev`；`pnpm start` = `electron-vite preview`。
- `pnpm build` = `node --run typecheck && electron-vite build` —— 在产出任何 bundle 前，**typecheck 是硬门禁**。
- `pnpm typecheck` = `typecheck:node` + `typecheck:web`，即 `tsc --noEmit -p tsconfig.node.json` 与 `tsconfig.web.json`（均 `--composite false`）。
- `pnpm lint` = `eslint --cache .`；`pnpm format` = `prettier --write .`。
- `pnpm build:{win,mac,linux}` = `node --run build && electron-builder --{win,mac,linux}`。
- `postinstall` = `electron-builder install-app-deps`（重建 better-sqlite3 等原生模块）。

## 3. electron-builder 打包

`electron-builder.yml`：`appId: com.luminstudio.tanzo`、`productName: Tanzo`。

- **Windows** —— NSIS 安装器（非 one-click、自定义安装目录、`installer.nsh`、总是创建桌面快捷方式）。
- **macOS** —— DMG，带 `entitlements.mac.plist` 与相机/麦克风/文档/下载用途说明；`notarize: false`。
- **Linux** —— AppImage + deb；maintainer "Lumin Studio"；category "Utility"。
- `asarUnpack: resources/**`（资源须在 asar 外可读）；`npmRebuild: false`。

## 4. 测试

`vitest.config.ts`：

- 测试：`tests/unit/**/*.{test,spec}.*`，`environment: 'node'`，setup `tests/setup/electron-stub.ts`。
- 别名镜像 vite 并加 `@main → src/main`。
- 覆盖率（v8）仅作用于 `src/main/**` + `src/shared/**`——**renderer 不覆盖**——并排除 `index.ts`、`window.ts` 与迁移文件。

另有 `test:node` 脚本经 `tsx` 跑 `spike/*.spike.ts` 做探索性检查（`spike/` 不属单测套件）。`pnpm test:watch` 与 `pnpm test:coverage` 是常用变体。

## 5. CI（`.github/workflows/ci.yml`）

触发：push 到 `main` / `develop`、`v*` 标签、以及 pull request。Node 24、pnpm，带 pnpm-store 缓存。三个 job：

1. **quality**（ubuntu）—— `pnpm install --frozen-lockfile`，再 `pnpm typecheck`、`pnpm lint`、`pnpm test`。与开发者本地跑的同一门禁。
2. **package** —— `needs: quality`，仅 `push`；macOS / Windows / Linux 矩阵跑 `pnpm build && pnpm exec electron-builder --{mac,win,linux} --publish never`（带 `CSC_IDENTITY_AUTO_DISCOVERY: false`），上传产物。
3. **release** —— `needs: package`，仅 `v*` 标签；下载产物并经 `softprops/action-gh-release` 建 GitHub release，标签含 `-` 时标为 prerelease。

故 `main`/PR push 门禁于 quality；仅 push 构建安装器；仅标签发布 release。错误与日志模型见 [50 横切关注点](./50-cross-cutting.md)。

下一篇 → [50 横切关注点](./50-cross-cutting.md)
