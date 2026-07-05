# 设计文档 · 流式输出与会话切换数据流重构（Streaming Dataflow v2）

> 状态：草案（待评审）
> 范围：`src/main/agent/runtime/run-session-registry.ts`、`src/main/agent/module.ts`（chunk sink /
> deliverer）、`src/main/agent/runtime/run-persistence-registry.ts`、
> `src/renderer/src/platform/electron/run-stream.ts`、
> `src/renderer/src/features/chat/model/conversation/**`、
> `src/renderer/src/features/chat/ui/message-list.tsx`、`ui/message/**`、`page.tsx`。
> 前提：保留现有不变量（frame gate 序号门、terminal race 处理、compaction 展示语义、
> steering pin 语义、持久化失败恢复）；与 compaction v2 的持久层改动协同，不回退其设计。

---

## 0. 摘要

流式输出卡顿与切换卡顿来自四层确定性缺陷的叠加，而非单点问题：

1. **渲染 O(n²)**：每个 delta 触发全树重渲染 + 增长文本全文重解析（remark/KaTeX 管线）；
2. **切换即冷启动**：强制 spinner 帧 + 按 key remount + IPC 瀑布 + 1s 会话销毁；
3. **主进程阻塞**：每 chunk 3~4 次深拷贝；每 step 同步 SQLite 全量重写 transcript，
   阻塞事件循环导致帧投递周期性停顿；
4. **事件率与渲染率耦合**：IPC 到达率直接等于 React 渲染率，无渲染端汇聚。

v2 用四条原则重建：**每帧有界工作量**（tick 批量帧 + rAF 泵）、**细粒度订阅**（
按消息订阅，仅活跃尾部重渲染）、**热会话常驻**（LRU 保活，切换零 IPC 首帧）、
**主进程零阻塞**（不可变帧免拷贝 + 增量持久化）。

---

## 1. 现状全链路与瓶颈定位

### 1.1 数据流（现状）

```
main: streamText → createUIMessageStream → drain
  └─ send(chatId, chunk, {runId})                      stream-runner.ts:586
      └─ streams.publish                                module.ts:128
          ├─ pushStoredFrame(clone#1)                   run-session-registry.ts:352
          ├─ enqueueLiveFrame(clone#2)  24ms 合并       run-session-registry.ts:356
          └─ deliver(clone#3) → webContents.send(#4)    run-session-registry.ts:282
renderer: ipcRenderer.on(chat:event:{chatId})
  └─ connectRun.push → gate.accept                      run-stream.ts:168
      └─ sink.enqueue → readUIMessageStream             run-stream.ts:52
          └─ onMessage → setState(全量 state 对象)      chat-session.ts:270-287
              └─ 通知全部 listeners → React 同步渲染
                  ├─ ActiveChat → MessageList → 尾部消息全部 parts 重渲染
                  ├─ Response → Markdown 全文重解析     markdown.tsx:408-425
                  └─ Composer → selectLatestTodos 全量扫描  composer.tsx:48
持久化（每 step，主进程同步）:
  onStepEnd → persistStepMessages
    └─ loadUnvalidated(全量) → merge → save(全量重写)   run-persistence-registry.ts:174-197
                                                        store.ts:294-297 (better-sqlite3 事务)
```

### 1.2 分层瓶颈（按影响排序）

