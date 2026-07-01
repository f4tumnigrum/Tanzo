# 01 · 引言与定位

> 适用范围：全局心智模型与设计原则。最后核对：对照 `src/`（v0.2.4）当前实现。

## 1. 产品定位

Tanzo 是一个**纯 Electron 桌面应用**（非 monorepo packages 拆分），定位为 AI 原生的本地工作空间：在用户本机的工作区里规划、编码与自动化。它围绕一个**对话式 Agent** 构建，Agent 能读写工作区文件、执行 shell、检索代码、调用 MCP 服务器与供应商原生工具，并在用户监督下完成多步任务。

关键事实（来自 `package.json`）：

- `name: tanzo`，`main: ./out/main/index.js`，作者 `f4tumnigrum`（`Lumin Studio` 仅作为 appUserModelId `com.luminstudio.tanzo` 与打包 maintainer 出现）。
- 运行时核心依赖 `ai@7.x-beta` 与 `@ai-sdk/*` 一系列 beta provider 包；UI 用 React 19、`@tanstack/react-query`、`zustand`、`react-router-dom@7`；持久化用 `better-sqlite3`；检索用 `@vscode/ripgrep`；MCP 用 `@ai-sdk/mcp`。

## 2. 设计目标

1. **深度复用 AI SDK v7 的 agent 基底**，而不是重新发明消息协议、turn loop 或归约器。
2. **三进程职责清晰**：main 持有一切真源与副作用，renderer 只做呈现与交互，preload 只做受控桥接。
3. **能力靠「加 part」生长**：新增一个 agent 能力 = 一个工具（main）+ 一个数据/工具 part 类型（shared）+ 一个渲染组件（renderer），主干零改动。
4. **安全默认**：窗口沙箱化、路径沙箱、凭证不出进程、破坏性命令拦截、工具审批可控。
5. **可观测**：每次运行、每个步骤、每次工具调用都有遥测落库，供 Usage 面板回看。

## 3. 架构原则与不变量

这些不变量贯穿全套文档，是判断「改动是否破坏架构」的标尺。

### 3.1 一种物质（Substance）

对话里流动的一切都是一个 `TanzoUIMessage` 的 `part`：文本、推理、工具调用、文件 diff、计划、子代理进度、遥测，都是 part 的一种类型。类型定义见 `src/shared/agent-message.ts`：

```ts
export type TanzoUIMessage = UIMessage<TanzoMetadata, TanzoDataParts, TanzoTools>
```

`TanzoTools`（工具词汇）与 `TanzoDataParts`（数据 part 词汇）是两套开放联合，三进程共引。详见 [04 跨进程契约](./04-ipc-and-contracts.md)。

### 3.2 一道边界（Seam）

renderer ↔ main 的对话数据只经由 IPC 的 `chat:*` 通道流动，载荷的核心是 `InferUIMessageChunk<TanzoUIMessage>`（流式 chunk）。设置类控制面（`provider:*`、`policy:*`、`mcp:*` 等）是独立的 CRUD 面，不走对话缝。**不开本地端口，不走 localhost-SSE。** 详见 [04 跨进程契约](./04-ipc-and-contracts.md)。

### 3.3 内层循环用 AI SDK 的 `streamText`

main 端**不手写 turn loop**。每个回合用 AI SDK 的 `streamText`（参数由 `buildAgentCall` 组装，`src/main/agent/runtime/build-agent.ts:73`；调用点 `src/main/agent/runtime/stream-runner.ts:278`），靠 `stopWhen` + `prepareStep` 跑「调模型 → 执行工具 → 回灌 → 再调」的多步循环。`TurnLoop` 在其外面只包了一层**压缩 / 续航**的外层循环（上限 `MAX_CONTINUATION_PASSES = 10`，`src/main/agent/runtime/turn-loop.machine.ts:21`）。详见 [10 Agent 运行时](./10-agent-runtime.md)。

### 3.4 审批活在消息里

工具审批不在 main 维护 pending 状态机。`toolApproval` 决策函数返回 `user-approval` 时该回合自然停止；用户响应被写进消息历史，下一次 `stream` 用含响应的完整历史重跑，SDK 看到已批准的调用直接执行。main 唯一**承载正确性**的跨调用状态是取消用的 `AbortController`。详见 [13 策略与审批](./13-policy-and-approval.md)。

### 3.5 main 是唯一真源

消息只持久化在 main 的 SQLite（`messages` 表是**追加日志**，外加 revisions 与 compaction overlays——见 [22 持久化](./22-persistence.md)）。renderer 永不落盘——它在内存里用 `ChatSession` 重建当前对话，运行结束后从 main 重新拉取对齐。详见 [22 持久化](./22-persistence.md)、[30 渲染层](./30-renderer.md)。

### 3.6 每条对话串行、跨对话并发

每个 `chatId` 的所有变更经 `ChatMailbox` 串行执行；不同对话之间并发。同一时刻每条对话只有一个活跃 run（由 `RunEngine` 的 `inflight` map + 每对话 epoch 强制）。详见 [10 Agent 运行时](./10-agent-runtime.md)。

### 3.7 防御性深度的路径与命令安全

文件、检索、shell、wallpaper、pet 资源等每一处对外暴露的文件系统面都独立施加**工作区沙箱 + 符号链接 realpath 校验 + 凭证路径拒绝**；破坏性 shell 命令由策略引擎的内置规则拦截。共享常量在 `src/main/agent/security/path-safety.ts`。详见 [13 策略与审批](./13-policy-and-approval.md)、[50 横切关注点](./50-cross-cutting.md)。

## 4. 不变量自检清单

修改后应能回答：

- [ ] 「X 能力在哪实现」→ 答案落在「一个 tool + 一个 part 类型 + 一个渲染组件」或某个 AI SDK 既有扩展槽。
- [ ] 对话数据只走 `chat:*` 通道，载荷是 `UIMessageChunk`；控制面走各自独立通道。
- [ ] main 没有手写 turn loop；AI SDK 的 `streamText` 是内层执行核心。
- [ ] main 不持有审批状态机；审批活在消息里。
- [ ] renderer 不落盘任何消息；唯一真源是 main 的 SQLite。
- [ ] 每条对话串行（mailbox），单活跃 run（epoch + inflight）。
- [ ] 凭证不以明文跨 IPC；破坏性命令被内置策略拦截。

## 5. 术语表

| 术语 | 含义 |
|---|---|
| **Substance / 物质** | `TanzoUIMessage`，对话里唯一的消息类型 |
| **Part** | 一条消息 `parts[]` 里的一项：text / reasoning / tool-* / data-* / file / source |
| **Chunk** | 流式增量单元 `UIMessageChunk`，跨 IPC 传输，由 AI SDK 在两端各自归约成消息 |
| **Seam / 边界** | renderer ↔ main 的对话缝，即 IPC `chat:*` 通道 |
| **streamText** | AI SDK 的多步工具循环执行核心；参数由 `buildAgentCall` 组装，靠 `stopWhen` + `prepareStep` 多步推进 |
| **Run / 运行** | 一次 `streamText` 驱动的对话回合（可能含多步） |
| **Section** | 上下文工程里组装系统/前导提示的一个声明单元 |
| **Mailbox** | 每 `chatId` 的串行任务执行器 |
| **Subagent / 子代理** | 在工具内嵌套启动的子对话，可前台 / 后台 / 并行 |
| **Skill / 技能** | `SKILL.md` 描述的可渐进披露的能力包 |
| **Module 工厂** | `createXxxModule(deps) → { service?, registerIpc, close? }` 约定 |

下一篇 → [02 系统总览](./02-system-overview.md)
