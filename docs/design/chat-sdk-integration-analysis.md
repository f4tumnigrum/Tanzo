# Tanzo × Chat SDK 集成分析

> 分析对象：Vercel [Chat SDK](https://chat-sdk.dev)(`chat` npm 包)。
> 目的:判断 Tanzo 该不该、以及如何利用 Chat SDK。
> 依据:Tanzo `docs/architecture/{02,10,13}` + 源码 `src/main/agent/*`;Chat SDK `docs/{usage,handling-events,streaming,ai/ai-sdk-tools}`。
> 结论一句话:**两者不是竞品,是互补层。最高价值的用法是让 Chat SDK 做"IM 平台 I/O 网关",把 Tanzo 的本地 agent 接到 Slack/飞书/微信/Teams 等聊天平台上。**

---

## 1. 先厘清:两者各自是什么

| | Tanzo | Chat SDK |
|---|---|---|
| 本质 | 桌面端**自主编码 agent 运行时** | 跨平台**聊天机器人 I/O 框架** |
| 运行位置 | 本地 Electron 主进程 | Node 服务端 / serverless(webhook) |
| 解决的问题 | 在**本地工作区**读写文件、跑 shell、搜代码、编排子 agent,每步经审批 | 把一套 handler 归一化到 **15+ IM 平台**:消息、线程、卡片、模态、reaction、slash command |
| agent loop | 自己包了 `AgentService → RunEngine → TurnLoop` 外层,内层是 AI SDK `streamText` | 不含 agent loop;提供 `createChatTools` 把"发消息/回帖/reaction"暴露成 AI SDK tools |
| 前端 | React 19 渲染器 + 审批 UI | 无前端,前端就是 IM 平台本身 |
| 共同基座 | **Vercel AI SDK v7**(`ai@7`, `tool()`, `UIMessage`, `streamText`) | **Vercel AI SDK v7**(tools 走 `chat/ai` 子路径) |

关键事实:**两者都构建在同一个 AI SDK v7 之上**(Tanzo `package.json` 用 `ai@7.0.12`;Chat SDK 的 tools 是标准 `tool()`)。这让集成从"可能"变成"自然"——它们说同一种 tool 语言、同一种 `UIMessage` 语言、同一种审批语言(`needsApproval` / `toolApproval`)。

**重要判断:Chat SDK 不能替代 Tanzo 的任何核心子系统。** Tanzo 的价值在"本地文件执行 + 审批 + 上下文压缩 + 子 agent",Chat SDK 完全不碰这些。反过来 Tanzo 也没有任何 IM 平台 adapter。二者零重叠。

---

## 2. 三个候选方向

### 方向 A —— IM 网关:把 Tanzo agent 接到聊天平台(**推荐,价值最高**)

**动机**:今天 Tanzo 的唯一入口是本地 Electron 窗口。用 Chat SDK 做一个 adapter,让用户能在 Slack / 飞书 / Teams / Discord / 微信里 @ 机器人,由本地这台跑着 Tanzo 的机器执行编码任务、回传结果。这把 Tanzo 从"单机 GUI 工具"扩成"团队可远程触发的本地 agent"。

**为什么天然可行**——Tanzo 的运行时早就是"无头可驱动"的:
- `AgentService` 的公开能力是 `submitMessage / run / respondApprovals / enqueue`(`docs/architecture/10` §1),**完全不依赖渲染器**。渲染器只是 `deps.send` 的一个消费者。
- 消息是标准 `TanzoUIMessage`(AI SDK `UIMessage` 的超集),流式输出是 `chat:event:<chatId>` 上的 chunk 帧。任何进程只要能调 `submitMessage` 并订阅 chunk,就能当"另一个前端"。
- 审批状态**存在消息里**,不在内存(`docs/architecture/13` §3)。这意味着审批可以在 IM 里用一条卡片 + 按钮/reaction 来响应,再把 `applyApprovalResponses` 的结果写回、重新 `submit`。Chat SDK 的 `onReaction`(👍/👎 当 approve/reject)和 Actions(按钮)正好是这套审批的天然 IM 载体。

**数据流(设想)**:
```
[IM 平台] 用户 @bot "修一下登录页的 bug"
   → Chat SDK webhook(bot.webhooks.slack / .lark)
   → onNewMention(thread, message)
   → 适配层:threadId ⇄ Tanzo chatId 映射,把 message.text 转成 TanzoUIMessage
   → AgentService.submitMessage(chatId, msg)          ← 复用现有运行时,零改动
   ── Tanzo 本地跑 streamText:读文件 / 改代码 / 跑测试 ──
   → 订阅 chat:event:<chatId> 的 chunk
   → 文本 delta → thread.streamText(...)               ← Chat SDK 的 post+edit 流式
   → 需要审批 → thread.post(审批卡片)                    ← 按钮/reaction
   → 用户点"批准" → onAction/onReaction
   → applyApprovalResponses → 再 submit,run 续跑
```

**边界与难点(必须正视)**:
1. **进程模型冲突**。Chat SDK 设计成 webhook 服务端(Next.js route / serverless),Tanzo 是桌面 Electron。要在 Tanzo 主进程内**内嵌一个轻量 HTTP server** 收 webhook(Tanzo 启动时已经 "reserve loopback port",见 `02` §1,基础设施在),或走 Chat SDK 支持的 **polling / WebSocket 长连**模式(Telegram polling、飞书 WebSocket 长连——避免公网回调,对本地机器友好)。**飞书 adapter 的 WebSocket 长连模式对"本地机器无公网 IP"的场景几乎是量身定做的。**
2. **单会话串行 vs 多线程并发**。`ChatMailbox` 保证每个 chatId 严格串行(`10` §4.1),这和 IM 里"一个 thread 一个会话"能对齐——把 IM threadId 一一映射到 Tanzo chatId 即可,天然复用串行语义。
3. **审批 UX 降级**。桌面端审批 UI 很丰富(diff 预览、逐条批准),IM 里只能用卡片 + 按钮近似。要挑"高危操作才在 IM 里问,其余用 `yolo`/`dangerous` 模式或预授权"的策略(Tanzo 的 `PermissionMode` 和 `remember(forever)` 正好支持)。
4. **安全**。远程触发本地文件执行是强力也是危险的能力。必须:webhook 签名校验(各 adapter 自带)、把可触发的用户/频道白名单化、默认非 `yolo`、把 `b.*` 内置 guardrail(`13` §2.3,禁 .git/凭据/rm -rf)保持开启。这条要在设计阶段就定死。

**落地形态**:新增 `src/main/chat-bridge/` 模块,遵循 Tanzo 的 module-factory 约定(`createChatBridgeModule(deps) → { registerIpc, close }`),依赖注入 `agentModule.service`。它内部持有一个 `Chat` 实例(Chat SDK),把 IM 事件翻译进 `AgentService`,把 chunk 翻译回 IM。**对 agent 核心零侵入**——这正符合 Tanzo "加一个能力 = 加一层,核心不动"的不变式。

---

### 方向 B —— 借鉴设计,不引入依赖(**低成本,随时可做**)

即使不集成,Chat SDK 有几处设计值得 Tanzo 直接借鉴:

- **并发策略枚举**。Chat SDK 的 `concurrency: "drop" | "queue" | "debounce" | "burst" | "concurrent"`(`docs/usage`)是对"同一线程重叠消息"的成熟抽象。Tanzo 现在是硬编码的 per-chatId 串行(mailbox)+ steerQueue;如果未来要支持"打断/改口"(steerability),Chat SDK 的 `onLockConflict: 'force'`(释放锁重取,支持打断长任务)是现成的参考模型。
- **流式节流**。Chat SDK `streamingUpdateIntervalMs: 500`(post+edit 节流)对应 Tanzo 的 `DEFAULT_DELTA_BATCH_MS = 24ms`。两者都在做同一件事(合并 delta 减少下游压力),但 IM 的节流窗口比渲染器大一个量级——这提醒:**如果做方向 A,chunk 转发到 IM 时要单独加一层粗节流**,不能把 24ms 的帧率直接打到 Slack API(会撞速率限制)。
- **`toAiMessages` 的归一化思路**。Chat SDK 把多平台消息 → AI SDK `ModelMessage` 的转换(多用户 name 前缀、附件处理)是干净的参考,对 Tanzo 未来做"多来源消息入 context"有借鉴意义。

这条不需要动依赖,只是设计层面的参考。

---

### 方向 C —— 在 Tanzo 内置"造 bot"能力给用户(**不推荐,至少现在**)

设想:Tanzo 用户在工作区里用 Chat SDK 写自己的 bot,Tanzo 提供脚手架/预览。

**为什么不推荐**:这只是"Tanzo 作为通用 IDE 帮你写任意项目"的一个特例,和 Tanzo 的产品定位(自主 agent 工作区)无本质耦合,不产生 1+1>2。Chat SDK 已有官方 CLI(`create-chat-sdk`)和完整文档,Tanzo 没有理由重造。真要支持,提供一个 Skill(渐进式披露,Tanzo 已有 Skills 机制)引导 agent 用 Chat SDK 建 bot 即可——**零代码成本,把知识交给 agent**。

---

## 3. 关键契合点速查(为什么 A 值得做)

| Chat SDK 概念 | Tanzo 对应 | 契合度 |
|---|---|---|
| `Chat` 实例 + 多 adapter | 新增 `chat-bridge` 模块持有 | 新增,不冲突 |
| `onNewMention` / `onSubscribedMessage` | `AgentService.submitMessage(chatId)` | ★★★ 直接映射 |
| IM `threadId` | Tanzo `chatId`(mailbox 串行) | ★★★ 一一映射,复用串行语义 |
| `thread.streamText()`(流式回帖) | `chat:event:<chatId>` chunk 订阅 | ★★★ chunk → IM edit |
| `needsApproval` / 审批请求 | 审批存在消息里 + `applyApprovalResponses` | ★★★ 同源设计,IM 用卡片/reaction 响应 |
| `onReaction`(👍/👎) / Actions(按钮) | 审批 approve/reject | ★★★ IM 侧的审批载体 |
| `createChatTools`(agent 能发 IM 消息) | 可作为 Tanzo 的一个额外 toolset | ★★ 让 Tanzo agent 反向操作 IM |
| webhook / polling / WebSocket 长连 | Tanzo 已 reserve loopback port | ★★ 长连模式最适合本地无公网 |
| 状态 adapter(Redis/PG) | Tanzo 用本地 SQLite | ✗ 不需要,用 memory state 即可 |

`createChatTools` 那一栏值得单独说:它让 **agent 主动往 IM 发东西**(不止是被动应答)。比如 Tanzo 的 goal 系统跑完一个长任务后,可以调 `postMessage` 主动到 Slack 汇报——这是方向 A 之上的一个增值点。

---

## 4. 建议的推进路径

1. **先做一个最小验证(spike)**:选**飞书(Lark)WebSocket 长连** adapter 或 **Telegram polling**(都不需要公网回调,最适合本地机器),在 `spike/` 下写一个脚本:收到 @ → 调 `AgentService.submitMessage` → 把文本 chunk 回帖。**只跑通"文本进、文本出",先不做审批。** 验证进程模型和 chatId 映射是否顺畅。
2. **加审批桥**:把审批请求 chunk 转成 IM 卡片,用 `onAction`/`onReaction` 收批准,`applyApprovalResponses` 写回重跑。这是最有技术含量、也最能体现 Tanzo 差异化的一步。
3. **收敛成模块**:`src/main/chat-bridge/`,module-factory 形态,配置放 settings(哪些平台、哪些用户/频道白名单、默认权限模式)。
4. **安全评审**:远程触发本地执行,必须专门过一遍——白名单、签名、默认非 yolo、guardrail 常开。

**先不要做**:多平台一次性全上、状态 adapter(SQLite 已够)、把 Chat SDK 塞进渲染器(它是服务端框架,该待在主进程)。

---

## 5. 一句话总结

Chat SDK 对 Tanzo 的正确定位是**"IM 平台的 I/O 网关"**,而不是替代品或内部重构。因为两者同基座(AI SDK v7)、同审批哲学(`needsApproval` ⇄ 审批存消息)、Tanzo 运行时本就无头可驱动,集成成本低、对核心零侵入,却能把 Tanzo 从"单机 GUI"扩成"团队可远程触发的本地 coding agent"。**方向 A 值得做一个 spike 验证;方向 B 随手可借鉴;方向 C 交给 Skill 即可。**
