import { useEffect, useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { HashRouter, matchPath, Route, Routes, useLocation } from 'react-router-dom'
import { APP_ROUTES } from '@/app/route-registry'
import { AppShell } from '@/app/app-shell'
import { ThemeProvider } from '@/components/theme/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { WallpaperLayer } from '@/components/wallpaper-layer'
import { McpElicitationHost } from '@/features/mcp/ui/elicitation/mcp-elicitation-host'
import { useSystemPreferences } from '@/hooks/use-system-preferences'
import { initializeI18n } from '@/i18n'
import { bootstrapPreferences, usePreferences, usePreferencesReady } from '@/common/preferences'
import { queryClient } from '@/common/query-client'

function App() {
  const systemPreferences = useSystemPreferences()
  const preferencesReady = usePreferencesReady()
  const [i18nReady, setI18nReady] = useState(false)

  useEffect(() => {
    void bootstrapPreferences()
  }, [])

  useEffect(() => {
    if (!systemPreferences || !preferencesReady) return
    let cancelled = false
    void initializeI18n(systemPreferences).then(() => {
      if (!cancelled) setI18nReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [systemPreferences, preferencesReady])

  if (!systemPreferences || !preferencesReady || !i18nReady) return null

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider initialSystemColorScheme={systemPreferences.colorScheme}>
        <I18nLanguageSync />
        <WallpaperLayer />
        <HashRouter>
          <div data-slot="sidebar-wrapper" className="relative flex h-svh w-full">
            <AppShell>
              <AppRoutes />
            </AppShell>
            <McpElicitationHost />
            <Toaster />
          </div>
        </HashRouter>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

function AppRoutes() {
  const { pathname } = useLocation()
  const keepAliveRoutes = APP_ROUTES.filter((route) => route.keepAlive)
  const regularRoutes = APP_ROUTES.filter((route) => !route.keepAlive)
  const activeKeepAliveRoute = keepAliveRoutes.some((route) =>
    matchPath({ path: route.path, end: true }, pathname)
  )

  return (
    <>
      {keepAliveRoutes.map(({ path, Component }) => {
        const active = Boolean(matchPath({ path, end: true }, pathname))

        return (
          <div
            key={path}
            className={active ? 'h-full min-h-0 flex-1' : 'hidden'}
            aria-hidden={!active}
          >
            <Component />
          </div>
        )
      })}
      {!activeKeepAliveRoute ? (
        <Routes>
          {regularRoutes.map(({ path, Component }) => (
            <Route key={path} path={path} element={<Component />} />
          ))}
        </Routes>
      ) : null}
    </>
  )
}

function I18nLanguageSync() {
  const { i18n } = useTranslation()
  const language = usePreferences().language

  useEffect(() => {
    if (!language) return
    if (i18n.language !== language) void i18n.changeLanguage(language)
  }, [i18n, language])

  return null
}

export default App
