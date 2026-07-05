# 设计文档 · 子代理子系统重构（Subagent v2）

> 状态：草案（待评审）
> 范围：`src/main/agent/subagent/**`（task-service / task.machine / approval-utils）、
> `src/main/agent/tools/subagent.ts` / `subagent-control.ts` / `tool-schemas.ts`、
> `src/main/agent/tools/registry.ts` 的委派分支、`src/shared/subagent-task.ts`、
> `src/main/agent/ipc/chat.ts` 与 preload/chat-client 的任务通道、
> `src/renderer/src/features/chat/ui/task-overview-pill.tsx` /
> `tool/renderers/subagent.tsx` / `tool/subagent-approval-card.tsx`、
> `src/renderer/src/features/chat/model/conversation/session-manager.ts`、
> `src/renderer/src/locales/{zh-CN,en}.ts`。
> 前提：保留现有"纯状态机 + 解释器 shell"分层与 `data-task` 广播通道；
> 允许追加持久层字段与运行时契约变更（`SubagentTaskResult` 为 JSON 列，追加字段
> 无需迁移）；工具面沿用 AI SDK v7 `tool()` + zod schema；不考虑对旧错误消息
> 字符串协议的兼容（提供只读回退即可）。

---

## 0. 摘要

子代理子系统的骨架正确：纯状态机（`task.machine.ts`）+ 解释器 shell
（`task-service.ts`）、审批冒泡到根会话、`resultSource: explicit/inferred`
区分交付置信度、应用重启孤儿回收（`failureKind: 'app-restart'`）、spawn 返回
内联 `hint` 引导 await。但存在十四类缺陷，可归纳为四句话：

1. **调度图有洞** —— 依赖重评估只挂在 driver 结束的 finally 上，取消一个从未
   启动的 pending 任务会让下游永久挂起（S1）；steer 缺少终态与依赖门控守卫，
   能悄悄复活已完成任务、绕过 dependsOn 直接开跑（S2）。
2. **agent 得到的反馈不对称、不可判定** —— await 静默吞掉未知 id 而其余四个
   工具报错（S3）；`failed: true` 同时表示逻辑失败/等待被取消/应用重启三种
   语义（S7）；子代理忘调 report 时空 summary 不带失败信号（S8）；级联重试
   依赖错误消息里的引号字符串匹配，文案即协议（S4）。
3. **用户只有眼睛没有手** —— 后端 cancel/retry IPC 全部就绪但 UI 零接线，
   `interrupted` 文案让用户去点一个不存在的 retry 按钮（S11）；子代理执行
   过程是黑盒，无法下钻子会话转录（S12）。
4. **表达层与验证层欠账** —— zh-CN 缺 5 个关键状态键导致中英混排（S5）；
   并发上限/深度熔断/审批端到端/supersede/级联重试零测试覆盖（S14）；
   架构文档缺并发、依赖调度、重启恢复、审批冒泡四大节（S15）。

v2 以八条不变量重建调度正确性、工具反馈契约与用户控制面，不推翻现有架构。

---

## 1. 现状与问题诊断

### 1.1 现行全链路

```
父代理 turn
  └─ spawn 工具 (tools/subagent.ts:37)
       └─ TaskService.spawn (subagent/task-service.ts:208)
            ├─ createExecutorConversation → parentRelation:'subagent' 子会话
            ├─ readableId：<agentType>-<n>，按 root 内同类型计数 (:163)
            ├─ dependsOn 未满足 → status:pending + block:{kind:'dependency'}
            └─ 无依赖 → startDriver (:275)
                 └─ runTask 循环 (:408)
                      ├─ acquireRunSlots：per-root(20) → global(100) 双信号量 (:338)
                      ├─ runStreamPass → callbacks.startChatRun（broadcast:true，
                      │    子会话帧走独立 chatId 通道）
                      ├─ 审批挂起 → surfaceApprovals → waitApproval →
                      │    respondApproval（根会话 UI 冒泡）→ 循环续跑
                      └─ 收尾 → completeTask：显式 report(result) 或
                           回退最后一条 assistant 文本（inferred）
  └─ await/tasks/steer/cancel 工具（父代理拉取式收集）
  └─ 子代理侧唯一控制工具：report({phase,result}) (tools/subagent-control.ts)

状态同步：每次转移 persist + broadcastTasks →
  data-task / data-taskApproval transient 部件 + taskEventChannel 独立通道
渲染面：TaskOverviewPill（头部胶囊，只读）、subagent 工具卡片（转录回执）、
  SubagentApprovalCard（composer 上方审批卡）
重启恢复：reconcileOrphans 将无 driver 的未结算任务标记
  failed + failureKind:'app-restart' (:759)
```

