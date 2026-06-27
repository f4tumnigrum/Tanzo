# 50 · 横切关注点

> 适用范围：错误模型、日志、遥测、安全姿态、i18n、主题、偏好。最后核对：`src/shared/errors.ts`、`src/main/logger.ts`、`agent/telemetry/*`、`agent/security/*`、`src/main/preferences.ts`。

## 1. 错误模型

跨进程统一的 `TanzoError` 体系（`src/shared/errors.ts`）：

- 基类带 `code`、`recoverable`、`details`；子类 `Invariant`/`Configuration`/`Validation`/`NotFound`/`Operation`/`Integration`/`Auth`/`Timeout`。
- `ERROR_CODES` 集中注册表。
- 跨 IPC 经 `encodeIpcError`/`decodeIpcError`（标记 `__TANZO_IPC_ERROR__:` + JSON），renderer 客户端层 `withDecodedIpcError` 还原。
- Zod 校验失败统一为 `TanzoValidationError('IPC_INPUT_INVALID')`。

约定：跨边界抛 `TanzoError` 子类而非裸 `Error`；`recoverable` 标志指导 UI 是否提供重试。git domain 用 `GitResult<T>` 包裹而非抛异常（[04 跨进程契约](./04-ipc-and-contracts.md) §5.3）。

## 2. 日志

`src/main/logger.ts` 基于 `electron-log`。`initializeLogger()` 在 ready 前调用，`createLogger(scope)` 产出带作用域的 logger。preload 刻意打包 `electron-log`（[40 构建与发布](./40-build-and-release.md) §1）以便预加载期可记日志。

## 3. 遥测（`agent/telemetry/*`）

`createAgentTelemetry` 适配 ai-sdk 的 `Telemetry` 集成，规整事件经多 sink 分发：

- **UI sink**：`data-telemetry` chunk → renderer，驱动 RunNotice 与 pet presence。
- **logger sink**：结构化日志。
- **memory sink**：测试用。
- **DB sink**（`createDbTelemetrySink`）：把 `tool-finish` 事件写 `tool_executions`，供 Usage 面板。

事件覆盖 onStart/onStepStart/onLanguageModelCall*/onToolExecution*/onChunk/onFinish/onError，含重试跟踪。诊断侧 `diagnostics/prompt-cache.ts` 产 prompt 缓存分段诊断落 `prompt_diagnostics`。

## 4. 安全姿态

汇总各文档的安全要点（详见对应章节）：

| 面 | 措施 | 位置 |
|---|---|---|
| 窗口 | `contextIsolation`+`sandbox`+`nodeIntegration:false`，导航白名单 | [03 进程模型](./03-process-model.md) §4.3 |
| IPC | 错误归一化，Zod 入参校验 | [04 跨进程契约](./04-ipc-and-contracts.md) |
| 文件/检索/shell | 工作区沙箱 + symlink realpath 复校 + 凭证路径拒绝 | [12 工具系统](./12-tools.md) §4 |
| 命令 | 破坏性 shell 命令内置策略硬拒（含 stdin 向量） | [13 策略与审批](./13-policy-and-approval.md) §4 |
| 工具审批 | 集中决策，失败安全降级为 user-approval | [13 策略与审批](./13-policy-and-approval.md) §2 |
| 凭证 | OS `safeStorage` 加密，明文不跨 IPC，只露掩码 | [20 供应商](./20-providers.md) §5 |
| Hooks | 任意代码执行入口必须 enabled ∧ trusted 才运行 | [14 钩子系统](./14-hooks.md) |
| MCP | http/sse 仅允许 `http:`/`https:`、默认禁重定向、env 净化 | [21 MCP 集成](./21-mcp.md) §4 |
| 协议 | `tanzo-asset://` 特权协议带文件名防穿越 + 扩展名白名单 | `src/main/wallpaper.ts` |
| 资源 id | wallpaper/pet/技能/slash 根都有 traversal 守卫 | 各模块 |

共享路径安全常量在 `src/main/agent/security/path-safety.ts`，fs/search/policy 三处复用——单一真源、防御性深度。

**新增网络暴露面须显式审查**：当前 Tanzo 不开本地端口（对话走 IPC，见 [04 跨进程契约](./04-ipc-and-contracts.md)）；新增任何监听服务都应评估认证与访问控制。

## 5. i18n

`src/renderer/src/i18n.ts` + `locales/en.ts`、`locales/zh-CN.ts`。启动据系统偏好解析语言，`react-i18next` 提供。`I18nLanguageSync` 保持 `i18n.language` 同步于 `preferences.language`。`lib/i18n-key.ts` 提供类型化键；非 React 代码用默认 `i18n` 导出（如 git 控制器错误串）。新增文案两套语言都要补。

## 6. 主题与偏好

- **偏好真源在 main**（`src/main/preferences.ts`）：JSON 落 `userData/preferences.json`，原子写（临时文件 + rename），每次读写经 `normalizePreferences` 夹紧/校验，损坏文件降级为默认。变更广播到所有窗口 + 进程内监听器（驱动 pet 生命周期与 `themeSource`）。
- **主题**（renderer，[30 渲染层](./30-renderer.md) §6）：CSS 变量 + 预设，状态全部落 preferences，故跨重启持久。

## 7. 横切不变量

- [ ] 跨边界抛 `TanzoError` 子类，经 encode/decode 保真。
- [ ] 路径安全常量单一真源，fs/search/policy 复用。
- [ ] 凭证不以明文跨 IPC / 不落明文。
- [ ] 偏好在 main 规整、广播；renderer 水合。
- [ ] 新增网络监听面须评估认证。

← 返回 [文档索引](../README.md)