| # | 层 | 问题 | 证据 | 复杂度特征 |
|---|----|------|------|-----------|
| R1 | 渲染 | 增长文本每 delta 全文重解析（normalizeMathDelimiters 正则 + XML 扫描 + splitMarkdownBlocks + 尾块 remark+KaTeX） | `markdown.tsx:411`, `response.tsx:22` | O(n)/delta ⇒ O(n²)/流 |
| R2 | 渲染 | 每 chunk 全量 setState，所有订阅者整体重渲染；`readUIMessageStream` 每次产出新 message 对象（parts 数组身份全新），尾部消息所有已完成 parts 一并重渲染 | `chat-session.ts:270-287`, `message-utils.ts:16` | 每 delta 全树 |
| R3 | 渲染 | Composer 订阅整个 session state，每 delta 重跑 todos 全量扫描 | `composer.tsx:33,48` | O(msgs)/delta |
| S1 | 切换 | rAF+transition+remount：必现 spinner 帧；重挂载全部消息（高亮/KaTeX 在 render 期同步执行） | `page.tsx:39-52,73-82` | O(transcript)/切换 |
| S2 | 切换 | 会话打开 IPC 瀑布（listMessages → getConversation → runSnapshot → 4 sidecars）；离开 1s 即销毁，回切全部重来 | `chat-session.ts:67,387-449` | 每次切换 |
| S3 | 切换 | snapshot replay 逐帧 setState，一次 attach 数十次同步渲染 | `run-stream.ts:205-218` | O(parts)/attach |
| M1 | 主进程 | 每 step 同步全量读+全量写 SQLite，阻塞事件循环 → 帧投递停顿（节奏性卡顿） | `store.ts:294-297`, `run-persistence-registry.ts:174-197` | O(transcript)/step |
| M2 | 主进程 | 每 chunk 3 次 structuredClone + IPC 序列化；`snapshot()` 深拷贝整个帧缓冲 | `run-session-registry.ts:349-357,379-392` | O(buffer)/attach |
| I1 | IPC | 24ms 合并仅覆盖同 part 连续 delta；非可合并 chunk 立即 flush，工具密集时事件率不受控 | `run-session-registry.ts:294-311` | 无上界 |

---

## 2. 设计目标与不变量

**目标（可验证）**

- G1 流式期间每动画帧 ≤1 次 React 提交；单 delta 只重渲染活跃尾部块。
- G2 会话切换：热切换（LRU 内）首帧 <50ms、零 IPC；冷切换骨架帧后 <150ms 可交互
  （500 条消息 transcript）。
- G3 流式期间主进程事件循环单次阻塞 <8ms。
- G4 每 chat 的 IPC 事件率有硬上界（≤ tick 率，默认 30Hz）。

**保留的不变量**

- N1 frame gate：`(runId, seq)` 单调接受，snapshot replay 与 live 帧去重（`run-stream.ts:24-45`）。
- N2 terminal race：terminal 事件先于 attach 到达时缓存并在 attach 后 settle。
- N3 compaction 展示语义与 `compactionInProgress` 对账逻辑不变。
- N4 steering pin、持久化失败恢复（`restoreLastRunOutcome`）语义不变。
- N5 run-session-registry 的 start/finish 编排契约（见其文件头注释）不变。

---

## 3. 新架构

### 3.1 分面：把一条"上帝数据流"拆成三个平面

```
┌─ Transcript 平面（高频）──────────────────────────────────┐
│ main RunHub ──tick批帧──▶ TranscriptStore ──rAF泵──▶ 按消息订阅 │
└──────────────────────────────────────────────────────────┘
┌─ 运行控制平面（低频）────────────────────────────────────┐
│ run-state / status / notice / context / compaction → RunStateStore │
└──────────────────────────────────────────────────────────┘
┌─ Sidecar 平面（低频）────────────────────────────────────┐
│ queued / tasks / goal / approvals → SidecarStore            │
└──────────────────────────────────────────────────────────┘
```

现状所有平面共享一个 `ChatSessionState` 对象，任何低频状态变化也会经由同一
`setState` 广播给所有订阅者。拆分后各平面独立订阅，Composer 永远不因 text-delta
重渲染。

### 3.2 主进程：RunHub（run-session-registry v2）

**帧不可变 + 单次构造，零防御性拷贝**

- chunk 进入 `publish` 时构造一次 frame；合并 delta 时产出新 chunk 对象（现有 merge
  函数已如此）。存储、投递、snapshot 共用同一不可变对象。
- 删除 `pushStoredFrame`/`enqueueLiveFrame`/`deliver` 三处 `structuredClone`
  （Electron IPC 序列化本身就是一次拷贝；进程内唯一消费者是 `webContents.send`）。
  dev 模式下可 `Object.freeze` 帧对象作为免拷贝契约的守卫。
- `snapshot()` 返回 `frames` 的浅拷贝数组（元素不可变），`baseMessages` 在 `start`
  时已 clone 一次，直接复用。消除 attach 时的主进程大拷贝。

