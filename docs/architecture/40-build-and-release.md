# 40 · 构建与发布

> 适用范围：electron-vite 三入口、typecheck 门禁、electron-builder、测试。最后核对：`electron.vite.config.ts`、`electron-builder.yml`、`package.json`、`vitest.config.ts`。

## 1. electron-vite（`electron.vite.config.ts`）

标准三入口配置：

- **main**：`externalizeDepsPlugin()`，别名 `@shared → src/shared`。
- **preload**：`externalizeDepsPlugin({ exclude: ['electron-log'] })`——`electron-log` 刻意打进 preload 而非外置。同 `@shared` 别名。
- **renderer**：别名 `@`/`@renderer → src/renderer/src` + `@shared`；插件 `tailwindcss()` + `react()`。**两个 HTML 输入**：

```ts
input: {
  main: resolve('src/renderer/index.html'),  // 主窗口
  pet:  resolve('src/renderer/pet.html')      // pet 覆盖层
}
```

双入口对应 [03 进程模型](./03-process-model.md) §4 的两类窗口，是一条架构不变量。

## 2. 脚本（`package.json`）

| 脚本 | 命令 | 说明 |
|---|---|---|
| `dev` | `electron-vite dev` | 开发 |
| `start` | `electron-vite preview` | 预览构建产物 |
| `typecheck` | `typecheck:node && typecheck:web` | 两套 tsconfig（main/preload + renderer） |
| `build` | `node --run typecheck && electron-vite build` | **typecheck 门禁构建** |
| `build:{mac,win,linux,unpack}` | `build` 后 `electron-builder` | 打包 |
| `postinstall` | `electron-builder install-app-deps` | 重建原生模块（`better-sqlite3`） |
| `test` | `vitest run` | 单元/集成测试 |
| `test:coverage` | `vitest run --coverage` | 覆盖率（`@vitest/coverage-v8`） |
| `test:node` | `node --import tsx --test spike/*.spike.ts` | spike 验证脚本 |
| `lint` | `eslint --cache .` | |
| `format` | `prettier --write .` | |
| `diagnose:prompt-cache` | `node scripts/prompt-cache-diagnostics.mjs` | prompt 缓存诊断（见 [11 上下文工程](./11-context-engineering.md)） |

## 3. electron-builder（`electron-builder.yml`）

- `appId: com.luminstudio.tanzo`（与 `setAppUserModelId` 一致），`productName: Tanzo`。
- `asarUnpack: resources/**`——资源从 asar 解包，这是 `pet/module.ts` 能探测 `app.asar.unpacked/resources/pets` 的原因。
- `npmRebuild: false`（原生依赖经 postinstall 的 `install-app-deps` 处理）。
- mac：`entitlementsInherit: build/entitlements.mac.plist`；camera/mic/Documents/Downloads 用途字符串在 `extendInfo` 下，`notarize: false`。
- 目标：mac dmg、win nsis（可选安装目录，非 one-click）、linux AppImage/snap/deb。

## 4. 测试

- 主测试运行器 `vitest`（`vitest.config.ts`）。
- `spike/*.spike.ts` 为承重假设的验证脚本（如审批无状态重跑），用 `node --test` + `tsx` 运行。

## 5. 验证流程建议

改动后按风险递进：

1. `node --run typecheck`——构建门禁，最快反馈。
2. `node --run test`——相关单测。
3. `node --run build`——完整 typecheck + 打包编译。
4. 涉及原生模块（better-sqlite3）变更后跑 `postinstall`。

## 6. 构建不变量

- [ ] renderer 双 HTML 入口（`index.html` + `pet.html`）对应两类窗口。
- [ ] `build` 以 typecheck 为门禁。
- [ ] 资源走 asar-unpacked（`resources/**`）。
- [ ] 原生模块经 `install-app-deps` 重建，`npmRebuild: false`。

下一篇 → [50 横切关注点](./50-cross-cutting.md)
