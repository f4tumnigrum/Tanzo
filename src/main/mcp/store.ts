import { randomUUID } from 'crypto'
import { z } from 'zod'
import type { McpServerConfig, NewMcpServerInput } from '@shared/mcp'
import { TanzoValidationError } from '@shared/errors'
import type { SqlDatabase } from '../database/types'
import { createLogger } from '../logger'

const log = createLogger('mcp-store')

export interface McpStore {
  getAll(): McpServerConfig[]
  create(input: NewMcpServerInput): McpServerConfig
  update(id: string, partial: Partial<McpServerConfig>): McpServerConfig | undefined
  delete(id: string): boolean
  toggle(id: string, enabled: boolean): McpServerConfig | undefined
}

const serverSchema: z.ZodType<McpServerConfig> = z.object({
  id: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  transport: z.enum(['stdio', 'sse', 'http']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  redirect: z.enum(['follow', 'error']).optional(),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean(),
  created_at: z.string().optional(),
  updated_at: z.string().optional()
})

interface McpServerRow {
  id: string
  name: string
  description: string | null
  transport: string
  command: string | null
  args_json: string | null
  cwd: string | null
  url: string | null
  headers_json: string | null
  redirect: string | null
  env_json: string | null
  enabled: number
  created_at: number
  updated_at: number
}

function cloneServer(server: McpServerConfig): McpServerConfig {
  return {
    ...server,
    ...(server.args ? { args: [...server.args] } : {}),
    ...(server.headers ? { headers: { ...server.headers } } : {}),
    ...(server.env ? { env: { ...server.env } } : {})
  }
}

function parseJsonField<T>(
  value: string | null,
  schema: z.ZodType<T>,
  field: string
): T | undefined {
  if (!value) return undefined
  try {
    const parsed = schema.safeParse(JSON.parse(value))
    if (parsed.success) return parsed.data
    log.warn(`invalid MCP server ${field} payload`, parsed.error)
    return undefined
  } catch (error) {
    log.warn(`failed to parse MCP server ${field} payload`, error)
    return undefined
  }
}

function stringifyJsonField(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value)
}

function fromTimestamp(value: number | null | undefined): string | undefined {
  return value == null ? undefined : new Date(value).toISOString()
}

function toTimestamp(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new TanzoValidationError(
      'MCP_SERVER_TIMESTAMP_INVALID',
      `MCP server timestamp is not a valid date: ${value}`,
      { details: { value } }
    )
  }
  return parsed
}

function rowToServer(row: McpServerRow): McpServerConfig | undefined {
  const args = parseJsonField(row.args_json, z.array(z.string()), 'args')
  const headers = parseJsonField(row.headers_json, z.record(z.string(), z.string()), 'headers')
  const env = parseJsonField(row.env_json, z.record(z.string(), z.string()), 'env')

  const parsed = serverSchema.safeParse({
    id: row.id,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    transport: row.transport,
    ...(row.command ? { command: row.command } : {}),
    ...(args ? { args } : {}),
    ...(row.cwd ? { cwd: row.cwd } : {}),
    ...(row.url ? { url: row.url } : {}),
    ...(headers ? { headers } : {}),
    ...(row.redirect ? { redirect: row.redirect } : {}),
    ...(env ? { env } : {}),
    enabled: row.enabled === 1,
    ...(fromTimestamp(row.created_at) ? { created_at: fromTimestamp(row.created_at) } : {}),
    ...(fromTimestamp(row.updated_at) ? { updated_at: fromTimestamp(row.updated_at) } : {})
  })
  return parsed.success ? sanitizeServerForTransport(parsed.data) : undefined
}

function assertValidServer(input: NewMcpServerInput | McpServerConfig): void {
  const name = input.name.trim()
  if (!name) {
    throw new TanzoValidationError('MCP_SERVER_NAME_REQUIRED', 'MCP server name is required.')
  }
  if (input.transport === 'stdio' && !input.command?.trim()) {
    throw new TanzoValidationError(
      'MCP_STDIO_COMMAND_MISSING',
      `MCP server "${name}" is missing a command.`
    )
  }
  if ((input.transport === 'http' || input.transport === 'sse') && !input.url?.trim()) {
    throw new TanzoValidationError(
      'MCP_REMOTE_URL_MISSING',
      `MCP server "${name}" is missing a URL.`
    )
  }
}

function toUniqueConstraintError(name: string): TanzoValidationError {
  return new TanzoValidationError(
    'MCP_SERVER_NAME_DUPLICATE',
    `MCP server name "${name}" is already used.`
  )
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed')
}

function sanitizeServerForTransport(server: McpServerConfig): McpServerConfig {
  const base = {
    ...(server.id !== undefined ? { id: server.id } : {}),
    name: server.name,
    ...(server.description !== undefined ? { description: server.description } : {}),
    transport: server.transport,
    ...(server.env !== undefined ? { env: server.env } : {}),
    enabled: server.enabled,
    ...(server.created_at !== undefined ? { created_at: server.created_at } : {}),
    ...(server.updated_at !== undefined ? { updated_at: server.updated_at } : {})
  }

  if (server.transport === 'stdio') {
    return {
      ...base,
      transport: 'stdio',
      ...(server.command !== undefined ? { command: server.command } : {}),
      ...(server.args !== undefined ? { args: server.args } : {}),
      ...(server.cwd !== undefined ? { cwd: server.cwd } : {})
    }
  }

  return {
    ...base,
    transport: server.transport,
    ...(server.url !== undefined ? { url: server.url } : {}),
    ...(server.headers !== undefined ? { headers: server.headers } : {}),
    ...(server.redirect !== undefined ? { redirect: server.redirect } : {})
  }
}

function trimOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function normalizeServer(input: NewMcpServerInput | McpServerConfig): McpServerConfig {
  const server = serverSchema.parse({
    ...input,
    name: input.name.trim(),
    description: trimOptionalString(input.description),
    command: input.command?.trim(),
    cwd: trimOptionalString(input.cwd),
    url: input.url?.trim(),
    enabled: input.enabled
  })
  return sanitizeServerForTransport(server)
}

export function createMcpStore(db: SqlDatabase): McpStore {
  const selectServers = db.prepare('SELECT * FROM mcp_servers ORDER BY id')
  const selectServer = db.prepare('SELECT * FROM mcp_servers WHERE id = ?')
  const insertServer = db.prepare(`
    INSERT INTO mcp_servers (
      id, name, description, transport, command, args_json, cwd, url,
      headers_json, redirect, env_json, enabled, created_at, updated_at
    ) VALUES (
      @id, @name, @description, @transport, @command, @args_json, @cwd, @url,
      @headers_json, @redirect, @env_json, @enabled, @created_at, @updated_at
    )
  `)
  const updateServer = db.prepare(`
    UPDATE mcp_servers SET
      name = @name,
      description = @description,
      transport = @transport,
      command = @command,
      args_json = @args_json,
      cwd = @cwd,
      url = @url,
      headers_json = @headers_json,
      redirect = @redirect,
      env_json = @env_json,
      enabled = @enabled,
      created_at = @created_at,
      updated_at = @updated_at
    WHERE id = @id
  `)
  const deleteServer = db.prepare('DELETE FROM mcp_servers WHERE id = ?')

  function nowMs(): number {
    return Date.now()
  }

  function nowIso(): string {
    return new Date(nowMs()).toISOString()
  }

  function toParams(server: McpServerConfig): Record<string, unknown> {
    return {
      id: server.id ?? randomUUID(),
      name: server.name,
      description: server.description ?? null,
      transport: server.transport,
      command: server.command ?? null,
      args_json: stringifyJsonField(server.args),
      cwd: server.cwd ?? null,
      url: server.url ?? null,
      headers_json: stringifyJsonField(server.headers),
      redirect: server.redirect ?? null,
      env_json: stringifyJsonField(server.env),
      enabled: server.enabled ? 1 : 0,
      created_at: toTimestamp(server.created_at, nowMs()),
      updated_at: toTimestamp(server.updated_at, nowMs())
    }
  }

  function getInsertedServer(input: McpServerConfig): McpServerConfig {
    const row = input.id
      ? (selectServer.get([input.id]) as McpServerRow | undefined)
      : (db.prepare('SELECT * FROM mcp_servers WHERE name = ?').get([input.name]) as
          McpServerRow | undefined)
    if (!row) {
      throw new TanzoValidationError(
        'MCP_SERVER_NOT_CREATED',
        `MCP server "${input.name}" was not created.`
      )
    }
    const created = rowToServer(row)
    if (!created) {
      throw new TanzoValidationError(
        'MCP_SERVER_NOT_CREATED',
        `MCP server "${input.name}" was not created.`
      )
    }
    return cloneServer(created)
  }

  function saveNewServer(server: McpServerConfig): McpServerConfig {
    try {
      insertServer.run(toParams(server))
      return getInsertedServer(server)
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw toUniqueConstraintError(server.name)
      }
      throw error
    }
  }

  return {
    getAll() {
      return (selectServers.all() as McpServerRow[]).flatMap((row) => {
        const server = rowToServer(row)
        return server ? [cloneServer(server)] : []
      })
    },
    create(input) {
      const normalized = normalizeServer(input)
      assertValidServer(normalized)
      const timestamp = nowIso()
      return saveNewServer({
        ...normalized,
        created_at: timestamp,
        updated_at: timestamp
      })
    },
    update(id, partial) {
      const row = selectServer.get([id]) as McpServerRow | undefined
      if (!row) return undefined
      const existing = rowToServer(row)
      if (!existing) return undefined
      const merged = normalizeServer({
        ...existing,
        ...partial,
        ...(partial.name !== undefined ? { name: partial.name.trim() } : {}),
        id,
        updated_at: nowIso()
      })
      assertValidServer(merged)
      try {
        updateServer.run(toParams(merged))
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw toUniqueConstraintError(merged.name)
        }
        throw error
      }
      const updatedRow = selectServer.get([id]) as McpServerRow | undefined
      const updated = updatedRow ? rowToServer(updatedRow) : undefined
      return updated ? cloneServer(updated) : undefined
    },
    delete(id) {
      const existing = selectServer.get([id]) as McpServerRow | undefined
      if (!existing) return false
      deleteServer.run([id])
      return true
    },
    toggle(id, enabled) {
      return this.update(id, { enabled })
    }
  }
}
