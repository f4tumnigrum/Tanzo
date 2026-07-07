import type { ChannelId } from '@shared/chat-bridge'

export const LARK_CONSOLE_URLS = {
  feishu: 'https://open.feishu.cn/app',
  lark: 'https://open.larksuite.com/app'
} as const

export const CHANNEL_CONSOLE_URLS: Record<ChannelId, string> = {
  qq: 'https://q.qq.com/#/app/bot',
  discord: 'https://discord.com/developers/applications',
  lark: LARK_CONSOLE_URLS.feishu,
  wechat: 'https://openai.weixin.qq.com/'
}

export function channelConsoleUrl(
  channelId: ChannelId,
  options: { larkDomain?: keyof typeof LARK_CONSOLE_URLS } = {}
): string {
  if (channelId === 'lark') {
    return LARK_CONSOLE_URLS[options.larkDomain ?? 'feishu']
  }
  return CHANNEL_CONSOLE_URLS[channelId]
}

export function openChannelConsole(
  channelId: ChannelId,
  options: { larkDomain?: keyof typeof LARK_CONSOLE_URLS } = {}
): void {
  window.open(channelConsoleUrl(channelId, options), '_blank', 'noopener,noreferrer')
}
