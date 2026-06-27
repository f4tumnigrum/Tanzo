# 23 · 工作区集成

> 适用范围：Git、ChangeSet、文件提及、Slash Commands、Usage/Activity、Pet 这些围绕工作区与对话体验的集成子系统。最后核对：`src/main/agent/git/*`、`src/main/file-mention/*`、`src/main/slash-command/*`、`src/main/agent/ipc/activity.ts`、`src/main/pet-window.ts`、`src/main/pet/module.ts`。

## 1. 定位

这些子系统不是 Agent 内层工具循环的一部分，但围绕同一组主真源协作：

- main 拥有副作用与持久化，renderer 只通过 preload IPC 客户端访问。
- Git 与 ChangeSet 绑定 conversation `cwd`，为 Chat 页面提供工作区状态与 run 级变更预览。
- Slash/FileMention 属于输入体验：在 renderer 组合提示，在 main 读技能/文件系统索引。
- Activity/Usage 是只读分析层，聚合 runtime/telemetry 已落地的数据。
- Pet 是第二 renderer 入口，通过 presence 聚合器观察 Agent 流并呈现状态。

## 2. Git 服务

`createGitService` 在 `agent/module.ts` 中创建，依赖 `simple-git` 操作封装与 `createGitWatcher`：

- 只读 API：overview/status/diff/history/commit/branches/remotes/user。
- 写 API：init/stage/restore/discard/commit/fetch/pull/push/checkout/branch/remote/user。
- 返回值统一是 `GitResult<T>`，跨 IPC 不用异常表达业务失败。
- watcher 按 cwd 注册，文件变化广播 `git:event`，renderer 的 Git controller 收到后去抖刷新。

renderer 入口在 Chat 页 header：`WorkspaceGitPill` 打开 `GitReviewDialog`，由 `useGitReviewController` 持有状态和写操作。

## 3. ChangeSet

`createChangeSetService({ userDataPath })` 负责 run 级工作区变更捕获：

1. `TurnLoop.run` 在模型运行前调用 `captureBeforeRun({ runId, chatId, assistantMessageId, cwd })`。
2. 若 cwd 是 git repo，服务创建 before checkpoint，并把 pending capture 存在内存 Map。
3. run 结束后 `captureAfterRun` 创建 after checkpoint，计算 diff entries，生成 `ChangePreviewData`。
   - 例外：若该 run 因等待工具审批而自然停止（历史仍含 `approval-requested`），`TurnLoop.run` **不** finalize，而是按 chatId 把 before-checkpoint 暂存，等审批通过后的续跑 run 复用同一 capture——保证一个逻辑回合只生成一次 preview，且不会在审批卡片下提前出现。`cancel`/删除会通过 `discardPendingChangeCapture` 丢弃暂存，避免泄漏。
4. preview 写入 `workspace-change-sets.json`（userData，最多保留 500 条），并作为 `data-changePreview` 追加到最后一条 assistant message。
5. `applyChangeSet` 可把选中路径恢复到 before/after tree，且会根据当前树、更新变更与路径交集计算 `restoreRisk`。

ChangeSet 使用 git tree/checkpoint 做物化，不依赖 renderer 本地状态。

## 4. File Mention

`createFileMentionModule()` 注册 `file-mention:*` IPC。service 面向 composer 的 `@file` 补全：

- 在 main 侧用文件系统/模糊匹配生成候选，避免 renderer 直接读 Node 文件系统。
- 契约在 `src/shared/file-mention.ts`，renderer 通过 `platform/electron/file-mention-client.ts` 使用。
- 它只服务输入补全，不授予 Agent 额外读权限；真正读文件仍走工具系统的 `WorkspaceFs` 沙箱。

## 5. Slash Commands

`createSlashCommandModule({ skills })` 依赖 Agent 的 `SkillsStore`：

- store 从 app userData 下的 agent 目录加载用户 slash command 定义。
- service 把用户命令与技能命令聚合给 renderer。
- renderer composer 用 `parseSlashInput` 与 `expandTemplate`：`action` 命令本地执行（如 compact/goal/agent），`prompt` 命令展开模板，`skill` 命令转成 “Use the X skill...” 提示。

Slash 是输入层协议，不绕过 Agent runtime；最终仍转成普通用户消息或本地 action IPC。

## 6. Usage / Activity

Activity 是 telemetry 的只读投影：

- DB sink 把工具完成事件写入 `tool_executions`。
- run/prompt 诊断写入 `runs`、`run_steps`、`prompt_diagnostics`。
- `activityHandlers` 暴露 summary/trend/reliability/conversations/runs/runDetail。
- Settings → Usage 嵌入 `UsagePage`，用 `activityClient` + React Query 读取聚合结果。

Activity 不参与 Agent 决策；它只读取 main SQLite 中已有事实。

## 7. Pet 集成

Pet 有两个层次：

- **窗口层**：`pet-window.ts` 创建透明、置顶、点击穿透的第二 BrowserWindow，使用同一 preload，加载 `pet.html → pet.tsx → PetApp`。
- **资源层**：`pet/module.ts` 从 `~/.tanzo/pets`、`~/.codex/pets`、app resources、asar-unpacked resources 扫描 `pet.json + spritesheet.webp`，只接受安全 id。

状态来源是 `agent/presence/aggregator.ts`：Agent chunk sink 观察 text、telemetry、approval、change preview 等事件，推导 thinking/running-tool/waiting-approval/review/done/error 等状态，再广播 `pet:presence-changed`。Pet renderer 可设置 active chat、命中矩形与拖拽状态，但不持有 Agent 真源。

## 8. 集成不变量

- [ ] Git/ChangeSet 以 conversation cwd 为边界，renderer 不直接执行 git。
- [ ] ChangeSet preview 来自 git checkpoint，最终随 assistant message 与 `data-changePreview` 对齐。
- [ ] Slash/FileMention 只改善输入体验，不绕过 Agent 工具沙箱。
- [ ] Activity/Usage 是只读投影，不影响 runtime 决策。
- [ ] Pet 是观察者窗口；状态从 presence 聚合器广播，不反向驱动 Agent。

下一篇 → [30 渲染层架构](./30-renderer.md)
