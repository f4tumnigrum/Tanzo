import { describe, expect, it } from 'vitest'
import { toMcpServerConfig } from '@main/agent/plugins/adapters'
import type { PluginMcpServer } from '@main/agent/plugins/loader'

describe('main/agent/plugins/adapters', () => {
  it('maps a stdio plugin server to a Tanzo McpServerConfig', () => {
    const server: PluginMcpServer = {
      name: 'shadcn',
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'shadcn@latest', 'mcp'],
      env: { TOKEN: 'x' },
      cwd: '/plugins/demo'
    }
    expect(toMcpServerConfig(server)).toEqual({
      name: 'shadcn',
      transport: 'stdio',
      enabled: true,
      command: 'npx',
      args: ['-y', 'shadcn@latest', 'mcp'],
      cwd: '/plugins/demo',
      env: { TOKEN: 'x' }
    })
  })

  it('maps Codex streamable_http transport to Tanzo http', () => {
    const server: PluginMcpServer = {
      name: 'remote',
      type: 'streamable_http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer x' }
    }
    const config = toMcpServerConfig(server)
    expect(config.transport).toBe('http')
    expect(config.url).toBe('https://example.com/mcp')
    expect(config.headers).toEqual({ Authorization: 'Bearer x' })
    expect(config.enabled).toBe(true)
  })

  it('maps the streamable-http hyphen spelling to http', () => {
    expect(
      toMcpServerConfig({ name: 's', type: 'streamable-http', url: 'https://x' }).transport
    ).toBe('http')
  })

  it('infers http transport from a url when type is absent', () => {
    expect(toMcpServerConfig({ name: 's', url: 'https://x' }).transport).toBe('http')
  })

  it('infers stdio transport when neither type nor url is present', () => {
    expect(toMcpServerConfig({ name: 's', command: 'run' }).transport).toBe('stdio')
  })

  it('never carries an id, so plugin servers cannot collide with db rows', () => {
    expect(toMcpServerConfig({ name: 's', command: 'run' })).not.toHaveProperty('id')
  })

  it('omits optional fields that were not provided', () => {
    const config = toMcpServerConfig({ name: 'bare', command: 'run' })
    expect(config).toEqual({ name: 'bare', transport: 'stdio', enabled: true, command: 'run' })
  })
})