**tick 批帧协议（替代 24ms 单帧合并）**

```ts
interface ChatRunFrameBatch {
  kind: 'run-frame-batch'
  chatId: string
  runId: string
  frames: ChatRunFrame[]   // 各帧保留独立 seq，批内保序
}
```

- 每 chat 一个 tick（默认 33ms）。tick 内到达的所有 chunk 追加进当前批：可合并
  delta 原地合并（复用现有 merge 规则），非可合并 chunk **不再触发提前 flush** ——
  批内保序即可保证正确性。tick 到期投递一个事件。
- 效果：IPC 事件率硬上界 = tick 率；工具密集场景从每 chunk 一事件降到每 33ms 一事件。
- `flush(chatId)` 语义保留（terminal / notification 前强制排空）。
- 渲染端 `connectRun` 改动极小：`push(batch)` 内对每帧走原 `gate.accept`。

### 3.3 主进程：增量持久化（run-persistence-registry v2）

- session 维护 `dirtyIds: Set<string>`：`mergeGeneratedMessages` 时顺带标脏
  （generated 消息 + continuation 消息）。
- 新增 `store.upsertMessages(chatId, messages, order?)`：只 upsert 脏行；顺序列
  仅在插入新消息时更新。`save`（全量重写）仅保留给 final 落盘与
  compaction finalize 等需要强一致顺序的路径。
- step 内不再 `loadUnvalidated` 全量读 —— session 已持有 baseMessages 与上次合并
  结果，在内存中维护 `persisted` 视图（run 期间该 chat 的写入者唯一，与 N5 一致）。
- 效果：每 step 写入成本从 O(transcript) 降到 O(本 step 变更)，主进程阻塞消除（G3）。
- 与 compaction v2 协同：`finalizeCompaction` 路径不变；merge-step-rows 迁移后的
  按消息行模型正好支持行级 upsert。

### 3.4 渲染端：SessionManager + 三个 Store

替代 651 行的 `chat-session.ts` 上帝对象，按职责拆四个文件：

```
model/conversation/
  session-manager.ts    // LRU 保活、生命周期、IPC 订阅编排
  transcript-store.ts   // 帧应用、结构共享、rAF 泵、按消息订阅
  run-state-store.ts    // phase/notice/context/compaction（含现 reduceRunNotice）
  sidecar-store.ts      // queued/tasks/goal/approvals
```

**TranscriptStore：细粒度订阅 + 结构共享**

```ts
interface TranscriptStore {
  // 身份稳定：仅增删消息时变化
  subscribeOrder(cb): () => void
  getOrder(): readonly string[]
  // 每消息独立版本：仅该消息变化时通知
  subscribeMessage(id, cb): () => void
  getMessage(id): TanzoUIMessage
  applyChunks(chunks: UIMessageChunk[]): void   // 只入缓冲
  replaceAll(messages: TanzoUIMessage[]): void  // refresh/reconcile 用
}
```

- **chunk 应用**仍复用 AI SDK `readUIMessageStream`（工具状态机、approval、data part
  语义复杂，不自造），但对其每次产出的全新 message 快照做 `stabilize(prev, next)`：
  逐 part 浅比较（type/state/文本长度先行短路），未变化的 part 复用旧引用；全部复用
  则整条消息保持旧身份。已完成 parts 因此获得稳定引用，`memo` 生效。
- **rAF 泵**：`applyChunks` 只写入待应用缓冲并调度一次 `requestAnimationFrame`；
  帧回调统一应用、更新受影响消息的版本号、每个受影响订阅仅通知一次。
  `document.hidden` 时降级为 250ms setTimeout（后台会话继续吸收帧但不产生渲染）。
  snapshot replay（S3）天然收敛为一次提交。
- UI 侧新增两个 hook：

```ts
useMessageOrder(chatId): readonly string[]        // MessageList 用
useMessage(chatId, messageId): TanzoUIMessage     // MessageItem 内部用
```

  `MessageList` 只 map id；`MessageItem` 自己订阅自己的消息。text-delta 到达时
  **只有尾部那一条消息的组件**收到通知（G1）。

