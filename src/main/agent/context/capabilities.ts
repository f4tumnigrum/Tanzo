export interface ModelCapabilities {
  contextWindow: number
  maxOutputTokens: number
  supportsImages: boolean
}

export interface RawModelMetadata {
  contextWindow?: number
  maxOutput?: number
  vision?: boolean
}

export type ModelMetadataResolver = (modelRef: string) => RawModelMetadata | undefined

const DEFAULT_CONTEXT_WINDOW = 128_000
const DEFAULT_MAX_OUTPUT = 8_192

export function createCapabilities(resolve: ModelMetadataResolver) {
  return (modelRef: string): ModelCapabilities => {
    const raw = resolve(modelRef)
    const contextWindow =
      raw?.contextWindow && raw.contextWindow > 0 ? raw.contextWindow : DEFAULT_CONTEXT_WINDOW
    const maxReservableOutput = contextWindow > 1 ? contextWindow - 1 : contextWindow
    const defaultMaxOutput = Math.min(
      DEFAULT_MAX_OUTPUT,
      Math.max(1, Math.floor(contextWindow * 0.25))
    )
    const maxOutputTokens =
      raw?.maxOutput && raw.maxOutput > 0
        ? Math.min(raw.maxOutput, maxReservableOutput)
        : defaultMaxOutput
    return {
      contextWindow,
      maxOutputTokens,
      supportsImages: raw?.vision ?? false
    }
  }
}

export type CapabilitiesFor = ReturnType<typeof createCapabilities>