### 1.2 缺陷目录

严重度：★★★ 正确性 bug / ★★ 心智与契约缺陷 / ★ 欠账。

**调度正确性（★★★）**

- **S1 · 取消 pending 任务后依赖者永久挂起**。`maybeUnblockDependents` 唯一的
  触发点是 `startDriver` 的 `.finally`（task-service.ts:291）。dependency-blocked
  的 pending 任务从未启动 driver，`cancel()`（:663-671）取消它时没有任何路径
  重评估下游依赖。结果：`B dependsOn A`，cancel A 后 B 停在 pending，父代理
  `await B` 无限挂起。`cancelTree`（:773）同病。
- **S2 · steer 绕过终态与依赖门控**。状态机 `resume`/`redefine` 事件无终态
  守卫（task.machine.ts:112-133）；服务层 `instruct`/`redefine`（task-service.ts:673-699）
  只检查任务存在，与 `resumeByChat` 的终态守卫（:703）不一致。后果二连：
  ① steer 一个 `done` 任务将其复活为 running 并覆盖父代理已 await 消费过的
  结果；② steer(instruction) 一个 dependency-blocked 任务，`resume` 直接转
  running + startDriver，依赖未完成即开跑。
- **S6 · 审批 waiter 注册竞态**。`runTask` 先 `surfaceApprovals`（持久化 block
  并广播，UI 即刻可响应）再注册 `waitApproval`（:478-479）。若响应在窗口内
  完成（`respondApproval` 内部还有异步 load/save，:578-605），
  `approvalWaiters.get()` 落空，之后注册的 waiter 永远等不到 resolve，任务
  永久 blocked。人手点击几乎不触发，但任何自动审批策略（policy remember 命中
  后的快速路径、未来的 auto-approve）都会踩中。

**agent 反馈契约（★★）**

- **S3 · await 静默吞未知 id**。`known = tasks.filter(...)`（tools/subagent.ts:111），
  仅全部未知才报错。拼错一个 id 时它既不在 `results` 也不在 `pending`，无任何
  信号。而 `tasks`/`steer`/`cancel` 对未知 id 一律 toolError —— 同一概念
  两种反馈约定，模型无法建立稳定预期。
- **S4 · 级联重试是字符串协议**。`cascadeRetryDependents` 用
  `errorMessage.includes(`'${depId}'`)` 回溯失败根因（:740），上游甚至留注释
  要求拼错误消息时记得加引号（:259-260）。改一处文案即静默断裂，且对
  模型与用户完全不可见。
- **S7 · `failed: true` 三义性**。同一个字段表示：任务逻辑失败、await 自身
  被取消（`'await cancelled.'`，:634/:647）、应用重启中断（failureKind）。
  await 工具描述未提示模型检查 `failureKind`/`errorMessage`，父代理容易把
  "自己的等待被中止"误判为"任务失败"而错误 retry 或放弃。
- **S8 · 空 inferred 结果无失败信号**。子代理忘调 `report(result)` 时回退取
  最后一条 assistant 文本（:490-491）；文本为空时父代理拿到
  `{summary:'', resultSource:'inferred'}` —— 无 failed 标记的空交付。
