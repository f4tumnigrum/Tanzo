import type { ColorThemeDefinition } from '@/common/theme/types'
import type { ThemeMode } from '@shared/preferences'

interface MockColors {
  bg: string
  sidebar: string
  sidebarAccent: string
  card: string
  border: string
  muted: string
  primary: string
  foreground: string
  accent: string
}

const MODE_COLORS: Record<'light' | 'dark', MockColors> = {
  light: {
    bg: '#f8f8f8',
    sidebar: '#f0f0f0',
    sidebarAccent: '#111111',
    card: '#ffffff',
    border: '#e2e2e2',
    muted: '#d4d4d4',
    primary: '#111111',
    foreground: '#111111',
    accent: '#a3a3a3'
  },
  dark: {
    bg: '#0c0c0c',
    sidebar: '#161616',
    sidebarAccent: '#e0e0e0',
    card: '#1a1a1a',
    border: '#2a2a2a',
    muted: '#3a3a3a',
    primary: '#e0e0e0',
    foreground: '#e0e0e0',
    accent: '#6b6b6b'
  }
}

function AppMockup({ colors }: { colors: MockColors }) {
  const r = '3.5px'
  const rSm = '1.5px'
  const gap = '2px'
  return (
    <div
      className="flex h-full w-full overflow-hidden"
      style={{
        borderRadius: r,
        backgroundColor: colors.bg,
        boxShadow: `inset 0 0 0 0.5px ${colors.border}`
      }}
    >
      <div
        className="flex w-[20%] shrink-0 flex-col py-[3px] pl-[3px] pr-[2px]"
        style={{ backgroundColor: colors.sidebar, gap }}
      >
        <div
          className="h-[3px] w-[80%]"
          style={{ borderRadius: rSm, backgroundColor: colors.sidebarAccent }}
        />
        <div
          className="h-[2.5px] w-[60%] opacity-35"
          style={{ borderRadius: rSm, backgroundColor: colors.sidebarAccent }}
        />
        <div
          className="h-[2.5px] w-[70%] opacity-35"
          style={{ borderRadius: rSm, backgroundColor: colors.sidebarAccent }}
        />
      </div>
      <div
        className="flex flex-1 flex-col p-[3px]"
        style={{ gap, boxShadow: `inset 0.5px 0 0 ${colors.border}` }}
      >
        <div className="flex items-center" style={{ gap }}>
          <div
            className="size-[3px] shrink-0 rounded-full"
            style={{ backgroundColor: colors.accent }}
          />
          <div
            className="h-[3px] w-[40%]"
            style={{ borderRadius: rSm, backgroundColor: colors.foreground }}
          />
        </div>
        <div
          className="flex flex-1 flex-col"
          style={{
            borderRadius: r,
            backgroundColor: colors.card,
            boxShadow: `inset 0 0 0 0.5px ${colors.border}`,
            padding: '3px',
            gap
          }}
        >
          <div
            className="h-[2.5px] w-[70%]"
            style={{ borderRadius: rSm, backgroundColor: colors.muted }}
          />
          <div
            className="h-[2.5px] w-[50%]"
            style={{ borderRadius: rSm, backgroundColor: colors.muted }}
          />
          <div className="mt-auto flex justify-end">
            <div
              className="h-[4px] w-[28%]"
              style={{ borderRadius: '2px', backgroundColor: colors.primary }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export function ModePreview({ mode }: { mode: ThemeMode }) {
  if (mode === 'system') {
    return (
      <div className="grid h-full grid-cols-2 gap-[3px]">
        <AppMockup colors={MODE_COLORS.light} />
        <AppMockup colors={MODE_COLORS.dark} />
      </div>
    )
  }
  return <AppMockup colors={MODE_COLORS[mode]} />
}

export function ColorThemePreview({ theme }: { theme: ColorThemeDefinition }) {
  const { light, dark } = theme
  return (
    <div className="flex h-full w-full items-center gap-[3px]">
      {[light, dark].map((palette, index) => (
        <div
          key={index}
          className="flex flex-1 items-center gap-[4px] self-stretch rounded-[3.5px] px-[4px]"
          style={{
            backgroundColor: palette.background,
            boxShadow: `inset 0 0 0 0.5px ${palette.border}`
          }}
        >
          <div
            className="size-[10px] shrink-0 rounded-full"
            style={{
              backgroundColor: palette.primary,
              boxShadow: `0 0 0 1.5px ${palette.background}, 0 0 0 2px ${palette.accent}`
            }}
          />
          <div className="flex flex-1 flex-col gap-[2.5px]">
            <div
              className="h-[2.5px] w-full rounded-full"
              style={{ backgroundColor: palette.muted }}
            />
            <div
              className="h-[2.5px] w-[55%] rounded-full"
              style={{ backgroundColor: palette.accent }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
