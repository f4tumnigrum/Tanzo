import { MessageCircle, Hash, Send, MessagesSquare } from 'lucide-react'
import type { ChannelId } from '@shared/chat-bridge'

/**
 * Presentation metadata for each channel. There is no brand-logo registry in the app, so we
 * use distinct lucide glyphs (net-new, per the provider pattern which is also icon-driven).
 */
export interface ChannelPresentation {
  id: ChannelId
  /** i18n key for the display name (with a sensible English defaultValue at call sites). */
  icon: React.ReactNode
  /** Accent classes for the card/detail icon chip. */
  accent: string
}

export const CHANNEL_PRESENTATION: Record<ChannelId, ChannelPresentation> = {
  qq: {
    id: 'qq',
    icon: <MessageCircle className="size-3.5" />,
    accent: 'bg-sky-500/12 text-sky-600'
  },
  discord: {
    id: 'discord',
    icon: <MessagesSquare className="size-3.5" />,
    accent: 'bg-indigo-500/12 text-indigo-600'
  },
  lark: {
    id: 'lark',
    icon: <Hash className="size-3.5" />,
    accent: 'bg-teal-500/12 text-teal-600'
  },
  wechat: {
    id: 'wechat',
    icon: <Send className="size-3.5" />,
    accent: 'bg-emerald-500/12 text-emerald-600'
  }
}