- **S9 · steer 的"二选一"只在运行时报错**。`steerInputSchema` 两字段皆
  optional（tool-schemas.ts:447-470），约束只活在 execute 里
  （tools/subagent.ts:207-218）。schema 可表达而未表达。
- **S10 · spawn 部分失败不可见且留孤儿**。spawn 逐个执行（:72-79），中途
  `spawnTask` 抛异常时已启动的任务不出现在返回值里；依赖校验失败的任务已
  创建 executor 会话并写入 objective（:216-217 先于 :245 的校验），留下
  孤儿子会话。

**用户控制面（★★）**

- **S11 · 用户零控制权 + 误导文案**。IPC `retryTask`/`cancelTask` 已暴露
  （ipc/chat.ts:250-258），chat-client 已封装（chat-client.ts:160-164），
  renderer 零调用。TaskRow（task-overview-pill.tsx:145-197）无任何操作按钮。
  文案 `interrupted: 'Interrupted — app restarted. Use retry to restart.'`
  （en.ts:679）指向一个不存在的按钮。用户面对跑偏的子代理，唯一手段是停掉
  整轮父 run。steer 亦无用户入口（IPC 层连通道都没有）。
- **S12 · 子代理执行黑盒**。用户只能看到 objective、agentType、子代理自报的
  phase 字符串、最终 summary。内部工具调用与流式输出对用户完全不可见——
  尽管 `runStreamPass` 以 `broadcast: true` 启动子会话流（:389），帧已经在
  子 chatId 通道上广播，只是渲染层没有任何入口订阅它。verify 类子代理能跑
  shell，黑盒执行的信任成本高。
- **S13 · steer/cancel 只是事后回执**。它们以工具卡片形式出现在父转录里，
  是父代理行为的记录；用户没有"任务正在被引导/取消中"的实时指示。

**表达与验证欠账（★）**

- **S5 · zh-CN 缺 5 个关键键**。`chat.tool.subagent.{blockedBy,waitingFor,inferred,resultInferred}`、
  `chat.taskPanel.interrupted` 仅存在于 en.ts（660-679）。恰好全部是
  "依赖阻塞/结果为推断/重启中断"这类最需要被理解的状态提示。且无任何
  机制防止两份 locale 再次漂移。
- **S14 · 测试空白**。零覆盖：并发上限（per-root 20 / global 100 双信号量、
  acquire 中 abort 的槽位回滚，:338-362）；深度熔断（registry.test.ts 用了
  depth:3 却未断言 spawn 工具被移除）；审批端到端（surface→respond→
  policy.remember→恢复运行，:472-606 服务层编排零覆盖）；supersede 路径
  （:419/:446）；cascadeRetryDependents（:735）。测试自述双 driver 并发需要
  集成 harness（subagent-task-service.test.ts:238-242）。并发上限常量硬编码
  （:26-29），不可注入即不可测。
- **S15 · 文档缺口**。`docs/architecture/12-tools.md` §6 与实现一致但缺四节：
  并发上限、dependsOn 调度与失败传播、重启孤儿回收、审批向根会话冒泡。
  均为"实现有、文档无"。

---

## 2. 设计不变量

v2 的所有改动服从以下八条，评审时以此裁剪：

- **I1 · 终态即终态**。任何事件都不得将 `done/failed/cancelled` 任务转回
  非终态 —— 唯二例外是显式的 `retry` 与 `reset-dependency`，二者本身只从
  终态出发。守卫落在状态机层，服务层与工具层只做更早的拒绝与更好的报错。
- **I2 · 每条结算边都重评估依赖图**。任务进入终态的所有路径（driver 结束、
  cancel、cancelTree、spawn 时 fail-fast）都必须触发一次
  `maybeUnblockDependents`。不存在"结算了但下游不知道"的窗口。
- **I3 · 因果走结构化字段，不走字符串**。依赖失败的根因用
  `failedDependencyId` 表达；错误消息只服务于人和模型的阅读，不承载控制流。
