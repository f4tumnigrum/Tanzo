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
  Webhook
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { EmbeddedScaffoldProvider } from '@/components/layout/page-scaffold'
import McpPage from '@/features/mcp/page'
import PluginsPage from '@/features/plugins/page'
import ProvidersPage from '@/features/providers/page'
import SkillsPage from '@/features/skills/page'
import UsagePage from '@/features/usage/page'
import { SettingsHooksTab, SettingsHooksHeaderActions } from '../ui/settings-hooks-tab'
import { SettingsPermissionsTab } from '../ui/settings-permissions-tab'
import { SettingsPetTab } from '../ui/settings-pet-tab'
import { SettingsThemeTab } from '../ui/settings-theme-tab'

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

export interface SettingsSectionDef {
  id: SettingsSectionId
  labelKey: string
  defaultLabel: string
  icon: LucideIcon
  Component: ComponentType
  embedded?: boolean
  HeaderActions?: ComponentType
}

function embed(Page: ComponentType): ComponentType {
  return function EmbeddedPage() {
    return (
      <EmbeddedScaffoldProvider>
        <Page />
      </EmbeddedScaffoldProvider>
    )
  }
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
    Component: embed(SkillsPage),
    embedded: true
  },
  {
    id: 'plugins',
    labelKey: 'nav.items.plugins',
    defaultLabel: 'Plugins',
    icon: Blocks,
    Component: embed(PluginsPage),
    embedded: true
  },
  {
    id: 'providers',
    labelKey: 'nav.items.providers',
    defaultLabel: 'Providers',
    icon: Plug,
    Component: embed(ProvidersPage),
    embedded: true
  },
  {
    id: 'mcp',
    labelKey: 'nav.items.mcp',
    defaultLabel: 'MCP',
    icon: Server,
    Component: embed(McpPage),
    embedded: true
  },
  {
    id: 'usage',
    labelKey: 'nav.items.usage',
    defaultLabel: 'Usage',
    icon: BarChart3,
    Component: embed(UsagePage),
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
  }
]

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'theme'

export function getSettingsSection(id: SettingsSectionId): SettingsSectionDef {
  return SETTINGS_SECTIONS.find((section) => section.id === id) ?? SETTINGS_SECTIONS[0]
}
