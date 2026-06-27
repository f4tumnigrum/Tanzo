# Tanzo 架构文档

> Tanzo 是一个 AI 原生的桌面工作空间（Electron + React 19），用于规划、编码与自动化。本套文档描述其**当前实现**的架构：进程模型、跨进程契约、Agent 运行时、上下文工程、工具与策略、供应商与 MCP、持久化、渲染层与构建发布。

本套文档面向工程读者，目标是让一名新加入的工程师能在不读完全部源码的情况下，建立准确的系统心智模型，并能定位「某个能力在哪里实现」。

## 阅读路径

- **第一次接触 Tanzo** → 按顺序读 [01 引言与定位](./architecture/01-introduction.md) → [02 系统总览](./architecture/02-system-overview.md) → [03 进程模型](./architecture/03-process-model.md)。
- **要改对话 / Agent 行为** → [10 Agent 运行时](./architecture/10-agent-runtime.md) → [11 上下文工程](./architecture/11-context-engineering.md) → [12 工具系统](./architecture/12-tools.md) → [13 策略与审批](./architecture/13-policy-and-approval.md) → [14 钩子系统](./architecture/14-hooks.md)。
- **要改前端 / 渲染** → [04 跨进程契约](./architecture/04-ipc-and-contracts.md) → [30 渲染层架构](./architecture/30-renderer.md)。
- **要改模型接入 / MCP** → [20 供应商运行时](./architecture/20-providers.md) → [21 MCP 集成](./architecture/21-mcp.md)。
- **要懂数据落地 / 工作区集成** → [22 持久化](./architecture/22-persistence.md) → [23 工作区集成](./architecture/23-workspace-integrations.md)。

## 文档地图

### 基础（Foundations）

| # | 文档 | 内容 |
|---|---|---|
| 01 | [引言与定位](./architecture/01-introduction.md) | 产品定位、设计目标、架构原则与不变量、术语表 |
| 02 | [系统总览](./architecture/02-system-overview.md) | 高层组件图、端到端数据流、技术栈 |
| 03 | [进程模型](./architecture/03-process-model.md) | 三进程切分、启动与关闭时序、窗口模型、安全基线 |
| 04 | [跨进程契约](./architecture/04-ipc-and-contracts.md) | IPC 路由、`@shared` 契约、错误编解码、通道命名约定 |

### Agent 核心（Agent Core）

| # | 文档 | 内容 |
|---|---|---|
| 10 | [Agent 运行时](./architecture/10-agent-runtime.md) | 模块工厂、`AgentService`/`RunEngine`/`TurnLoop` 分层、`streamText` 内层循环、并发与持久化 |
| 11 | [上下文工程](./architecture/11-context-engineering.md) | Section × Provider 模型、缓存前沿、预算、压缩与 fork、工具记录规整 |
| 12 | [工具系统](./architecture/12-tools.md) | 三来源合并、内置工具目录、fs/git/search/shell 沙箱、技能、子代理 |
| 13 | [策略与审批](./architecture/13-policy-and-approval.md) | `toolApproval` 决策函数、规则优先级、权限模式、内置护栏、审批记忆 |
| 14 | [钩子系统](./architecture/14-hooks.md) | 与 Codex/Claude Code 兼容的子进程钩子：事件触发、载荷契约、信任模型、设置 UI |

### 平台集成（Platform）

| # | 文档 | 内容 |
|---|---|---|
| 20 | [供应商运行时](./architecture/20-providers.md) | `ProviderRuntime`、五家适配器、模型解析、凭证与密钥安全、Provider Options |
| 21 | [MCP 集成](./architecture/21-mcp.md) | 服务器生命周期、工具暴露、Elicitation 往返、传输与重连 |
| 22 | [持久化](./architecture/22-persistence.md) | SQLite 连接与迁移框架、表与归属、消息存储形态、恢复与隔离 |
| 23 | [工作区集成](./architecture/23-workspace-integrations.md) | Git、ChangeSet、Slash、文件提及、Usage/Activity、Pet 集成边界 |

### 前端与交付（Frontend & Delivery）

| # | 文档 | 内容 |
|---|---|---|
| 30 | [渲染层架构](./architecture/30-renderer.md) | App Shell、ChatSession、流传输、Part 渲染注册表、状态分层、特性模块 |
| 40 | [构建与发布](./architecture/40-build-and-release.md) | electron-vite 三入口、typecheck 门禁、electron-builder、测试 |
| 50 | [横切关注点](./architecture/50-cross-cutting.md) | 错误模型、日志、遥测、安全姿态、i18n、主题 |

## 文档维护约定

- 每篇文档顶部标注**适用范围**与**最后核对时间**。文档描述的是当前代码，不是历史方案或未来计划。
- 所有断言尽量给出**源码坐标**（`文件:行` 或符号名），便于核对与防漂移。
- 出现「待核实」标记的内容，表示需要运行时验证或在另一篇文档中展开，不应当作既成事实。
- 修改架构时，先改代码再改文档；文档与代码冲突时，**以代码为准**并更新文档。