- **I4 · 五个工具对未知 id 的反馈对称**。要么都报错，要么都在返回值里显式
  列出 —— v2 选后者对 await（批量语义），前者对其余四个（单目标语义），
  且 await 的 `unknown` 字段在 schema 与描述中显式声明。
- **I5 · 每个结果自带出处与置信度**。`resultSource` 与 `failureKind` 覆盖
  全部结算路径；空的 inferred 交付是失败，不是成功。
- **I6 · 用户与父代理控制权对等**。父代理能 cancel/steer/retry 的，用户在
  UI 上也能；不存在"文案承诺了但按钮不存在"的状态。
- **I7 · 子代理转录可观测**。每个任务可下钻到子会话的只读实时视图；
  只读是硬约束 —— 用户绝不能向 executor 会话发消息（那会触发
  `resumeByChat` 语义并破坏任务生命周期）。
- **I8 · 两份 locale 键集恒等**。以结构性测试守卫，不靠人肉对照。

---

## 3. 目标架构

### 3.1 状态机加固（S1 前置、S2、S4）

`task.machine.ts` 改动全部是守卫与字段，不改状态图拓扑：

- `resume`：`isTaskTerminal → stay`；`block?.kind === 'dependency' → stay`。
- `redefine`：`isTaskTerminal → stay`。
- `fail` 事件追加可选 `failedDependencyId?: string`，写入
  `result.failedDependencyId`（I3）。
- 文件头的状态图注释同步补 steer 守卫与依赖失败字段。

状态机保持纯函数与终态幂等，现有测试（task.machine.test.ts）全部保留，
新增守卫用例。

### 3.2 调度器：统一结算入口（S1）

`task-service.ts` 提取单一结算收口：

```ts
function settleAndReevaluate(rootChatId: string): void {
  maybeUnblockDependents(rootChatId)
}
```

四个调用点（I2）：

1. `startDriver` 的 `.finally`（现状保留，:291）；
2. `cancel()` 末尾（新增 —— 修复 S1 主路径）；
3. `cancelTree()` 在 `broadcastTasks` 之前（新增）;
4. `spawn()` 内 fail-fast 分支之后（新增；覆盖"A 刚失败、B 同批 spawn 且
   依赖 A"的边角）。

`dependencyUnsatisfiable` 已将 cancelled 视为不可满足（:299），下游会正确
fail-fast 并携带结构化根因（3.1 的 `failedDependencyId`），判定逻辑不动。

### 3.3 steer 语义收紧（S2）

**决策：拒绝复活，不做"追问式重启"。** 理由：复活会覆盖父代理已消费的
结果快照（awaiters 观察过的 result 被静默替换）；与 `resumeByChat` 守卫和
工具描述 "adjust a *running* task" 矛盾；追问的正确表达是 spawn 新任务并在
objective 里引用旧结论 —— 语义清晰且保留两份结果。

三层防御：

- 状态机层：3.1 的守卫（最后防线，保证任何调用方都无法违反 I1）。
- 服务层：`instruct`/`redefine` 返回值改为
  `Promise<{ ok: true } | { ok: false; reason: 'terminal' | 'dependency-blocked' | 'not-found' }>`，
  开头守卫，不再无条件 abort 旧 driver。
- 工具层：steerTool 把拒绝翻译成可操作的 toolError：
  - terminal → `Task 'x' already settled (done). Its result is final; spawn a new task and reference the old result in the objective.`
  - dependency-blocked → `Task 'x' has not started (blocked on [dep-ids]). Steer it after dependencies complete, or cancel and respawn with a new objective.`

### 3.4 审批环节：waiter 先行（S6）

`runTask` 的审批段改为先注册后暴露：

```ts
const waits = pending.map((p) => waitApproval(p.approvalId, signal)) // 1. 注册 waiter
surfaceApprovals(rootChatId, taskId, pending)                        // 2. 持久化 + 广播
await Promise.all(waits)                                             // 3. 等待
```

