import { ExternalLink } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { EntityDetailScaffold } from '@/components/layout/page-scaffold'
import { PillTabsBar, PillTabsTrigger } from '@/components/layout/pill-tabs'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import type { ModelFamily, ProviderId } from '@/common/contracts'
import { useProviderDetailStore, useProviderWorkspace } from '../../model'
import { providerFamilyTab, sortedFamilies } from '../../lib/provider-utils'
import { CredentialsPanel } from './credentials-panel'
import { ProviderFamilyPanel } from './provider-family-panel'

interface ProviderDetailViewProps {
  providerId: ProviderId
}

type ProviderTabKey = 'api' | `family:${ModelFamily}`

export function ProviderDetailView({ providerId }: ProviderDetailViewProps) {
  const { t } = useTranslation()
  const activeTab = useProviderDetailStore((state) => state.activeTab as ProviderTabKey)
  const setActiveTab = useProviderDetailStore((state) => state.setActiveTab)
  const setSelectedProviderId = useProviderDetailStore((state) => state.setSelectedProviderId)
  const workspaceQuery = useProviderWorkspace(providerId)
  const workspace = workspaceQuery.data
  const provider = workspace?.provider
  const supportedFamilies = useMemo(() => {
    if (!provider) return [] as ModelFamily[]
    return workspace?.setup.supportedFamilies ?? sortedFamilies(provider)
  }, [provider, workspace?.setup.supportedFamilies])
  const resolvedActiveTab: ProviderTabKey =
    activeTab === 'api' ||
    supportedFamilies.some((family) => providerFamilyTab(family) === activeTab)
      ? activeTab
      : 'api'

  if (!provider && workspaceQuery.isPending) {
    return (
      <EntityDetailScaffold
        title={t('providers.page.title')}
        onBack={() => setSelectedProviderId(null)}
      >
        <div className="mx-auto flex w-full max-w-4xl items-center justify-center rounded-[var(--radius-2xl)] border border-border/50 bg-background/95 px-4 py-12 text-[0.75rem] text-muted-foreground shadow-sm">
          {t('providers.page.loading.detail')}
        </div>
      </EntityDetailScaffold>
    )
  }

  if (!provider || !workspace) {
    return (
      <EntityDetailScaffold
        title={t('providers.page.errors.notFoundTitle')}
        onBack={() => setSelectedProviderId(null)}
      >
        <div className="mx-auto flex w-full max-w-4xl items-center justify-center rounded-[var(--radius-2xl)] border border-destructive/30 bg-destructive/5 px-4 py-12 text-[0.75rem] text-destructive shadow-sm">
          {t('providers.page.errors.notFound')}
        </div>
      </EntityDetailScaffold>
    )
  }

  return (
    <EntityDetailScaffold
      title={provider.name}
      onBack={() => setSelectedProviderId(null)}
      actions={
        <Button
          type="button"
          variant="toolbar"
          size="toolbar"
          onClick={() => window.open(provider.docsUrl, '_blank', 'noopener,noreferrer')}
        >
          <span>{t('providers.page.actions.docs')}</span>
          <ExternalLink className="size-3" />
        </Button>
      }
    >
      <Tabs
        value={resolvedActiveTab}
        onValueChange={(value) => value && setActiveTab(value as ProviderTabKey)}
        className="flex flex-1 flex-col items-center"
      >
        <PillTabsBar>
          <PillTabsTrigger value="api">{t('providers.page.tabs.api')}</PillTabsTrigger>
          {supportedFamilies.map((family) => (
            <PillTabsTrigger key={family} value={providerFamilyTab(family)}>
              {t(`providers.family.labels.${family}`)}
            </PillTabsTrigger>
          ))}
        </PillTabsBar>

        <TabsContent value="api" keepMounted className="mt-3 w-full data-[state=inactive]:hidden">
          <CredentialsPanel workspace={workspace} />
        </TabsContent>

        {supportedFamilies.map((family) => (
          <TabsContent
            key={family}
            value={providerFamilyTab(family)}
            keepMounted
            className="mt-3 w-full data-[state=inactive]:hidden"
          >
            <ProviderFamilyPanel providerId={providerId} family={family} workspace={workspace} />
          </TabsContent>
        ))}
      </Tabs>
    </EntityDetailScaffold>
  )
}
