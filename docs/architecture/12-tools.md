# 12 · 工具系统

> 适用范围：工具来源合并、内置工具目录、fs/git/search/shell 沙箱、技能、子代理。最后核对：`src/main/agent/tools/*`、`fs/*`、`search/*`、`shell/*`、`skills/*`、`subagent/*`、`security/*`。

## 1. 工具定义模式

所有内置工具都是 ai-sdk 的 `tool({...})`（`import { tool } from 'ai'`），每个携带：

- `description`、`inputSchema`（Zod，集中在 `tools/tool-schemas.ts`）。
- `providerMetadata.tanzo`：`{ kind, component, fingerprintFields? }`。
  - `kind ∈ read | search | edit | exec` —— 驱动策略判定（[13 策略与审批](./13-policy-and-approval.md)）。
  - `component` —— renderer 渲染卡片的提示（[30 渲染层](./30-renderer.md)）。
  - `fingerprintFields` —— 审批记忆的指纹范围。
- `toModelOutput`（多数为 `toolResultToModelOutput`，`tools/model-output.ts:13`）：把结构化输出转成 text/json/error-text。
- `execute`（部分为异步生成器以支持流式，如 `shell`、`subagent`）。

## 2. ToolSet 合并：`createBuildTools`（`tools/registry.ts:86`）

返回的 `BuildTools` 每次运行按 `{def, chatId, depth, mode}` 调用，合并顺序（`registry.ts:96`）：

```
builtinTools(def, deps)          // fileRead/fileEdit/multiEdit/fileWrite/glob/grep/shell
+ await mcpTools(def, deps)      // MCP 服务器工具
+ providerTools(def)             // 当前返回空对象；web_search 仅为预留 UI/类型词汇
+ skill, todo
+ askQuestion                    // 仅 main agent
+ shellBackgroundTools           // shellStart/Poll/Write/Stop/List
+ subagent 委派工具                // spawn/await/tasks/steer/cancel；仅 depth < maxDepth 且存在可委派类型
+ report                         // 仅子代理对话
+ goalTools (updateGoal)         // 仅 main agent
+ exitPlanMode                   // main agent，计划模式或批准后
```

随后按 `def.allowedTools` 模式过滤（`null` = 全部）。`toolKeyMatchesPattern`（`registry.ts:27`）支持精确、`*` 通配、`mcp__server` 前缀匹配。

- **计划模式不变量**：可委派的子代理类型被过滤为只读子代理（`isSafeReadOnlySubagent`，`registry.ts:53`；`registry.ts:63-74`）。委派工具的 `kind` 是逐个静态的：`spawn`/`steer`/`cancel` 为 `exec`，`await`/`tasks` 为 `read`（`tools/subagent.ts`）。
- `maxSubagentDepth` 默认 `3`。

### 2.1 MCP 合并（`tools/mcp.ts:74`）

`mcpTools` 拉取已连接 MCP 服务器（按 `def.mcpServers` 过滤），把每个工具命名为 `mcp__<server>__<tool>`（净化 + 短哈希防碰撞），并把 MCP 注解映射到 `kind`：`readOnlyHint===true && destructiveHint!==true → 'read'`，否则 `'edit'`。

### 2.2 供应商工具（`tools/provider.ts`）

当前 `providerTools(_def)` 明确返回 `{}`，运行时不会向 ToolSet 注入供应商原生工具。`TanzoTools.web_search` 与只读子代理白名单中保留了 `web_search`，但这是共享 UI/兼容词汇的预留，不代表当前已接入 provider-native web search。

## 3. 内置工具目录

| 工具 | kind | 主要入参 | 用途 |
|---|---|---|---|
| `fileRead` | read | `{path, startLine?, lineCount?≤2000}` | 行号窗口读；原生图片(≤5MB)与 `.ipynb` 展平；60k 字符/2000 字符行截断；ENOENT 给路径建议 |
| `fileEdit` | edit | `{path, oldText, newText, replaceAll?}` | 单次精确替换；歧义匹配除非 `replaceAll` 否则拒绝 |
| `multiEdit` | edit | `{path, edits[≤100]}` | 有序原子多替换；每次 edit 看到前序结果；全成或全败 |
| `fileWrite` | edit | `{path, content}` | 创建/覆盖，保留既有 EOL/编码/BOM |
| `glob` | search | `{pattern, directory?, includeIgnored?, offset?, limit?≤500}` | ripgrep `--files` glob，按新→旧 |
| `grep` | search | `{pattern, directory?, includeGlob?, mode?, caseInsensitive?, contextBefore/After?≤20, type?, multiline?, limit?≤500, offset?}` | ripgrep content/files/count |
| `shell` | exec | `{command, workdir?, timeoutMs? 1s–30m}` | 流式 shell；head+tail 30k 截断；剥 ANSI；默认 120s |

编辑文本匹配（`builtin/match.ts`）规整智能引号/破折号/空格与换行变体（`locate`/`candidateNeedles`），让模型给的 `oldText` 更稳地命中——一项重要鲁棒性行为。

其它工具：`skill`(read)、`todo`(exec)、`askQuestion`(read，阻塞)、`updateGoal`(exec)、`exitPlanMode`、子代理委派 `spawn`/`await`/`tasks`/`steer`/`cancel`、`report`(子代理用)、`shellStart/Poll/Write/Stop/List`。

## 4. 沙箱层

### 4.1 WorkspaceFs（`fs/workspace-fs.ts`）

工作区根沙箱文件层，两条解析路径：