`respondApproval` 中 waiter 未命中但审批已应用时打 warn 日志（回归哨兵）。
`waitApproval` 本身的 abort 清理逻辑不变。

### 3.5 结构化依赖失败（S4）

- `src/shared/subagent-task.ts`：`SubagentTaskResult` 追加
  `failedDependencyId?: string`。
- 两处依赖失败注入点改传结构化 id：spawn fail-fast（:261-267）、
  `maybeUnblockDependents`（:314）。错误消息保留引号格式（可读性），但
  不再是协议。
- `cascadeRetryDependents` 匹配条件改为
  `candidate.result?.failedDependencyId === retriedTaskId`，对无该字段的
  历史行保留 `includes` 只读回退（DB 里可能存在 v1 时代的失败行）。
- 删除 :259-260"记得加引号"注释。

### 3.6 工具面 v2（S3、S7、S8、S9、S10）

**await**（tools/subagent.ts、tool-schemas.ts）：

- 返回值追加 `unknown?: string[]`，schema 与描述同步声明：
  `Unknown ids are listed in 'unknown' — check it whenever a result seems missing.`
- 描述追加结果判读指引：
  `A failed result's failureKind tells you why: 'app-restart' (interrupted, retryable via steer/respawn), 'await-cancelled' (your wait was aborted — the task may still be running), otherwise a genuine task failure. A resultSource of 'inferred' means the sub-agent never called report(result); treat the summary with lower confidence.`

**failureKind 扩展**：

- 联合扩为 `'app-restart' | 'logic-error' | 'await-cancelled'`。
- `awaitTask` 两处 `'await cancelled.'`（:634/:647）附
  `failureKind: 'await-cancelled'`。

**空 inferred 即失败**（completeTask，:484-493）：

- `resultSource === 'inferred' && summary.trim() === ''` 时改走 fail：
  `Sub-agent finished without a deliverable: it never called report(result) and produced no final text.`
  （`failureKind: 'logic-error'`）。

**steer schema 收紧**：

- `steerInputSchema` 改为 `z.union([{task, instruction}.strict(), {task, objective}.strict()])`，
  JSON Schema 输出 anyOf，模型在参数生成阶段即受约束；execute 内运行时校验
  保留兜底（union 对弱 provider 的容错）。

**spawn 原子性与部分失败可见**（S10）：

- 依赖预校验（自依赖、依赖不存在）**提前到创建 executor 会话之前** ——
  校验只需要 dependsOn 与已存任务表，不需要子会话存在。fail-fast 的任务
  不再留孤儿会话。
- 批量执行改逐个 try/catch；某 spec 失败时返回 toolError，消息列出已启动
  的 id：`Spawned [explore-1] before failing on spec 2: <error>. Those tasks are running — await or cancel them.`

### 3.7 用户控制面：TaskRow 操作 + steer 通道（S11、S13）

**IPC 补全**：新增 `CHAT_CHANNELS.steerTask`（ipc/chat.ts → preload →
chat-client.ts → session-manager.ts），转发 `TaskService.instruct`。
cancel/retry 通道已存在，只补 renderer 接线。

**session-manager.ts**：Session 接口追加
`cancelTask(taskId)` / `retryTask(taskId)` / `steerTask(taskId, instruction)`，
模式照抄 `respondTaskApproval`（:75/:647）。

**task-overview-pill.tsx · TaskRow**：

- hover/focus 显示操作区：
  - active（pending/running/blocked）→ 取消按钮（Ban）+ 引导按钮（打开
    行内单行输入，提交即 `steerTask` instruction 模式；不提供 UI 级
    redefine —— 破坏性操作留给显式的取消+对父代理下新指令）；
  - failed/cancelled → 重试按钮（兑现 `interrupted` 文案的承诺）。
- 操作后本地乐观置灰，等 `data-task` 推送刷新（广播链路已存在，每次转移
  都发，:106-129）。
- 进行中的用户操作（取消中/引导已发送）在行内给出瞬时状态提示（S13）。

