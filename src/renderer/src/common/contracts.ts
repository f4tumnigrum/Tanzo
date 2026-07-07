import type { McpHttpRedirectMode, McpTransportType } from '@shared/mcp'

export type {
  AddProviderKeyInput,
  ConnectionTestResult,
  CredentialField,
  EmbeddingModel,
  ImageGenerationModel,
  ModelCapabilityFlags,
  ModelFamily,
  ModelRefreshResult,
  ProviderApi,
  ProviderConfig,
  ProviderConnectionInfo,
  ProviderDefaultsInput,
  ProviderDefaultsState,
  ProviderFamilyDescriptor,
  ProviderFamilyModel,
  ProviderFamilyState,
  ProviderId,
  ProviderKeyStatus,
  ProviderKeySummary,
  ProviderModel,
  ProviderModelSource,
  ProviderOptionChoice,
  ProviderOptionControl,
  ProviderOptionField,
  ProviderOptionSchema,
  ProviderReasoningCapability,
  ProviderSetupState,
  ProviderWorkspace,
  SaveProviderConnectionInput,
  SaveProviderDefaultsInput,
  SaveProviderModelStateInput,
  SpeechModel,
  StoredProviderModel,
  TranscriptionModel,
  UpdateProviderKeyInput
} from '@shared/provider'

export type {
  McpApi,
  McpBlobResourceContent,
  McpConnectionState,
  McpElicitationRequest,
  McpElicitResult,
  McpEmbeddedResourceContent,
  McpGetPromptResult,
  McpHttpRedirectMode,
  McpImageContent,
  McpImplementationInfo,
  McpListPromptsResult,
  McpListResourceTemplatesResult,
  McpListResourcesResult,
  McpListToolsResult,
  McpPrompt,
  McpPromptArgument,
  McpPromptContent,
  McpPromptMessage,
  McpReadResourceResult,
  McpResource,
  McpResourceContent,
  McpResourceTemplate,
  McpServerConfig,
  McpServerStatus,
  McpTextContent,
  McpTextResourceContent,
  McpTool,
  McpTransportType,
  NewMcpServerInput
} from '@shared/mcp'

export interface ServerFormData {
  name: string
  description?: string
  command?: string
  args?: string
  cwd?: string
  env?: string
  transport: McpTransportType
  url?: string
  headers?: string
  redirect?: McpHttpRedirectMode
  enabled: boolean
}

export interface ServerTemplate {
  id: string
  name: string
  description: string
  transport: McpTransportType
  command?: string
  args?: string[]
  cwd?: string
  url?: string
  headers?: Record<string, string>
  redirect?: McpHttpRedirectMode
  github?: string
}
