import { useEffect, useMemo, useRef, useState } from 'react'
import type { TanzoUIMessage } from '@shared/agent-message'
import type { SubagentApprovalScope } from '@shared/chat'
import type { CodexPetAnimationName, PetAsset, PetPresencePayload } from '@shared/pet'
import { chatClient } from '@/platform/electron/chat-client'
import { petClient } from '@/platform/electron/pet-client'
import { preferencesClient } from '@/platform/electron/preferences-client'
import { ApprovalBubble } from './approval-bubble'
import { PetSprite } from './pet-sprite'
import { QuickInputBubble } from './quick-input-bubble'
import { ReplyBubble } from './reply-bubble'
import { usePetInteraction } from './use-pet-interaction'

const INITIAL_PRESENCE: PetPresencePayload = {
  state: 'idle',
  approval: null,
  activeChatId: null,
  lastReply: null
}

async function resolveTargetChatId(activeChatId: string | null): Promise<string | null> {
  if (activeChatId) return activeChatId
  const conversations = await chatClient.listConversations()
  const existing = conversations[0]
  if (existing) return existing.id
  const created = await chatClient.createConversation()
  return created.id
}

async function sendTextMessage(chatId: string, text: string): Promise<void> {
  const message: TanzoUIMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    parts: [{ type: 'text', text }]
  }
  await chatClient.submit(chatId, message)
}

export function PetApp(): React.JSX.Element | null {
  const [asset, setAsset] = useState<PetAsset | null>(null)
  const [petId, setPetId] = useState<string | null>(null)
  const [petScale, setPetScale] = useState(1)
  const [presence, setPresence] = useState<PetPresencePayload>(INITIAL_PRESENCE)
  const [inputOpen, setInputOpen] = useState(false)
  const [dragAnimation, setDragAnimation] = useState<CodexPetAnimationName | null>(null)
  const [transientAnimation, setTransientAnimation] = useState<CodexPetAnimationName | null>(null)
  const hitRef = useRef<HTMLDivElement>(null)
  const spriteRef = useRef<HTMLDivElement>(null)
  const presenceRef = useRef(presence)
  const submittingRef = useRef(false)

  useEffect(() => {
    presenceRef.current = presence
  }, [presence])

  useEffect(() => {
    let cancelled = false
    void preferencesClient.get().then((prefs) => {
      if (!cancelled) {
        setPetId(prefs.petId)
        setPetScale(prefs.petScale)
      }
    })
    const unsubscribe = preferencesClient.onChanged((prefs) => {
      setPetId(prefs.petId)
      setPetScale(prefs.petScale)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!petId) {
        if (!cancelled) setAsset(null)
        return
      }

      void petClient.get(petId).then((loaded) => {
        if (!cancelled) setAsset(loaded)
      })
    })
    return () => {
      cancelled = true
    }
  }, [petId])

  useEffect(() => {
    return petClient.onPresenceChanged((payload) => setPresence(payload))
  }, [])

  useEffect(() => {
    if (!transientAnimation) return
    const timer = setTimeout(() => setTransientAnimation(null), 900)
    return () => clearTimeout(timer)
  }, [transientAnimation])

  const interactionDeps = useMemo(
    () => ({
      setHitRect: (rect: { x: number; y: number; width: number; height: number } | null) => {
        void petClient.setHitRect(rect)
      },
      setDragging: (value: boolean) => {
        void petClient.setDragging(value)
        if (!value) setDragAnimation(null)
      },
      move: (delta: { dx: number; dy: number }) => {
        if (delta.dx > 0) setDragAnimation('running-right')
        else if (delta.dx < 0) setDragAnimation('running-left')
        void petClient.move(delta)
      },
      onClick: () => {
        setInputOpen((open) => {
          if (open) setTransientAnimation('waving')
          return !open
        })
      },
      onDoubleClick: () => {
        void petClient.focusMain()
      },
      onDragEnd: () => {
        setDragAnimation(null)
        void petClient.persistPosition()
      }
    }),
    []
  )

  usePetInteraction(hitRef, spriteRef, interactionDeps, Boolean(asset))

  if (!asset) return null

  const animationName =
    dragAnimation ??
    (presence.approval || inputOpen
      ? 'waiting'
      : presence.state === 'idle'
        ? (transientAnimation ?? undefined)
        : undefined)

  const submitMessage = (text: string): void => {
    if (submittingRef.current) return
    submittingRef.current = true
    void (async () => {
      try {
        const snapshot = presenceRef.current
        const chatId = await resolveTargetChatId(snapshot.activeChatId)
        if (!chatId) return
        if (snapshot.state === 'idle') {
          await petClient.setActiveChatId(chatId)
          await sendTextMessage(chatId, text)
        } else {
          await chatClient.enqueue(chatId, text)
        }
      } finally {
        submittingRef.current = false
      }
    })()
  }

  const respondApproval = (decision: {
    approved: boolean
    reason?: string
    scope?: SubagentApprovalScope
  }): void => {
    const approval = presenceRef.current.approval
    if (!approval) return
    void chatClient.approveTask(approval.rootChatId, {
      approvalId: approval.approvalId,
      approved: decision.approved,
      ...(decision.reason ? { reason: decision.reason } : {}),
      ...(decision.scope ? { scope: decision.scope } : {})
    })
  }

  const showReply = !inputOpen && presence.state === 'done' && Boolean(presence.lastReply)

  return (
    <div className="pet-stage">
      <div ref={hitRef} className="pet-hit">
        {presence.approval ? (
          <ApprovalBubble approval={presence.approval} onRespond={respondApproval} />
        ) : inputOpen ? (
          <QuickInputBubble onSubmit={submitMessage} onClose={() => setInputOpen(false)} />
        ) : showReply && presence.lastReply ? (
          <ReplyBubble reply={presence.lastReply} onOpen={() => void petClient.focusMain()} />
        ) : null}
        <div ref={spriteRef} className="pet-handle">
          <PetSprite
            asset={asset}
            state={presence.state}
            animationName={animationName}
            scale={petScale}
          />
        </div>
      </div>
    </div>
  )
}