**新增 i18n 键**（两语言同批落地）：
`chat.taskPanel.{cancelTask,retryTask,steerTask,steerPlaceholder,steerSent,cancelling}`。

### 3.8 子代理转录下钻（S12，完整版）

目标：点击 TaskRow 打开该任务 executor 会话的**只读实时视图**。

基础设施现状：子会话消息已持久化（`parentRelation: 'subagent'`）；
`runStreamPass` 以 `broadcast: true` 运行，帧已在子 chatId 通道广播；
session-manager 按 chatId 建 session 的能力是通用的。缺的只是入口与只读模式。

设计：

- **入口**：TaskRow 主体点击（操作按钮之外的区域）→ 以覆盖层（sheet/panel）
  形式打开子会话视图，不改变 sidebar 导航状态。子会话不进 sidebar
  （`listVisible` 现状已排除，保持）。
- **只读会话模式**：`use-chat-session` / `active-chat.tsx` 增加
  `readonly` 渲染态 —— 由 `conversation.parentRelation === 'subagent'`
  推导，**不信任调用方传参**。readonly 下：composer 整体替换为状态条
  （显示任务 id、状态、"由 <父会话> 委派"），stop/approval/question 等
  交互一律不渲染（子代理审批仍走根会话的 SubagentApprovalCard，不在
  下钻视图里重复）。
- **实时性**：session 正常订阅子 chatId 的帧通道，运行中任务的工具调用与
  流式文本实时可见；已结算任务打开即静态转录。
- **生命周期**：覆盖层关闭即释放 session（沿用现有 session 池的
  retain/release 语义）；不做常驻。
- **防误写硬约束（I7）**：除 UI 不渲染 composer 外，preload 层
  `sendMessage` 对 `parentRelation === 'subagent'` 的会话直接拒绝
  （防御纵深，防未来任何入口误接）。

### 3.9 可注入并发上限（S14 前置）

`createTaskService` 的 deps 追加可选
`limits?: { global?: number; perRoot?: number }`，默认沿用 100/20。
生产代码不变，测试注入小上限成为可能。

### 3.10 locale 奇偶校验守卫（S5、I8）

- 补齐 zh-CN 五键：

  | 键 | 中文 |
  |---|---|
  | `chat.tool.subagent.blockedBy` | 受阻于 |
  | `chat.tool.subagent.waitingFor` | 等待 |
  | `chat.tool.subagent.inferred` | 推断 |
  | `chat.tool.subagent.resultInferred` | 结果由最后一条助手消息推断——子代理未调用 report() |
  | `chat.taskPanel.interrupted` | 已中断——应用曾重启。点击重试恢复。 |

- 新增结构性测试 `tests/unit/renderer/locale-parity.test.ts`：递归展平
  zh-CN 与 en 的键集，断言两个方向的差集皆为空。**全量校验，不限
  subagent 段** —— 这会暴露其他段的历史漂移，属预期收益；首次运行发现的
  存量缺键在同一提交内补齐。

---

## 4. 数据模型与契约变更

```ts
// src/shared/subagent-task.ts
interface SubagentTaskResult {
  summary: string
  failed?: boolean
  errorMessage?: string
  resultSource?: 'explicit' | 'inferred'
  failureKind?: 'app-restart' | 'logic-error' | 'await-cancelled'   // 扩展
  failedDependencyId?: string                                        // 新增
}
```

- 持久层：result 为 JSON 列，追加字段零迁移；旧行缺 `failedDependencyId`
  由 cascadeRetry 的字符串回退兜底。
- `TaskEvent`：`fail` 追加 `failedDependencyId?`；`resume`/`redefine`
  行为收紧（守卫）属语义变更，无字段变更。
- `TaskService`：`instruct`/`redefine` 返回值从 `Promise<void>` 改为
  结构化结果（3.3）；调用方为 steerTool 与新 IPC，同批适配。
