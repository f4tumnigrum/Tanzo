# 12 · 工具系统

> 适用范围：三来源工具合并、内置工具目录、fs/检索/shell 沙箱、技能、子代理。最后核对：`src/main/agent/tools/*`、`fs/workspace-fs.ts`、`search/*`、`shell/*`、`security/path-safety.ts`（v0.2.4）。

## 1. 三来源合并

`createBuildTools(deps)` 返回一个异步 `BuildTools`，每回合组装一个 `ToolSet`（`tools/registry.ts:88-130`）。合并顺序（后键覆盖，`registry.ts:101-113`）：

1. `builtinTools(def, deps)` —— 8 个内置。
2. `await mcpTools(def, deps)` —— MCP 工具，键名以 `mcp__<server>__<tool>` 命名空间（`tools/mcp.ts`）。
3. `providerTools(def)` —— **当前为空占位**，返回 `{}`（`tools/provider.ts:4-7`）。故"三来源"实为内置 + MCP，加上接下来注入的编排工具。
4. 编排工具，按条件加入：`skill`、`todo` 恒有；`askQuestion` 仅主 agent；`shellBackgroundTools`；`subagentTools` 仅当 `canDelegate`；子代理 `report` 工具仅当自身是子代理；`goalTools`（`updateGoal`）仅主 agent；`exitPlanMode` 仅计划模式或此前有 `exitPlanMode` 审批时。

合并后过滤：

- **用户禁用工具**先于 allowlist 丢弃（`registry.ts:117-122`，经 `deps.disabledTools()`）。详见 [50 横切关注点](./50-cross-cutting.md)。
- **Agent `allowedTools`** allowlist：`null` = 全通过；否则经 `toolKeyMatchesPattern` 做 glob/前缀匹配（`registry.ts:123-129`）。

## 2. 内置工具与自动放行

只读分类由每个工具的 `metadata.tanzo.kind`（`'read' | 'search' | 'edit' | 'exec'`）驱动。`build-agent.ts:16-33` 为策略引擎提取它。8 个内置（`tools/builtin/index.ts:18-29`）：

| 工具 | kind | 只读（自动放行） |
|---|---|---|
| `fileRead` | `read` | 是 |
| `fileEdit` | `edit` | 否 |
| `multiEdit` | `edit` | 否 |
| `fileWrite` | `edit` | 否 |
| `glob` | `search` | 是 |
| `grep` | `search` | 是 |
| `shell` | `exec` | 否 |
| `browserOpen` | `exec` | 否 |

编排工具同规则：`skill`、`askQuestion`、`await`、`tasks`、`report`、`shellPoll`、`shellList` 为 `read`（可自动放行）；`shellStart` / `shellWrite` / `shellStop`、`spawn` / `steer` / `cancel`、`todo`、`updateGoal` 为 `exec`（需审批）。`exitPlanMode` 无 `kind`——恒需审批（见 [13 策略与审批](./13-policy-and-approval.md)）。

MCP 工具 kind 由注解推导（`tools/mcp.ts`）：`readOnlyHint === true && destructiveHint !== true` ⇒ `kind: 'read'`；否则 `kind: 'edit'`（未知注解默认 `edit`，即需审批）。

用户可见目录（`src/shared/tool-catalog.ts`）镜像这些只读标志供设置里切换；仅这 8 个工具可切换（编排/MCP/provider 工具有意排除）。详见 [50 横切关注点](./50-cross-cutting.md)。

## 3. 路径安全（沙箱、符号链接 realpath、凭证拦截）

两层：`security/path-safety.ts` 的常量/谓词，以及 `fs/workspace-fs.ts` 与 `search/backend.ts` 的施行。

### 3.1 常量（`security/path-safety.ts`）

- `SENSITIVE_PATH_PATTERN`（`.ssh`、`.aws`、`.env` / `.envrc`）、`GIT_PATH_PATTERN`（`.git`）、`SENSITIVE_RIPGREP_EXCLUDES`。
- 谓词 `isSensitivePath` / `isGitPath` 与断言 `assertNonSensitivePath` / `assertNonGitPath`（抛 `TanzoValidationError`）。

### 3.2 工作区沙箱 + 符号链接 realpath（`fs/workspace-fs.ts`）

- `within(target, base)` = 相对路径且不以 `..` 开头、非绝对。
- 读路径：`resolveRead` 先（词法）断言非敏感，再要求在 root 或已注册读根内，否则 `FS_PATH_ESCAPE`。写路径：`resolveWrite`。
- **符号链接 realpath 校验（读）**：`assertRealWithinRead` 调 `realpath(abs)`，对 `realpath(root)` 与真实读根重新校验包含，并对解析后的真实路径重新断言非敏感。每个读者都施行它。
- **符号链接 realpath 校验（写）**：`assertRealWithinWrite`；父目录逐段经 `realpath` 校验；写为原子（tmp + rename）。
- **危险模式**（`options.dangerous`）在各处绕过包含，但**仍拦截凭证路径**（对解析后的真实路径）。
- 读根由技能工具扩展：`deps.fs.registerReadRoot(resolved.skillDir)`（`tools/skill.ts`），使技能能读自身 bundle 目录。

