export const MCP_CHANNELS = {
  listServers: 'mcp:list-servers',
  createServer: 'mcp:create-server',
  updateServer: 'mcp:update-server',
  deleteServer: 'mcp:delete-server',
  toggleServer: 'mcp:toggle-server',
  getConnectionStates: 'mcp:get-connection-states',
  connectionStatesChanged: 'mcp:connection-states-changed',
  listTools: 'mcp:list-tools',
  listResources: 'mcp:list-resources',
  readResource: 'mcp:read-resource',
  listResourceTemplates: 'mcp:list-resource-templates',
  listPrompts: 'mcp:list-prompts',
  getPrompt: 'mcp:get-prompt',
  reconnectServer: 'mcp:reconnect-server',
  elicitationRequested: 'mcp:elicitation-requested',
  resolveElicitation: 'mcp:resolve-elicitation'
} as const

export type McpTransportType = 'stdio' | 'sse' | 'http'
export type McpHttpRedirectMode = 'follow' | 'error'
export type McpServerStatus = 'connected' | 'disconnected' | 'connecting' | 'error'

/** Name of the app-contributed browser-automation server. Shared so the
 * renderer can group its tools under the browser-automation section. */
export const BUILTIN_BROWSER_SERVER_NAME = 'chrome-devtools'

export interface McpImplementationInfo {
  name: string
  version: string
  title?: string
}

export interface McpServerConfig {
  id?: string
  name: string
  description?: string
  transport: McpTransportType
  command?: string
  args?: string[]
  cwd?: string
  url?: string
  headers?: Record<string, string>
  redirect?: McpHttpRedirectMode
  env?: Record<string, string>
  enabled: boolean
  /**
   * True for servers the app itself contributes (e.g. the built-in browser
   * automation server). Built-in servers are not editable or deletable; their
   * enabled state is derived from an app preference, not the database.
   */
  builtin?: boolean
  created_at?: string
  updated_at?: string
}

export type NewMcpServerInput = Omit<McpServerConfig, 'id' | 'created_at' | 'updated_at'>

export interface McpConnectionState {
  name: string
  status: McpServerStatus
  error?: string
  toolCount?: number
  serverInfo?: McpImplementationInfo
  instructions?: string
}

export interface McpTool {
  name: string
  title?: string
  description?: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, unknown>
    [key: string]: unknown
  }
  outputSchema?: Record<string, unknown>
  annotations?: Record<string, unknown>
  _meta?: Record<string, unknown>
}

export interface McpListToolsResult {
  tools: McpTool[]
  nextCursor?: string
}

export interface McpResource {
  uri: string
  name: string
  title?: string
  description?: string
  mimeType?: string
  size?: number
  [key: string]: unknown
}

export interface McpListResourcesResult {
  resources: McpResource[]
  nextCursor?: string
}

export interface McpResourceTemplate {
  uriTemplate: string
  name: string
  title?: string
  description?: string
  mimeType?: string
  [key: string]: unknown
}

export interface McpListResourceTemplatesResult {
  resourceTemplates: McpResourceTemplate[]
  nextCursor?: string
}

export interface McpTextResourceContent {
  uri: string
  name?: string
  title?: string
  mimeType?: string
  text: string
  [key: string]: unknown
}

export interface McpBlobResourceContent {
  uri: string
  name?: string
  title?: string
  mimeType?: string
  blob: string
  [key: string]: unknown
}

export type McpResourceContent = McpTextResourceContent | McpBlobResourceContent

export interface McpReadResourceResult {
  contents: McpResourceContent[]
}

export interface McpPromptArgument {
  name: string
  description?: string
  required?: boolean
}

export interface McpPrompt {
  name: string
  title?: string
  description?: string
  arguments?: McpPromptArgument[]
  [key: string]: unknown
}

export interface McpListPromptsResult {
  prompts: McpPrompt[]
  nextCursor?: string
}

export interface McpTextContent {
  type: 'text'
  text: string
  [key: string]: unknown
}

export interface McpImageContent {
  type: 'image'
  data: string
  mimeType: string
  [key: string]: unknown
}

export interface McpEmbeddedResourceContent {
  type: 'resource'
  resource: McpResourceContent
  [key: string]: unknown
}

export type McpPromptContent = McpTextContent | McpImageContent | McpEmbeddedResourceContent

export interface McpPromptMessage {
  role: 'user' | 'assistant'
  content: McpPromptContent
  [key: string]: unknown
}

export interface McpGetPromptResult {
  description?: string
  messages: McpPromptMessage[]
}

export interface McpElicitationRequest {
  requestId: string
  serverName: string
  message: string
  requestedSchema: unknown
}

export interface McpElicitResult {
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, unknown>
}

export interface McpApi {
  listServers(): Promise<McpServerConfig[]>
  createServer(input: NewMcpServerInput): Promise<McpServerConfig>
  updateServer(id: string, partial: Partial<McpServerConfig>): Promise<McpServerConfig | undefined>
  deleteServer(id: string): Promise<boolean>
  toggleServer(id: string, enabled: boolean): Promise<McpServerConfig | undefined>
  getConnectionStates(): Promise<McpConnectionState[]>
  onConnectionStatesChanged(callback: (states: McpConnectionState[]) => void): () => void
  listTools(serverName: string): Promise<McpListToolsResult>
  listResources(serverName: string): Promise<McpListResourcesResult>
  readResource(serverName: string, uri: string): Promise<McpReadResourceResult>
  listResourceTemplates(serverName: string): Promise<McpListResourceTemplatesResult>
  listPrompts(serverName: string): Promise<McpListPromptsResult>
  getPrompt(
    serverName: string,
    promptName: string,
    args?: Record<string, unknown>
  ): Promise<McpGetPromptResult>
  reconnectServer(serverName: string): Promise<void>
  onElicitationRequested(callback: (request: McpElicitationRequest) => void): () => void
  resolveElicitation(requestId: string, result: McpElicitResult): Promise<void>
}
