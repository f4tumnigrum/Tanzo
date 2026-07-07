import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { ChannelId } from '@shared/chat-bridge'

interface ChannelDetailStore {
  selectedChannelId: ChannelId | null
  setSelectedChannelId: (channelId: ChannelId | null) => void
}

/**
 * Selection state for the channels list→detail flow. Mirrors `useProviderDetailStore`: a
 * single store field drives the panel swap; no routing involved.
 */
export const useChannelDetailStore = create<ChannelDetailStore>()(
  devtools(
    (set) => ({
      selectedChannelId: null,
      setSelectedChannelId: (channelId) =>
        set((state) =>
          state.selectedChannelId === channelId ? state : { selectedChannelId: channelId }
        )
    }),
    { name: 'channel-detail-store' }
  )
)