### 3.3 检索沙箱（`search/backend.ts`）

`assertSafeSearchPath` = 非 git + 非敏感；默认排除（`.git` + 敏感 glob）注入每次 ripgrep 调用。`resolveScope` 对解析后目标施 `within`，并对 root + target 的 `realpath` 重新校验以防符号链接逃逸。

### 3.4 策略级凭证/git 拒绝

独立于 fs 层，策略引擎拒绝 `path` 参数匹配 `.git`（`b.git`）或敏感模式（`b.ssh`）的工具调用，并拒绝读取凭证文件的 shell 命令。详见 [13 策略与审批](./13-policy-and-approval.md)。

## 4. Shell 执行

### 4.1 剥离环境（`src/main/safe-env.ts`）

`SENSITIVE_ENV_KEY_RE` 匹配 API 密钥 / secret / token / 密码及供应商名（OPENAI、ANTHROPIC、GEMINI、AWS、GCP、AZURE……）。`safeChildEnv(overrides?, source = process.env)` 复制环境但去除敏感键，应用于**每次** shell 派生——前台（`shell/runner.ts`）与后台（`shell/session-service.ts`）。

### 4.2 Shell 解析（`shell/resolve.ts`）

候选：POSIX `$SHELL → bash → sh` 用 `-lc`；Windows `pwsh.exe → powershell.exe → cmd.exe`。

### 4.3 前台 shell（`shell/runner.ts` + `tools/builtin/shell.ts`）

流式生成器；非 Windows 上 `detached`（自成进程组）并做进程树 kill（POSIX `process.kill(-pid, 'SIGKILL')`，Windows `taskkill /t /f`）。kill 原因映射到退出码（超时 = 124，abort/closed = 130）并带宽限拆解。`shell` 工具默认 120 000 ms 超时（夹到 `[1s, 30min]`），输出头+尾封顶 30 000 字符，剥除 ANSI，workdir 经 `deps.fs.resolveWorkspace`（沙箱）解析。

### 4.4 后台会话（`shell/session-service.ts` + `tools/shell-background.ts`）

每对话会话，`assertOwnSession` 拦截跨对话访问；最多 32 会话并对非运行者 LRU 剪枝；头/尾文本窗（默认 60 000 字符）。工具面为 `shellStart` / `shellPoll` / `shellWrite` / `shellStop` / `shellList`，workdir 同样沙箱化。dev 服务器、watch 任务、日志跟随即靠它在 agent 继续时保持运行。

### 4.5 破坏性命令拦截

内置策略拒绝规则作用于 `{shell, shellStart}.command` 与 `shellWrite.input`：对 `/ ~ * ..` 的递归/强制 `rm`（`b.rmrf`）、凭证文件读取（`b.cred-read`）、`rm --no-preserve-root`、fork 炸弹、`dd` 写块设备、`mkfs*`、重定向到 `/dev/disk…`。均 `action: 'deny'`，优先级 0，来源 builtin。详见 [13 策略与审批](./13-policy-and-approval.md)。

## 5. 检索后端（ripgrep）

二进制从 `@vscode/ripgrep` 解析，带 `.asar` → `.asar.unpacked` 回退与可执行检查（`search/ripgrep.ts`）。`createSearchBackend(root, { dangerous })`（`search/backend.ts`）以 30 秒超时、16 MiB stdout 上限（触顶 SIGKILL）派生 rg，恒传 `--hidden` 与默认排除（`.git` + 敏感 glob）。模式：`content`（`--json`，解析，列封顶 500）、`files`（`-l`，按 mtime 排序）、`count`（`-c`）。`glob` 用 `--files --glob` 并按 mtime 降序。无效 `type`（对照 `rg --type-list` 校验）表现为 `GREP_INVALID_TYPE`。结果上限：grep 与 glob 默认头 50、上限 500。

## 6. 子代理

### 6.1 工具面（`tools/subagent.ts`）

`subagentTools(deps, parentChatId, agentTypes)` 返回 `{ spawn, await, tasks, steer, cancel }`：

