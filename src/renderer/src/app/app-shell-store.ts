import { create } from 'zustand'
import { DEFAULT_SETTINGS_SECTION, type SettingsSectionId } from '@/features/settings/model'

interface AppShellState {
  settingsSection: SettingsSectionId
  setSettingsSection: (section: SettingsSectionId) => void
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
}

export const useAppShellStore = create<AppShellState>()((set) => ({
  settingsSection: DEFAULT_SETTINGS_SECTION,
  setSettingsSection: (section) =>
    set((state) => (state.settingsSection === section ? state : { settingsSection: section })),
  sidebarCollapsed: false,
  setSidebarCollapsed: (collapsed) =>
    set((state) =>
      state.sidebarCollapsed === collapsed ? state : { sidebarCollapsed: collapsed }
    ),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }))
}))
