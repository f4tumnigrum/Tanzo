import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { TanzoUIMessage } from '@shared/agent-message'
import {
  getChatSession,
  type ChatSession,
  type RunState,
  type SidecarState
} from './session-manager'

export function useChatSession(chatId: string): ChatSession {
  const session = getChatSession(chatId)
  useEffect(() => session.retain(), [session])
  return session
}

export function useMessageOrder(session: ChatSession): readonly string[] {
  return useSyncExternalStore(session.transcript.subscribeOrder, session.transcript.getOrder)
}

export function useMessage(session: ChatSession, id: string): TanzoUIMessage | undefined {
  const subscribe = useCallback(
    (listener: () => void) => session.transcript.subscribeMessage(id, listener),
    [session, id]
  )
  const getSnapshot = useCallback(() => session.transcript.getMessage(id), [session, id])
  return useSyncExternalStore(subscribe, getSnapshot)
}

export function useRunState(session: ChatSession): RunState {
  return useSyncExternalStore(session.runState.subscribe, session.runState.getState)
}

export function useSidecarState(session: ChatSession): SidecarState {
  return useSyncExternalStore(session.sidecar.subscribe, session.sidecar.getState)
}

export function useTranscriptSelector<T>(
  session: ChatSession,
  select: (messages: readonly TanzoUIMessage[]) => T,
  isEqual: (previous: T, next: T) => boolean
): T {
  const cacheRef = useRef<{
    messages: readonly TanzoUIMessage[]
    value: T
  } | null>(null)

  const getSnapshot = useCallback((): T => {
    const messages = session.transcript.getMessages()
    const cached = cacheRef.current
    if (cached && cached.messages === messages) return cached.value
    const next = select(messages)
    const value = cached && isEqual(cached.value, next) ? cached.value : next
    cacheRef.current = { messages, value }
    return value
    // select/isEqual are treated as stable per call site (module-level fns).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  const subscribe = useCallback(
    (listener: () => void) => session.transcript.subscribeChanges(listener),
    [session]
  )

  return useSyncExternalStore(subscribe, getSnapshot)
}