- `spawn` 对每个 `spec.agent` 校验可用类型，逐个 `deps.spawnTask(...)`，并**立即返回**可读 id（如 `explore-1`）与一个 `await(...)` 提示。一次调用多个 spec 即成**并行/并发**后台任务。静态依赖错误（自依赖、依赖 id 不存在）在任何写入前拒绝，坏 spawn 不会留下孤儿 executor 会话；批量中靠后的 spec 失败时，错误会列出已启动的 id。`kind: 'exec'`。
- `await` 以 `settle: 'all' | 'first'` 与可选 `timeoutMs` 阻塞在 `deps.awaitTask`（超时后任务继续跑）。未知 id 在 `unknown` 字段显式返回而非静默丢弃；结果携带 `failureKind`（`app-restart` | `logic-error` | `await-cancelled`）与 `resultSource`（`explicit` | `inferred`）供父代理判断置信度。`kind: 'read'`。
- `tasks`（read）、`steer`（`instruction` 经 `instructTask` 追加；`objective` 经 `redefineTask` 重启——入参 schema 为 union，二者必选其一）、`cancel`。

steer 已结算任务（结果已定稿；应 spawn 新任务）或依赖阻塞任务（不可绕过门控）时会被拒绝并返回可操作的错误。

子代理侧经 `report` 工具（`tools/subagent-control.ts`）回报：`phase → reportTaskPhase`、`result → submitTaskResult`；此工具仅为子代理加入。子代理未调用 `report(result)` 即结束时，结果从最后一条 assistant 文本推断（`resultSource: 'inferred'`）；若该文本也为空，任务**失败**（`failureKind: 'logic-error'`）而非以空 summary 完成。进度经 `chat:task-event` 到 UI（见 [04 跨进程契约](./04-ipc-and-contracts.md)）。

前台 vs 后台：spawn 恒为后台/异步；"前台"只是父调 `await` 阻塞取结果。实际调度委托给 `AgentService`（`deps.spawnTask` / `awaitTask`），任务 id 以 `deps.rootOf(parentChatId)` 为根。

### 6.2 深度与可用性（`tools/registry.ts`）

`DEFAULT_MAX_SUBAGENT_DEPTH = 3`（`registry.ts:35`）；有效上限 = `def.maxSubagentDepth ?? 3`。`canDelegate = depth < maxDepth && hasAvailableTypes`；为 false 则不加子代理工具。

**计划模式限制**：`plan` 模式下只提供只读子代理。子代理"安全只读"当且仅当其 `allowedTools` 全在 `READ_ONLY_SUBAGENT_TOOLS`（`fileRead`、`glob`、`grep`、`skill`、`await`、`tasks`、`report`、`shellPoll`、`shellList`、`web_search`）。不可用类型带原因「plan mode allows read-only sub-agents only」。

四个内置 agent（`tanzo`、`explore`、`verify`、`review`）以 markdown 定义在 `src/main/agent/agents/builtin/`。详见 [10 Agent 运行时](./10-agent-runtime.md)。

### 6.3 并发模型（`subagent/task-service.ts`）

两层信号量限制同时运行的子代理流：**全局**上限（100）覆盖所有会话，**每根会话**上限（20）防止单个会话占满全局槽位。driver 先取根会话槽再取全局槽；获取途中被 abort 会回滚已持有的槽。两个上限均可经 `createTaskService(..., limits)` 注入（供测试）。任务刚启动时 phase 显示 `queued: waiting for capacity`，直到首个流开始。

### 6.4 依赖调度与失败传播

带 `dependsOn` 的 `spawn` 以 `pending` + `block: { kind: 'dependency', taskIds }` 创建。每条结算边——driver 结束、`cancel`、`cancelTree`、spawn 快速失败——都会重评估依赖图（`maybeUnblockDependents`）：依赖全部 `done` 的任务自动启动；依赖失败/取消/缺失的任务快速失败，根因同时写入 `errorMessage` 与结构化的 `result.failedDependencyId`。重试依赖（`retry`）会级联重置*因它而失败*的下游任务（按 `failedDependencyId` 匹配，对旧数据回退到解析错误消息中的引号 id）回 pending-blocked，依赖完成后自动重启。

停止父会话（`service.cancel`）**刻意不**取消任务树：已 spawn 的任务继续后台运行，结果持久化，用户从任务面板逐个停止。删除会话仍会拆掉整棵树（`cancelTree`）。

### 6.5 重启恢复

内存中的 driver 随进程死亡。启动时 `reconcileOrphans()` 将所有持久化的 pending/running/blocked 任务标记为 `failed` + `failureKind: 'app-restart'`，使 awaiter 得以 resolve 而非永久挂起，UI 也能以柔和的「已中断」样式 + 重试入口呈现，而非红色失败。

### 6.6 审批冒泡

子代理的流暂停在工具审批时，任务进入 `blocked` + `block: { kind: 'approval', approvals }`，审批冒泡到**根**会话（`data-taskApproval` 部件 + `chat:task-event`），用户经审批卡响应。driver 在 surface **之前**注册 waiter（block 一广播响应就可能到达；晚于响应注册的 waiter 会永久挂起），将响应写回 executor 转录，按需经策略引擎持久化决定（`session`/`forever` 范围），然后恢复流循环。

下一篇 → [13 策略与审批](./13-policy-and-approval.md)