- 工具 schema：`awaitOutputSchema` + `unknown`；`steerInputSchema` 改
  union；spawn/await 描述文本更新。
- IPC：新增 `CHAT_CHANNELS.steerTask`（chatId 校验沿用 `chatIdSchema`）。
- 广播契约（`data-task` / `taskEventChannel`）不变。

---

## 5. 与现有运行时不变量的对齐点

- **状态机纯函数契约**（runtime/machine/types.ts）：所有新守卫走
  `stay(task)`，effects 语义不变；`now` 继续经事件注入。
- **epoch/supersede 模型**：steer 服务层守卫在 abort 旧 driver **之前**
  判定，不与 `TaskInterrupted('superseded')` 路径交叉；`driverDone` 串行
  语义不动。
- **审批与 policy 引擎**：3.4 只调换注册顺序，`enqueueApproval` 串行链、
  `policy.remember` 的 fingerprint 语义不变。
- **KV cache / 上下文**：本方案不触碰 prompt 组装与压缩链路；工具描述
  文本变更会使父代理系统 prompt 的缓存前缀失效一次（一次性成本，可接受）。
- **下钻视图**复用既有帧广播与 session 池，不新增流式通道。

---

## 6. 测试计划

| # | 层 | 场景 | 对应缺陷 |
|---|---|---|---|
| T1 | machine | resume/redefine 终态与 dependency-block 守卫为 stay | S2 |
| T2 | service | cancel A → B(dependsOn A) fail-fast，await B 立即 resolve | S1 |
| T3 | service | cancelTree 后下游重评估；环防护保持 | S1 |
| T4 | service | instruct/redefine 对 done/blocked 返回 `{ok:false,reason}` 且不 abort | S2 |
| T5 | service | "surface 前响应已到"时序不挂起；warn 哨兵触发 | S6 |
| T6 | service | cascadeRetry 走 failedDependencyId；旧行字符串回退 | S4 |
| T7 | service | 空 inferred → failed + logic-error | S8 |
| T8 | service | 注入 limits{2,1}：per-root 排队、global 封顶、acquire 中 abort 回滚槽位 | S14 |
| T9 | service | supersede：hasAdvancedSince → 静默解绑不标 failed | S14 |
| T10 | service | 审批端到端：surface→approve(scope:session)→remember→恢复 running | S14 |
| T11 | tools | await 返回 unknown；全未知仍 toolError | S3 |
| T12 | tools | await-cancelled 的 failureKind 透传 | S7 |
| T13 | tools | steer union schema 拒绝双字段/零字段；toolError 文案 | S2/S9 |
| T14 | tools | spawn 部分失败列出已启动 id；fail-fast 不留孤儿会话 | S10 |
| T15 | registry | depth ≥ maxDepth 时工具集不含 spawn；maxSubagentDepth 覆写 | S14 |
| T16 | renderer | locale 键集奇偶校验（全量） | S5 |
| T17 | renderer | TaskRow 操作按钮按状态渲染；readonly 会话不渲染 composer | S11/S12 |

双 driver 真并发（重叠 runTask 的集成 harness）仍列为已知缺口，不入本期
（成本与收益不成比例；`driverDone` 串行语义已由 T4 的守卫路径 + 代码注释
锚定）。

---

## 7. 实施计划

按提交粒度排序，前序不依赖后序；每步以
`vitest run tests/unit/main/agent/...` → `pnpm test` → `pnpm typecheck`
（涉及 renderer 加 `pnpm lint`）验证。