**RunStateStore / SidecarStore**

- `data-part-router` 的路由目标从 setState 补丁改为对应 store 的 setter，逻辑不变。
- Composer 改为订阅 `RunStateStore`（isStreaming/isStopping/contextStatus）与
  `SidecarStore`（queued/goal）；todos 改为 TranscriptStore 上的专用派生订阅
  （仅当含 todo 工具 part 的消息版本变化时重算），消除 R3。

**SessionManager：LRU 保活，消灭 1s 销毁**

- 保活策略：`active ∪ running ∪ 最近 N(=4) 个`，超出上界或消息字节超限时逐出
  最旧的非运行会话。运行中的会话永不逐出（其帧订阅必须持续）。
- 会话保留 IPC 订阅与三个 store；热切换直接从内存渲染首帧（零 IPC，G2），随后
  后台 `reconcile()`（listMessages → 按 id/内容 diff → 仅变化处 `replaceAll` 或静默
  跳过），替代现 `refresh` + `settleRefreshRevision` 的强刷。
- 空闲非运行会话可降订阅（仅保留 run-state 唤醒通道 —— 全局 `onAnyEvent` 已存在，
  见 `use-running-conversations.ts`）；收到 `running` 时恢复帧订阅并走 attach。
- `TEARDOWN_DELAY_MS` 删除。connectRun / frame gate / terminal 缓存逻辑原样迁入
  session-manager（N1/N2）。

### 3.5 渲染端：切换路径

- 删除 `page.tsx` 的 rAF + transition + `ChatSwitchShell` remount 舞蹈。`ActiveChat`
  仍按 chatId keyed（会话内局部 UI 状态天然重置），但首帧必须同步来自热 store；
  无缓存时渲染轻量骨架（非全屏 spinner），`listMessages` 返回后填充。
- **渐进挂载**（保持"无虚拟化"的既有决策，见 `message-list.tsx` 头注释）：
  - 首帧只挂载最后 K(=30) 条消息（用户切入即看到底部，滚动钉底逻辑不变）；
  - `requestIdleCallback` 分批（50 条/批）向上补挂旧消息；
  - 用户上滚触达已挂载区顶部时同步补挂一批。
  - `content-visibility: auto` 与 ResizeObserver 钉底机制保留。
- 效果：切换感知耗时与 transcript 长度解耦（G2）。

### 3.6 渲染端：流式 Markdown O(1) 化

**块级冻结（核心）**

- 新增 `incremental-blocks.ts`：按 part 维护块缓存
  `{ frozenBlocks: Block[], frozenOffset: number, tail: string }`。
  新文本到达时只对 `frozenOffset` 之后的尾部重跑 `normalizeMathDelimiters` +
  `splitMarkdownBlocks`；当尾部出现新的块边界（`\n\n`、fence 闭合）时把完成块冻结、
  推进 offset。冻结块内容与 React 元素身份永久稳定 → `MarkdownBlock` 的 memo 真正
  生效，每 delta 只有**最后一个未完成块**重跑 remark 管线。
- `normalizeMathDelimiters` / XML 标签扫描一并纳入增量窗口，消除全文正则（R1）。

**尾块降级渲染（Phase 内可选项）**

- 流式期间尾块用轻管线（GFM，不挂 remark-math/rehype-katex），块冻结时升级为完整
  管线。KaTeX 排版只在块完成后发生一次。
- 增长中的代码块：流式期间高亮节流至 150ms 或冻结时一次性高亮。

---

## 4. 正确性论证（对齐现有不变量）

- **N1**：批帧内各帧保留独立 seq，`gate.accept` 逐帧判定；批与单帧在 gate 语义上
  等价。snapshot replay 与 live 批的去重逻辑不变。
- **N2**：terminal run-state 仍走独立事件（不进批），`finish` 前 `flush` 保证批内
  帧先于 terminal 到达；`terminalRunIds` 缓存路径不变。