- **读** `resolveRead`：拒绝敏感路径，允许根内**或**任一已注册 read-root，否则抛 `FS_PATH_ESCAPE`。
- **写** `resolveWrite`：仅根内（read-root 只读）。
- **realpath 复校**：解析符号链接后再次校验包含关系，防符号链接逃逸；凭证路径检查对解析后的真实路径重施。
- `registerReadRoot`：扩展读沙箱（`skill` 工具用它授予技能目录读权限）。
- **dangerous 模式**：绕过沙箱包含校验，但**仍**强制凭证路径拒绝。
- 写为原子（临时文件 + rename）；最大编辑 20MB。

### 4.2 路径安全（`security/path-safety.ts`）

集中正则：`SENSITIVE_PATH_RE`（`.ssh`/`.aws`/`.env`）、`GIT_PATH_RE`（`.git`）、`SENSITIVE_RIPGREP_EXCLUDES`。`assertNonSensitivePath`/`assertNonGitPath` 抛 `TanzoValidationError`。fs、search、内置策略规则共用——单一真源。

### 4.3 检索后端（`search/backend.ts`）

调用打包的 `@vscode/ripgrep`（感知 asar-unpacked）。`resolveScope` 施加与 fs 相同的包含 + realpath + git/凭证拒绝；始终排除 `.git/.ssh/.aws/.env*`；硬上限 16MB stdout、30s、500 列裁剪、mtime 降序截 5000 文件；`--type` 对 ripgrep `--type-list` 校验。

### 4.4 Shell（`shell/runner.ts`、`shell/resolve.ts`）

- 候选 shell：Unix → `$SHELL`→`bash`→`sh`（`-lc`）；Windows → `pwsh.exe`→`powershell.exe`→`cmd.exe`。
- spawn 分离进程组（Unix）；`safeChildEnv` 净化环境；超时/中止时杀整棵进程树（Windows `taskkill /t /f`，Unix `process.kill(-pid)`）。
- `shell` 工具的工作目录经 `fs.resolveWorkspace`（沙箱校验）或默认 `fs.root`。
- **shell 工具本身不做命令允许/拒绝**；破坏性命令拦截全在策略引擎内置规则（[13](./13-policy-and-approval.md)）。

## 5. 技能（`skills/*`）

### 5.1 发现（`skills/store.ts`）

按顺序从多根加载（后者按 name 覆盖前者）：内置（当前空）、`~/.claude/skills`、`~/.tanzo/skills`、`<userDir>/skills`、`<workspace>/.claude/skills`、`<workspace>/.tanzo/skills`。

每个技能目录含 `SKILL.md`（YAML frontmatter，需 `name`+`description`；可选 `model`/`license`/`compatibility`/`allowed-tools`/`metadata`）。启用/安装状态持久化在 `skill_states` 表；安装把源目录拷进作用域技能目录（带 name 防穿越守卫）。

### 5.2 渐进披露

- **索引（常驻）**：`skills-index` section 只列已启用技能的 `name: description`（[11](./11-context-engineering.md) §4）。
- **按需全文**：`skill` 工具（`tools/skill.ts:10`）返回完整 `body`、`skillDir`、`args`、`allowedTools`，并调 `deps.fs.registerReadRoot(skillDir)` 让 agent 读技能附带文件。
- 技能返回的 `allowedTools` 会被 `stream-runner.ts` 从 `skill` 工具结果中收集，并在后续 `prepareStep` 通过 `activeTools` 缩窄本步可用工具集。

## 6. 子代理（`subagent/task-service.ts`、`task.machine.ts`、`approval-utils.ts`）

`createTaskService` 以**任务（task）**为单位管理嵌套运行，并发：全局上限 `MAX_CONCURRENT_BACKGROUND = 100` 信号量，加每 root（顶层对话）`MAX_CONCURRENT_PER_ROOT = 20` 的 keyed 信号量，防止单个 root 饥饿其他（`task-service.ts:26-29,87-88`）。续接上限 `MAX_CONTINUATION_PASSES = 10`（与前台 turn-loop 共用）。

- `spawn`：创建任务（状态由 `task.machine.ts` 纯函数转移驱动）与子对话（`parentConversationId = parentChatId`、`parentRelation = 'subagent'`），全部后台驱动，`dependsOn` 未就绪时阻塞。
- `await`：注册 awaiter 等任务 settle（非合成父消息回流）；`tasks`/`get`/`list` 查询。`steer` 追加指导或重定义 objective，`cancel`/`cancelTree` 停止。
- 驱动循环：解析 def → 压缩（`force` 传入，`hitCompactionTrigger` 时重试至 10）→ 取槽 → 启流 → `reportPhase` 上报进度。

**状态与广播**：进度/结果变化经 `broadcastTasks` 在 `taskEventChannel(rootChatId)` 上以 `data-task` / `data-taskApproval` 广播（`task-service.ts:96-118`）。`reconcileOrphans` 在重启后把遗留运行置为失败。

**审批**：`approval-utils.ts` 的 `extractPendingApprovals`/`applyApprovalResponse` 把子代理工具审批路由到 root；`listApprovals`/`respondApproval` 把决策应用到子 transcript 并可按 `session`/`forever` 记入策略。

## 7. 工具系统不变量

- [ ] ToolSet = builtin + MCP + provider(当前空) 合并，再按 `allowedTools` 过滤。
- [ ] fs/search/policy 三处独立施加路径沙箱 + realpath + 凭证拒绝（共享 `path-safety.ts`）。
- [ ] 破坏性 shell 命令由策略内置规则拦截，不在 shell 工具内。
- [ ] 子代理深度上限默认 3；计划模式下只委派只读子代理（过滤可委派类型，非改 kind）。
- [ ] 子代理委派/查询工具（spawn/await/tasks/steer/cancel）按 root 受所有权校验。

下一篇 → [13 策略与审批](./13-policy-and-approval.md)
