import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/page-header'
import { useAppShellStore } from '@/app/app-shell-store'
import { getSettingsSection } from './model'

export default function SettingsPage() {
  const { t } = useTranslation()
  const sectionId = useAppShellStore((state) => state.settingsSection)
  const section = getSettingsSection(sectionId)
  const SectionComponent = section.Component
  const SectionHeaderActions = section.HeaderActions
  const sectionLabel = t(section.labelKey, { defaultValue: section.defaultLabel })

  if (section.embedded) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <SectionComponent />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title={sectionLabel}
        {...(SectionHeaderActions ? { actions: <SectionHeaderActions /> } : {})}
      />
      <div className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col px-5 pt-3 pb-6">
          <SectionComponent />
        </div>
      </div>
    </div>
  )
}