- **N3/N4**：compaction 与 steering 均为 data part / 持久层语义，本次仅改传输与
  渲染粒度，不触碰其状态机。`reconcileCompactionInProgress` 迁入 RunStateStore，
  在 TranscriptStore 的 rAF 提交回调里对账（时机等价于现 `setState` 钩子）。
- **N5**：run-session-registry 的 start/finish 编排、幂等 finish、supersede 语义
  逐行保留；只更换存储与投递的内存策略。
- **免拷贝契约**：主进程帧对象自 `publish` 起不可变；merge 产生新对象而非原地改
  （现 `mergeStoredFrame` 是原地改 `previous.chunk` —— v2 改为替换尾帧对象，
  避免已投递对象被后续 merge 污染）。

---

## 5. 落地计划（三阶段，各自独立可交付）

### Phase 1 · 渲染路径（无协议变更，收益最大）

1. `transcript-store.ts` + `stabilize` + rAF 泵；`useMessageOrder`/`useMessage`。
2. `run-state-store.ts` / `sidecar-store.ts` 拆分；Composer/ActiveChat 改订阅面；
   todos 派生订阅。
3. `incremental-blocks.ts` 块级冻结；`Response`/`Markdown` 接入。
4. 验证：更新 `tests/unit/renderer/chat-session.test.ts`（拆为三个 store 的测试）、
   `message-utils.test.ts`；新增 stabilize 与 incremental-blocks 单测；
   手测 G1（React DevTools highlight / `performance.mark` chunk→paint）。

### Phase 2 · 会话切换

1. `session-manager.ts` LRU 保活，删除 `TEARDOWN_DELAY_MS`；后台 reconcile 替代
   settleRefreshRevision 强刷。
2. `page.tsx` 去 remount/spinner；MessageList 渐进挂载。
3. 验证：run-stream.test.ts 回归（gate/terminal race）；手测热切换零 IPC（
   开 devtools 网络面板确认）、500 条冷切换骨架→可交互耗时。

### Phase 3 · 主进程

1. RunHub：免拷贝 + tick 批帧协议（`run-frame-batch`）；渲染端 connectRun 适配
   （对批逐帧 gate）。
2. run-persistence-registry 增量持久化 + `store.upsertMessages`。
3. 验证：`run-persistence-registry.test.ts`、新增 registry 批帧单测；
   流式期间主进程 event-loop lag 采样（G3）；长 transcript step 写入耗时对比。

### 度量基线（Phase 0，动手前先测）

- 录制一次 2k+ 行回复的流式过程：chunk→paint 延迟分布、React 提交次数/秒、
  主进程 event-loop lag、切换耗时（热/冷）。重构后同口径复测，写入本档附录。

---

## 6. 风险与备选

| 风险 | 缓解 |
|------|------|
| `readUIMessageStream` 快照与 stabilize 的假设漂移（SDK 升级改变 part 身份语义） | stabilize 只做保守浅比较，比较失败即用新对象 —— 最坏退化为现状，不会错渲染 |
| 块冻结误判（fence 未闭合被切块） | 复用 `splitMarkdownBlocks` 已有 fence 感知；冻结仅在 fence 平衡时推进 offset |
| LRU 保活增加常驻内存 | 字节上限 + 非运行会话降订阅；逐出即释放 store |
| 批帧协议改动波及 pet/多窗口消费者 | `ChatEvent` 联合类型新增成员，旧成员语义不变；消费者按 kind 分支，未适配者忽略新 kind（一次性排查 `onEvent` 全部调用点） |
| 增量持久化与 compaction finalize 竞争 | 沿用 N5 单写者编排：run 内行级 upsert，finalize 仍全量事务；两者由 runId bracket 串行化 |

**被否决的备选**

- 完整虚拟化列表：与现有"无虚拟化 + content-visibility"决策冲突，测量/滚动校正
  bug 面大；渐进挂载已满足 G2。
- 自研 chunk→UIMessage 状态机替代 `readUIMessageStream`：复制 SDK 工具/approval
  状态机风险高，stabilize 已拿到同等渲染收益。
- 把 SQLite 移到 worker 线程：增量写已把单次阻塞降到亚毫秒级，worker 化的收益
  不抵复杂度；若 Phase 3 测量仍超 G3 再启用。
