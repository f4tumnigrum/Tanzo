export const PET_CHANNELS = {
  list: 'pet:list',
  get: 'pet:get',
  presenceChanged: 'pet:presence-changed',
  setHitRect: 'pet:set-hit-rect',
  setDragging: 'pet:set-dragging',
  setActiveChatId: 'pet:set-active-chat-id',
  focusMain: 'pet:focus-main',
  move: 'pet:move',
  persistPosition: 'pet:persist-position'
} as const

export type PetChannel = (typeof PET_CHANNELS)[keyof typeof PET_CHANNELS]

export type PetPresenceState =
  'idle' | 'thinking' | 'running-tool' | 'waiting-approval' | 'review' | 'done' | 'error'

export const PET_PRESENCE_STATES: readonly PetPresenceState[] = [
  'idle',
  'thinking',
  'running-tool',
  'waiting-approval',
  'review',
  'done',
  'error'
]

export type CodexPetAnimationName =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review'

export interface CodexPetAtlas {
  columns: number
  rows: number
  cellWidth: number
  cellHeight: number
  sheetWidth: number
  sheetHeight: number
}

export const CODEX_PET_ATLAS: CodexPetAtlas = {
  columns: 8,
  rows: 9,
  cellWidth: 192,
  cellHeight: 208,
  sheetWidth: 1536,
  sheetHeight: 1872
}

export interface CodexPetAnimation {
  row: number
  durationsMs: readonly number[]
}

export const CODEX_PET_ANIMATIONS = {
  idle: { row: 0, durationsMs: [280, 110, 110, 140, 140, 320] },
  'running-right': { row: 1, durationsMs: [120, 120, 120, 120, 120, 120, 120, 220] },
  'running-left': { row: 2, durationsMs: [120, 120, 120, 120, 120, 120, 120, 220] },
  waving: { row: 3, durationsMs: [140, 140, 140, 280] },
  jumping: { row: 4, durationsMs: [140, 140, 140, 140, 280] },
  failed: { row: 5, durationsMs: [140, 140, 140, 140, 140, 140, 140, 240] },
  waiting: { row: 6, durationsMs: [150, 150, 150, 150, 150, 260] },
  running: { row: 7, durationsMs: [120, 120, 120, 120, 120, 220] },
  review: { row: 8, durationsMs: [150, 150, 150, 150, 150, 280] }
} satisfies Record<CodexPetAnimationName, CodexPetAnimation>

export const PET_STATE_ANIMATION_MAP = {
  idle: 'idle',
  thinking: 'running',
  'running-tool': 'running',
  'waiting-approval': 'waiting',
  review: 'review',
  done: 'jumping',
  error: 'failed'
} satisfies Record<PetPresenceState, CodexPetAnimationName>

export interface CodexPetManifest {
  id: string
  displayName: string
  description: string
  spritesheetPath: 'spritesheet.webp'
}

export interface PetSummary {
  id: string
  displayName: string
  description: string
}

export interface PetAsset {
  manifest: CodexPetManifest
  spritesheetDataUrl: string
}

export interface PetApprovalRef {
  rootChatId: string
  approvalId: string
  toolName: string
}

export interface PetReplyRef {
  text: string
  chatId: string
  at: number
}

export interface PetPresencePayload {
  state: PetPresenceState
  approval: PetApprovalRef | null
  activeChatId: string | null
  lastReply: PetReplyRef | null
}

export interface PetMoveDelta {
  dx: number
  dy: number
}

export interface PetHitRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PetPosition {
  x: number
  y: number
}

export interface PetApi {
  list(): Promise<PetSummary[]>
  get(id: string): Promise<PetAsset | null>
  onPresenceChanged(callback: (payload: PetPresencePayload) => void): () => void
  setHitRect(rect: PetHitRect | null): Promise<void>
  setDragging(dragging: boolean): Promise<void>
  setActiveChatId(chatId: string | null): Promise<void>
  focusMain(): Promise<void>
  move(delta: PetMoveDelta): Promise<void>
  persistPosition(): Promise<void>
}
