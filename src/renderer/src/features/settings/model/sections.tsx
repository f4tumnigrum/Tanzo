import type { ComponentType } from 'react'
import {
  BarChart3,
  Blocks,
  Cat,
  Palette,
  Plug,
  Server,
  ShieldCheck,
  Sparkles,
  Webhook,
  Wrench
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import McpPage from '@/features/mcp/page'
import PluginsPage from '@/features/plugins/page'
import ProvidersPage from '@/features/providers/page'
import SkillsPage from '@/features/skills/page'
import UsagePage from '@/features/usage/page'
import { SettingsHooksTab, SettingsHooksHeaderActions } from '../ui/settings-hooks-tab'
import { SettingsPermissionsTab } from '../ui/settings-permissions-tab'
import { SettingsPetTab } from '../ui/settings-pet-tab'
import { SettingsThemeTab } from '../ui/settings-theme-tab'
import { SettingsToolsTab } from '../ui/settings-tools-tab'

export type SettingsSectionId =
  | 'theme'
  | 'skills'
  | 'plugins'
  | 'providers'
  | 'mcp'
  | 'usage'
  | 'permissions'
  | 'hooks'
  | 'pet'
  | 'tools'

export interface SettingsSectionDef {
  id: SettingsSectionId
  labelKey: string
  defaultLabel: string
  icon: LucideIcon
  Component: ComponentType
  embedded?: boolean
  HeaderActions?: ComponentType
}

export const SETTINGS_SECTIONS: readonly SettingsSectionDef[] = [
  {
    id: 'theme',
    labelKey: 'settings.page.tabs.theme',
    defaultLabel: 'Theme',
    icon: Palette,
    Component: SettingsThemeTab
  },
  {
    id: 'skills',
    labelKey: 'nav.items.skills',
    defaultLabel: 'Skills',
    icon: Sparkles,
    Component: SkillsPage,
    embedded: true
  },
  {
    id: 'plugins',
    labelKey: 'nav.items.plugins',
    defaultLabel: 'Plugins',
    icon: Blocks,
    Component: PluginsPage,
    embedded: true
  },
  {
    id: 'providers',
    labelKey: 'nav.items.providers',
    defaultLabel: 'Providers',
    icon: Plug,
    Component: ProvidersPage,
    embedded: true
  },
  {
    id: 'mcp',
    labelKey: 'nav.items.mcp',
    defaultLabel: 'MCP',
    icon: Server,
    Component: McpPage,
    embedded: true
  },
  {
    id: 'usage',
    labelKey: 'nav.items.usage',
    defaultLabel: 'Usage',
    icon: BarChart3,
    Component: UsagePage,
    embedded: true
  },
  {
    id: 'permissions',
    labelKey: 'settings.page.tabs.permissions',
    defaultLabel: 'Permissions',
    icon: ShieldCheck,
    Component: SettingsPermissionsTab
  },
  {
    id: 'hooks',
    labelKey: 'settings.page.tabs.hooks',
    defaultLabel: 'Hooks',
    icon: Webhook,
    Component: SettingsHooksTab,
    HeaderActions: SettingsHooksHeaderActions
  },
  {
    id: 'pet',
    labelKey: 'settings.page.tabs.pet',
    defaultLabel: 'Pet',
    icon: Cat,
    Component: SettingsPetTab
  },
  {
    id: 'tools',
    labelKey: 'settings.page.tabs.tools',
    defaultLabel: 'Tools',
    icon: Wrench,
    Component: SettingsToolsTab
  }
]

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'theme'

export function getSettingsSection(id: SettingsSectionId): SettingsSectionDef {
  return SETTINGS_SECTIONS.find((section) => section.id === id) ?? SETTINGS_SECTIONS[0]
}
