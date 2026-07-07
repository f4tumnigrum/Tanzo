import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { isThreadAllowed } from '@main/chat-bridge/bridge'

const empty = { groups: [], users: [] }
const larkThread = (chatId: string, threadId?: string): string => {
  const base = `lark:${b64url(chatId)}`
  return threadId ? `${base}:${b64url(threadId)}` : base
}
const b64url = (value: string): string =>
  Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '')

describe('isThreadAllowed - deny-by-default', () => {
  it('denies every channel when the allowlist is empty', () => {
    expect(isThreadAllowed('qq', 'qq:group:g1', 'u1', empty)).toBe(false)
    expect(isThreadAllowed('qq', 'qq:c2c:u1', 'u1', empty)).toBe(false)
    expect(isThreadAllowed('discord', 'discord:guild1:chan1', 'u1', empty)).toBe(false)
    expect(isThreadAllowed('discord', 'discord:@me:dmchan1', 'u1', empty)).toBe(false)
    expect(isThreadAllowed('lark', larkThread('oc_1'), 'u1', empty)).toBe(false)
    expect(isThreadAllowed('wechat', 'wechat:dm:openid1', 'openid1', empty)).toBe(false)
  })

  it('denies an unrecognised thread id', () => {
    expect(isThreadAllowed('qq', 'not-a-qq-thread', 'u1', { groups: ['x'], users: ['u1'] })).toBe(
      false
    )
    expect(isThreadAllowed('discord', 'discord:', 'u1', { groups: ['x'], users: ['u1'] })).toBe(
      false
    )
    expect(
      isThreadAllowed('lark', 'lark:not-base64url!', 'u1', { groups: ['x'], users: ['u1'] })
    ).toBe(false)
    expect(
      isThreadAllowed('wechat', 'wechat:openid1', 'openid1', { groups: [], users: ['openid1'] })
    ).toBe(false)
  })

  it('denies when the author is missing (empty string) in a private chat', () => {
    // Adapters that omit author leave authorUserId=''; must never match a real allowlist.
    expect(isThreadAllowed('qq', 'qq:c2c:u1', '', { groups: [], users: ['u1'] })).toBe(false)
    expect(isThreadAllowed('wechat', 'wechat:dm:u1', '', { groups: [], users: ['u1'] })).toBe(false)
    expect(
      isThreadAllowed('discord', 'discord:@me:dmchan1', '', { groups: [], users: ['u1'] })
    ).toBe(false)
  })
})

describe('isThreadAllowed - QQ', () => {
  it('allows an allow-listed group; ignores sender when user list empty', () => {
    expect(isThreadAllowed('qq', 'qq:group:g1', 'anyone', { groups: ['g1'], users: [] })).toBe(true)
    expect(isThreadAllowed('qq', 'qq:channel:c1', 'anyone', { groups: ['c1'], users: [] })).toBe(
      true
    )
  })

  it('requires the sender too when a user list exists (defence in depth)', () => {
    expect(isThreadAllowed('qq', 'qq:group:g1', 'u1', { groups: ['g1'], users: ['u1'] })).toBe(true)
    expect(isThreadAllowed('qq', 'qq:group:g1', 'evil', { groups: ['g1'], users: ['u1'] })).toBe(
      false
    )
  })

  it('binds c2c private chat to the authenticated sender, not the thread peer', () => {
    // Thread encodes u1, but the authenticated author is evil -> deny.
    expect(isThreadAllowed('qq', 'qq:c2c:u1', 'evil', { groups: [], users: ['u1'] })).toBe(false)
    expect(isThreadAllowed('qq', 'qq:c2c:u1', 'u1', { groups: [], users: ['u1'] })).toBe(true)
  })

  it('allows guild-dm purely on the authenticated sender', () => {
    expect(isThreadAllowed('qq', 'qq:guild-dm:g9', 'u1', { groups: [], users: ['u1'] })).toBe(true)
    expect(isThreadAllowed('qq', 'qq:guild-dm:g9', 'evil', { groups: [], users: ['u1'] })).toBe(
      false
    )
  })
})

describe('isThreadAllowed - Discord', () => {
  it('gates guild messages on the guild id', () => {
    expect(
      isThreadAllowed('discord', 'discord:guild1:chan1', 'u1', { groups: ['guild1'], users: [] })
    ).toBe(true)
    expect(
      isThreadAllowed('discord', 'discord:guild1:chan1:thread1', 'u1', {
        groups: ['guild1'],
        users: []
      })
    ).toBe(true)
    expect(
      isThreadAllowed('discord', 'discord:guild2:chan1', 'u1', { groups: ['guild1'], users: [] })
    ).toBe(false)
  })

  it('gates DMs on the authenticated sender because the thread id only contains the DM channel id', () => {
    expect(
      isThreadAllowed('discord', 'discord:@me:dmchan1', 'u1', { groups: [], users: ['u1'] })
    ).toBe(true)
    expect(
      isThreadAllowed('discord', 'discord:@me:dmchan1', 'evil', { groups: [], users: ['u1'] })
    ).toBe(false)
    expect(
      isThreadAllowed('discord', 'discord:@me:dmchan1', 'u1', { groups: ['@me'], users: [] })
    ).toBe(false)
  })
})

describe('isThreadAllowed - Lark', () => {
  it('allows when the decoded chat id is an allow-listed group', () => {
    expect(isThreadAllowed('lark', larkThread('oc_1'), 'u1', { groups: ['oc_1'], users: [] })).toBe(
      true
    )
    expect(
      isThreadAllowed('lark', larkThread('oc_1', 'omt_1'), 'u1', { groups: ['oc_1'], users: [] })
    ).toBe(true)
  })

  it('allows when the sender is an allow-listed user (covers p2p)', () => {
    expect(isThreadAllowed('lark', larkThread('oc_x'), 'u1', { groups: [], users: ['u1'] })).toBe(
      true
    )
  })

  it('requires the sender too when a group chat is allow-listed and users are restricted', () => {
    expect(
      isThreadAllowed('lark', larkThread('oc_1'), 'u1', { groups: ['oc_1'], users: ['u1'] })
    ).toBe(true)
    expect(
      isThreadAllowed('lark', larkThread('oc_1'), 'evil', { groups: ['oc_1'], users: ['u1'] })
    ).toBe(false)
  })

  it('denies when neither the decoded chat id nor the sender is listed', () => {
    expect(
      isThreadAllowed('lark', larkThread('oc_x'), 'u9', { groups: ['oc_1'], users: ['u1'] })
    ).toBe(false)
  })
})

describe('isThreadAllowed - WeChat', () => {
  it('binds the 1:1 chat to the authenticated sender', () => {
    expect(
      isThreadAllowed('wechat', 'wechat:dm:openid1', 'openid1', { groups: [], users: ['openid1'] })
    ).toBe(true)
    expect(
      isThreadAllowed('wechat', 'wechat:dm:openid1', 'evil', { groups: [], users: ['openid1'] })
    ).toBe(false)
  })

  it('allows an allow-listed group and optionally gates on sender id', () => {
    expect(
      isThreadAllowed('wechat', 'wechat:group:group1', 'openid1', { groups: ['group1'], users: [] })
    ).toBe(true)
    expect(
      isThreadAllowed('wechat', 'wechat:group:group1:ctx', 'openid1', {
        groups: ['group1'],
        users: ['openid1']
      })
    ).toBe(true)
    expect(
      isThreadAllowed('wechat', 'wechat:group:group1', 'evil', {
        groups: ['group1'],
        users: ['openid1']
      })
    ).toBe(false)
  })
})
