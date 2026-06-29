import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface PluginDetailStore {
  selectedPluginId: string | null
  setSelectedPluginId: (id: string | null) => void
}

export const usePluginDetailStore = create<PluginDetailStore>()(
  devtools(
    (set) => ({
      selectedPluginId: null,
      setSelectedPluginId: (id) =>
        set((state) => (state.selectedPluginId === id ? state : { selectedPluginId: id }))
    }),
    { name: 'plugin-detail-store' }
  )
)
