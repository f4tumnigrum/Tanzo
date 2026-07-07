import { MessageCircle, Hash, Send, MessagesSquare } from 'lucide-react'
import type { ChannelId } from '@shared/chat-bridge'

export interface ChannelPresentation {
  id: ChannelId

  icon: React.ReactNode

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
