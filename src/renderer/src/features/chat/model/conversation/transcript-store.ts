import type { TanzoUIMessage } from '@shared/agent-message'
import { stabilizeMessage } from './stabilize'

/**
 * High-frequency transcript plane with per-message subscriptions.
 *
 * The store separates subscription granularities so a streaming delta only
 * wakes the component rendering the affected message:
 *
 *  - `subscribeOrder`: fires only when messages are added/removed/reordered.
 *    `getOrder()` returns an identity-stable array of ids.
 *  - `subscribeMessage(id)`: fires only when that message's content changes.
 *  - `subscribeChanges`: coarse commit feed for derived state (todos,
 *    compaction reconciliation) — one call per commit with the changed ids.
 *
 * Writers batch through a frame pump: `upsert`/`replaceAll` enqueue and
 * schedule a single animation-frame commit, so no matter how many chunks the
 * IPC layer delivers, at most one notification wave (one React commit)
 * happens per animation frame. When the document is hidden — or outside a
 * browser environment — the pump degrades to a timer so background chats
 * keep absorbing frames without rendering work. `flushSync` commits
 * immediately for callers that need read-after-write semantics.
 *
 * Message objects pass through {@link stabilizeMessage} on commit, so parts
 * that did not change keep their previous object identity and downstream
 * `memo` boundaries hold during streaming.
 */
export interface TranscriptStore {
  subscribeOrder(listener: () => void): () => void
  getOrder(): readonly string[]
  subscribeMessage(id: string, listener: () => void): () => void
  getMessage(id: string): TanzoUIMessage | undefined
  getMessages(): readonly TanzoUIMessage[]
  subscribeChanges(
    listener: (changedIds: ReadonlySet<string>, orderChanged: boolean) => void
  ): () => void
  /** Insert or update one streamed message; batched via the frame pump. */
  upsert(message: TanzoUIMessage): void
  /** Replace the whole transcript (history load / settle refresh); batched. */
  replaceAll(messages: readonly TanzoUIMessage[]): void
  /** Apply pending writes synchronously. */
  flushSync(): void
  /** Stop the pump and drop listeners. */
  dispose(): void
}

const HIDDEN_PUMP_INTERVAL_MS = 250

function rafAvailable(): boolean {
  return typeof requestAnimationFrame === 'function' && typeof document !== 'undefined'
}

export function createTranscriptStore(initial?: readonly TanzoUIMessage[]): TranscriptStore {
  let order: string[] = initial ? initial.map((message) => message.id) : []
  const byId = new Map<string, TanzoUIMessage>(
    initial ? initial.map((message) => [message.id, message]) : []
  )

  const orderListeners = new Set<() => void>()
  const messageListeners = new Map<string, Set<() => void>>()
  const changeListeners = new Set<(ids: ReadonlySet<string>, orderChanged: boolean) => void>()

  // Full replacement takes precedence over accumulated upserts.
  let pendingReplaceAll: TanzoUIMessage[] | null = null
  const pendingUpserts = new Map<string, TanzoUIMessage>()
  let scheduled: number | ReturnType<typeof setTimeout> | null = null
  let scheduledKind: 'raf' | 'timer' | null = null
  let disposed = false

  // Cached `getMessages()` result; invalidated by commits that change content.
  let messagesCache: TanzoUIMessage[] | null = initial ? [...initial] : []

  const cancelScheduled = (): void => {
    if (scheduled === null) return
    if (scheduledKind === 'raf') cancelAnimationFrame(scheduled as number)
    else clearTimeout(scheduled as ReturnType<typeof setTimeout>)
    scheduled = null
    scheduledKind = null
  }

  const commit = (): void => {
    cancelScheduled()
    if (disposed) return
    const replace = pendingReplaceAll
    const upserts = new Map(pendingUpserts)
    pendingReplaceAll = null
    pendingUpserts.clear()
    if (!replace && upserts.size === 0) return

    const changedIds = new Set<string>()
    let orderChanged = false

    if (replace) {
      const nextOrder = replace.map((message) => message.id)
      orderChanged =
        nextOrder.length !== order.length || nextOrder.some((id, index) => id !== order[index])
      const removedIds = new Set(order)
      for (const message of replace) {
        const previous = byId.get(message.id)
        const stabilized = stabilizeMessage(previous, message)
        if (stabilized !== previous) {
          byId.set(message.id, stabilized)
          changedIds.add(message.id)
        }
        removedIds.delete(message.id)
      }
      for (const removedId of removedIds) {
        byId.delete(removedId)
        changedIds.add(removedId)
      }
      if (orderChanged) order = nextOrder
    }

    for (const [id, message] of upserts) {
      const previous = byId.get(id)
      const stabilized = stabilizeMessage(previous, message)
      if (previous === undefined) {
        byId.set(id, stabilized)
        order = [...order, id]
        orderChanged = true
        changedIds.add(id)
      } else if (stabilized !== previous) {
        byId.set(id, stabilized)
        changedIds.add(id)
      }
    }

    if (changedIds.size === 0 && !orderChanged) return
    messagesCache = null
    if (orderChanged) {
      for (const listener of orderListeners) listener()
    }
    for (const id of changedIds) {
      const listeners = messageListeners.get(id)
      if (!listeners) continue
      for (const listener of listeners) listener()
    }
    for (const listener of changeListeners) listener(changedIds, orderChanged)
  }

  const schedule = (): void => {
    if (disposed || scheduled !== null) return
    if (rafAvailable() && !document.hidden) {
      scheduledKind = 'raf'
      scheduled = requestAnimationFrame(() => {
        scheduled = null
        scheduledKind = null
        commit()
      })
    } else {
      scheduledKind = 'timer'
      scheduled = setTimeout(
        () => {
          scheduled = null
          scheduledKind = null
          commit()
        },
        rafAvailable() ? HIDDEN_PUMP_INTERVAL_MS : 0
      )
    }
  }

  return {
    subscribeOrder(listener) {
      orderListeners.add(listener)
      return () => orderListeners.delete(listener)
    },
    getOrder() {
      return order
    },
    subscribeMessage(id, listener) {
      let listeners = messageListeners.get(id)
      if (!listeners) {
        listeners = new Set()
        messageListeners.set(id, listeners)
      }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) messageListeners.delete(id)
      }
    },
    getMessage(id) {
      return byId.get(id)
    },
    getMessages() {
      if (!messagesCache) {
        messagesCache = order
          .map((id) => byId.get(id))
          .filter((message): message is TanzoUIMessage => message !== undefined)
      }
      return messagesCache
    },
    subscribeChanges(listener) {
      changeListeners.add(listener)
      return () => changeListeners.delete(listener)
    },
    upsert(message) {
      if (pendingReplaceAll) {
        // Fold into the pending replacement so ordering stays deterministic
        // (replaceAll wins over upserts queued before it, not after it).
        const at = pendingReplaceAll.findIndex((existing) => existing.id === message.id)
        if (at === -1) pendingReplaceAll.push(message)
        else pendingReplaceAll[at] = message
      } else {
        pendingUpserts.set(message.id, message)
      }
      schedule()
    },
    replaceAll(messages) {
      pendingReplaceAll = [...messages]
      pendingUpserts.clear()
      schedule()
    },
    flushSync() {
      commit()
    },
    dispose() {
      disposed = true
      cancelScheduled()
      orderListeners.clear()
      messageListeners.clear()
      changeListeners.clear()
    }
  }
}
