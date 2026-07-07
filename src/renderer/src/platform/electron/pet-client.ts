import type {
  PetApi,
  PetAsset,
  PetHitRect,
  PetMoveDelta,
  PetPresencePayload,
  PetSummary
} from '@shared/pet'
import { TanzoIntegrationError } from '@shared/errors'
import { withDecodedIpcErrors } from './ipc-errors'

function requirePetApi(): PetApi {
  const petApi = window.electron?.pet
  if (!petApi) {
    throw new TanzoIntegrationError(
      'ELECTRON_PET_API_UNAVAILABLE',
      'Electron pet API is not available'
    )
  }
  return withDecodedIpcErrors(petApi)
}

export function isPetApiAvailable(): boolean {
  return Boolean(window.electron?.pet)
}

export const petClient = {
  list(): Promise<PetSummary[]> {
    return requirePetApi().list()
  },
  get(id: string): Promise<PetAsset | null> {
    return requirePetApi().get(id)
  },
  setHitRect(rect: PetHitRect | null): Promise<void> {
    return requirePetApi().setHitRect(rect)
  },
  setDragging(dragging: boolean): Promise<void> {
    return requirePetApi().setDragging(dragging)
  },
  setActiveChatId(chatId: string | null): Promise<void> {
    return requirePetApi().setActiveChatId(chatId)
  },
  focusMain(): Promise<void> {
    return requirePetApi().focusMain()
  },
  move(delta: PetMoveDelta): Promise<void> {
    return requirePetApi().move(delta)
  },
  persistPosition(): Promise<void> {
    return requirePetApi().persistPosition()
  },
  onPresenceChanged(callback: (payload: PetPresencePayload) => void): () => void {
    return requirePetApi().onPresenceChanged(callback)
  }
}
