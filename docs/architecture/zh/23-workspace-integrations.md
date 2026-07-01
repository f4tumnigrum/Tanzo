# 23 · 工作区集成

> 适用范围：Git、ChangeSet、斜杠命令、文件提及、Usage/Activity、Pet——agent 与周边工作区的集成边界。最后核对：`src/main/agent/git/*`、`src/main/agent/*change-set*`、`src/main/slash-command/*`、`src/main/file-mention/*`、`src/main/agent/telemetry/*`（v0.2.4）。

## 1. Git

Git 集成用按 cwd 的客户端池包裹 `simple-git`（`agent/git/ops.ts`）。读：status（`git.status` + `diff --numstat[ --cached]`）、overview、diff（commit / staged / worktree；未跟踪经对空文件的 `diff --no-index`）、history、commit 详情（`--numstat` / `--name-status -z -M -C`）、分支、远程分支、remotes、user。diff 封顶 400 000 字节。写（`agent/git/ops-write.ts`）覆盖 stage/restore/discard/commit/fetch/pull/push/checkout/branch/remote/init，经 `agent/git/service.ts` 暴露。

Git 域返回结果包在 `GitResult<T>` 里而非抛出（见 [04 跨进程契约](./04-ipc-and-contracts.md)）。

**监视器**（`agent/git/watcher.ts`，chokidar）：监视 `.git` 信号文件（`HEAD`、`index`、`MERGE_HEAD`、`ORIG_HEAD`、`FETCH_HEAD`、`packed-refs`、`COMMIT_EDITMSG`……）加 `refs/`，解析 worktree 的 `.git` 文件（`gitdir:` 间接）。变化去抖（250 ms）后广播；watch 引用计数，故同仓多对话共享一个 watcher。

## 2. ChangeSet（运行检查点）

ChangeSet 给每次 agent 运行一个前/后快照，使其文件编辑可预览、可回退，且不触碰用户工作树与 index。

- **存储**：`userData` 下的 `workspace-change-sets.json` 文件（原子写、上限 500、版本化）——**非** SQLite。见 [22 持久化](./22-persistence.md)。
- **捕获**（`captureBeforeRun` / `captureAfterRun`）：经作用域临时 index 构树（`read-tree --empty`、`add -A`、`write-tree`），再 `commit-tree`，再 `update-ref refs/tanzo/runs/<runId>/{before|after}`。所有 git 调用用作用域环境（`GIT_DIR` / `GIT_WORK_TREE` / `GIT_COMMON_DIR` / `GIT_INDEX_FILE`）与 Tanzo 作者/提交者身份，故用户真实 index 绝不被改。
- **预览**（`ChangePreviewData`）：通过比较 before/after/current 的 blob 映射计算，逐文件 patch 经 `diff-tree -p … --binary`；应用/恢复经 `checkout-index` 到目标树，受路径安全守护。
- **运行接线**（`agent/runtime/turn-loop.ts`）：`captureBeforeRun` 在运行前跑；运行后 ChangeSet 被终结（或丢弃），diff 预览作为 `data-changePreview` part 附到最后助手消息。捕获跨审批暂停被延后，使 before 树覆盖整个逻辑回合。详见 [10 Agent 运行时](./10-agent-runtime.md)。

## 3. 斜杠命令

斜杠命令是文件系统 markdown，无 SQLite。store（`slash-command/store.ts`）扫描 `~/.tanzo/commands`、`<userData>/commands`、`<workspace>/.tanzo/commands` 的 `*.md`（后面的根覆盖前面）。每文件有 frontmatter（`description`、`argument-hint`）与 body 模板（`kind: 'prompt'`）。service（`slash-command/service.ts`）把文件命令与暴露为 `kind: 'skill'` 的启用技能合并（重名时文件名赢）。斜杠命令模块依赖 agent 的技能库（见 [03 进程模型](./03-process-model.md)）。

## 4. 文件提及（`@`）

`@` 提及检索由 ripgrep 支撑，无 SQLite（`file-mention/service.ts`）：跑 `rg --files --hidden --glob '!**/.git/**'` 加敏感路径排除，把扫描封顶 20 000 文件、8 MB 输出，返回至多 20 个排序结果。排序是模糊匹配（`file-mention/fuzzy.ts`），支持 `dir/leaf` 前缀导航。它与检索后端共享凭证排除常量（见 [12 工具系统](./12-tools.md)）。

## 5. Usage / Activity（遥测）

遥测是一个控制器（`agent/telemetry/index.ts`），包裹 AI SDK 的遥测集成（`onStart` / `onStepStart` / `onLanguageModelCall*` / `onToolExecution*` / `onStep*` / `onEnd` / `onError`），把规范化事件扇出到 sink（`agent/telemetry/sinks.ts`）：

- **UI sink** —— 流给 renderer 的瞬态 `data-telemetry` chunk。
- **logger sink**、**memory sink**。
- **DB sink** —— 只把 `tool-finish` 事件（chat 作用域）持久化进 `tool_executions`。

token/用量计量另在 `runs` / `run_steps`（见 [22 持久化](./22-persistence.md)）。Usage 面板读层（`repositories/activity-repo.ts`）在 runs/run_steps/tool_executions/conversations 上计算 KPI、趋势、可靠性与逐运行详情。详见 [30 渲染层](./30-renderer.md)。

## 6. Pet

桌宠是一个可选覆盖窗口，映射 agent presence 并浮出快捷审批。其窗口机制（点击穿透、命中矩形轮询、与主窗口的生命周期耦合）见 [03 进程模型](./03-process-model.md)；presence 数据来自 agent 的 `PresenceAggregator`（`agent/presence/*`），资源由 `pet` 模块服务。renderer 侧是 `pet` 特性与 `pet.html` 入口（见 [30 渲染层](./30-renderer.md)）。

下一篇 → [30 渲染层架构](./30-renderer.md)
