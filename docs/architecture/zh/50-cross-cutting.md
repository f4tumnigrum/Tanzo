# 50 · 横切关注点

> 适用范围：错误模型、日志、遥测、安全姿态、i18n、主题——横跨每个子系统的关注点。最后核对：`src/shared/errors.ts`、`src/main/logger.ts`、`src/main/agent/telemetry/*`、`src/main/agent/security/*`、`src/main/safe-env.ts`、`src/renderer/src/i18n.ts`、`src/renderer/src/common/theme/*`（v0.2.4）。

## 1. 错误模型

`src/shared/errors.ts` 是三进程共用的单一错误契约：

- **层级**：基类 `TanzoError extends Error`，含 `{ code, recoverable, details }`，子类 `Invariant / Configuration / Validation / NotFound / Operation / Integration / Auth / Timeout`（`TanzoTimeoutError` 默认 `recoverable: true`）。中心化 `ERROR_CODES` map 为 chat、runtime、agent、policy、database、AI-SDK 各域命名码，另有 `UNEXPECTED_ERROR`。
- **IPC 传输**：因 Electron IPC 只能携带 `Error.message` 字符串，`encodeIpcError` 把序列化错误藏在标记 `__TANZO_IPC_ERROR__:` 后，`decodeIpcError` 在 renderer 解析回。路由（`src/main/ipc/router.ts`）对同步抛出与 promise 拒绝都编码，并把 Zod 错误规整为 `IPC_INPUT_INVALID`。`details` 经 JSON 往返净化。详见 [04 跨进程契约](./04-ipc-and-contracts.md)。
- **renderer 消费**：客户端包装器（`platform/electron/ipc-errors.ts`）重抛解码后的 `TanzoError`，UI 代码按 `error instanceof TanzoError ? error.code` 分支。

## 2. 日志（`electron-log`）

- **main**（`src/main/logger.ts`）：用 `electron-log/main`。`initializeLogger` 设文件级别 `info`（5 MB 上限，`main.log`）、控制台级别打包时 `warn` / dev 时 `debug`、scope 填充，以及全局未捕获错误捕捉器（记日志不弹窗）。`createLogger(scope)` 产出作用域 logger（默认 scope `main`）；子系统各建自己的（`'agent.module'`、`'policy'`、`'agent.ipc'`……）。
- **renderer**（`src/renderer/src/common/logger.ts`）：用 `electron-log/renderer`，按 scope logger（默认 `renderer`）。这就是 `electron-log` 被排除出 preload 外置的原因（见 [40 构建与发布](./40-build-and-release.md)）。

## 3. 遥测

遥测（`src/main/agent/telemetry/*`）包裹 AI SDK 的遥测集成，把规范化事件扇出到四个 sink：UI sink（瞬态 `data-telemetry` chunk）、logger sink、memory sink，以及把 `tool-finish` 事件持久化进 `tool_executions` 的 DB sink。token/用量计量另在 `runs` / `run_steps`。Usage 面板经 `repositories/activity-repo.ts` 读回。详见 [22 持久化](./22-persistence.md) 与 [23 工作区集成](./23-workspace-integrations.md)。

## 4. 安全姿态

安全是防御性深度，在每个面独立施加（[01 引言](./01-introduction.md) 的不变量 §3.7）：

- **窗口沙箱** —— 两窗口都用 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、导航白名单与 `<webview>` 加固。见 [03 进程模型](./03-process-model.md)。
- **路径沙箱** —— 每个文件系统面施加工作区包含 + 符号链接 `realpath` 校验 + 凭证路径拒绝（`security/path-safety.ts`、`fs/workspace-fs.ts`、`search/backend.ts`）。即便 `dangerous` 模式仍拦截凭证路径。见 [12 工具系统](./12-tools.md)。
- **剥离 shell 环境** —— `safeChildEnv`（`src/main/safe-env.ts`）从每个派生 shell、后台会话、钩子、stdio MCP 服务器的环境移除 API 密钥 / secret / token / 供应商名。
- **破坏性命令拦截** —— 策略引擎内置规则拒绝 `rm -rf /`、凭证读取、`mkfs`、`dd` 写块设备、fork 炸弹等。见 [13 策略与审批](./13-policy-and-approval.md)。
- **凭证绝不明文跨 IPC** —— provider 密钥经 Electron `safeStorage` 加密，离开 main 时恒打码。见 [20 供应商运行时](./20-providers.md)。
- **浏览器自动化边界** —— 内置 chrome-devtools-mcp 服务器针对仅 loopback 的调试端口启动，带 `--blockedUrlPattern file://**`，故 agent 无法驱动应用自身 renderer。见 [21 MCP 集成](./21-mcp.md)。
- **审批门** —— 敏感工具调用经 hooks `PreToolUse` 与策略引擎；审批活在消息里。见 [13 策略与审批](./13-policy-and-approval.md)。

## 5. 国际化

`src/renderer/src/i18n.ts` 经 `i18next` / `react-i18next` 支持 `en` 与 `zh-CN`。初始语言从系统首选语言/区域派生（`resolveLanguage` 把任意 `zh*` 映到 `zh-CN`，否则 `en`），`fallbackLng: 'en'`，出错时英文回退重初始化。`getLocale` 返回 `zh-CN` / `en-US`。活动语言经 `I18nLanguageSync` 跟随 `preferences.language`。区域资源在 `src/renderer/src/locales/`。见 [30 渲染层](./30-renderer.md)。

## 6. 主题

主题基于 CSS 变量（`src/renderer/src/common/theme/*`）。`applyThemeSettings` 在 `document.documentElement` 写调色板变量（`--<key>`）与覆盖变量（`--radius`、`--spacing`、`--font-*`、`--shadow-*`、`--font-size-base`）加 `data-*` 属性；`ThemeInitializer` 在偏好或解析主题变化时重新应用。预设用 OKLCH 色值，自定义主题由快照驱动。明/暗解析存在 preferences（真源），非 react-query。见 [30 渲染层](./30-renderer.md)。

---

至此架构文档全套完成。回到[索引](./README.md)查看阅读路径，或从 [01 引言](./01-introduction.md) 重新开始。