| # | 提交 | 内容 | 测试 |
|---|---|---|---|
| 1 | `fix(subagent): reevaluate dependents on every settle path` | 3.2 | T2 T3 |
| 2 | `fix(subagent): guard steer against terminal and blocked tasks` | 3.1 + 3.3 | T1 T4 T13 |
| 3 | `fix(subagent): register approval waiters before surfacing` | 3.4 | T5 |
| 4 | `refactor(subagent): structured dependency-failure tracking` | 3.5 | T6 |
| 5 | `feat(subagent): explicit unknown/failureKind feedback in tools` | 3.6（await/failureKind/空 inferred/steer schema/spawn 原子性） | T7 T11 T12 T14 |
| 6 | `test(subagent): injectable concurrency limits + coverage` | 3.9 + 深度/审批/supersede 空白 | T8 T9 T10 T15 |
| 7 | `fix(i18n): locale parity test and missing zh-CN keys` | 3.10 | T16 |
| 8 | `feat(chat): cancel/retry/steer actions on task rows` | 3.7（含 steerTask IPC 全链） | T17（操作部分） |
| 9 | `feat(chat): read-only drill-down into sub-agent transcripts` | 3.8 | T17（readonly 部分）+ 手动走查 |
| 10 | `docs(architecture): document subagent scheduling internals` | §8 | — |

估算：提交 1-7 约 2.5 天；提交 8 约 1 天;提交 9 约 1.5-2 天（新增
readonly 会话模式是最大单体）；提交 10 约 0.5 天。合计 5.5-6 天。

提交 9 的手动走查清单：运行中任务下钻可见实时工具帧；已结算任务打开为
静态转录；关闭释放 session；composer 不可达；审批仍只出现在根会话。

---

## 8. 文档同步（S15）

`docs/architecture/12-tools.md` §6 追加四节，`docs/architecture/zh/` 若有
对应文件同步：

1. **并发模型**：global(100)/per-root(20) 双信号量、获取顺序与 abort 回滚。
2. **依赖调度**：dependsOn → pending(block:dependency)、结算边重评估（I2）、
   失败传播（failedDependencyId）、cascadeRetry。
3. **重启恢复**：reconcileOrphans 与 `failureKind:'app-restart'` 的 UI 语义。
4. **审批冒泡**：surface → 根会话 `data-taskApproval` → respond →
   policy.remember → 恢复循环；waiter 先行顺序。

另在 §6 工具表补 await 的 `unknown` 字段与 steer 的 union 约束。

---

## 9. 风险与权衡

- **steer 拒绝复活是行为收紧**。若既有父代理提示词依赖"steer 已完成任务
  = 追问"，会从静默复活变成显式报错 —— 这是从错误行为到正确报错的迁移，
  toolError 文案已给出替代路径（spawn 新任务）。
- **steer union schema 对弱 provider 的兼容性**。anyOf 在个别 provider 的
  工具参数约束下可能退化；execute 内运行时校验保留兜底，退化时行为等同
  现状，不更差。
- **工具描述变更使父代理 prompt 缓存前缀一次性失效**。可接受；与其他
  工具文案变更同性质。
- **locale 全量奇偶校验可能暴露 subagent 之外的存量缺键**。预期收益；
  修复量未知是唯一不确定项，若过大可在提交 7 内拆分"补键"与"守卫"两步，
  但守卫必须落地。
- **下钻视图的 readonly 双保险**（UI 不渲染 + preload 拒绝）有轻微冗余，
  换取的是"任何未来入口都无法向 executor 会话误写"的硬保证，值得。
- **spawn 预校验前移**改变了失败时的可观测痕迹（不再有带 objective 的
  孤儿子会话可供事后检查）；失败原因完整保留在任务行与 toolError 中，
  痕迹损失可接受。

---

## 10. 非目标

- 不重写状态机/服务分层 —— 现有架构正确，v2 全部是守卫、字段与接线。
- 不为子任务引入 token/时间预算（属 goal 域的新功能，非本重构范围）。
- 不把子代理会话列入 sidebar —— 下钻入口唯一（TaskRow），保持会话列表
  干净。
- 不改 `readableId` 生成规则（按类型计数虽不可预测，但 spawn 返回值 +
  hint 已闭环；改动破坏历史数据一致性）。
- 不提供 UI 级 redefine（破坏性重启留给"取消 + 对父代理下新指令"的
  显式路径）。
- 不做双 driver 真并发的集成 harness（已知缺口，显式遗留）。
