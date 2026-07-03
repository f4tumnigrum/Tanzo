import type {
  EmbeddingModel as AiEmbeddingModel,
  ImageModel as AiImageModel,
  LanguageModel,
  SpeechModel as AiSpeechModel,
  TranscriptionModel as AiTranscriptionModel
} from 'ai'
import type {
  ConnectionTestResult,
  EmbeddingModel,
  ImageGenerationModel,
  ModelFamily,
  ProviderId,
  ProviderModel,
  SpeechModel,
  TranscriptionModel
} from '@shared/provider'

export type Credentials = Record<string, string>
export type RemoteModel =
  ProviderModel | EmbeddingModel | ImageGenerationModel | TranscriptionModel | SpeechModel

export interface ProviderAdapter {
  providerId: ProviderId
  validateCredentials(credentials: Credentials): boolean
  createLanguageModel(modelId: string, credentials: Credentials): LanguageModel
  createEmbeddingModel?(modelId: string, credentials: Credentials): AiEmbeddingModel
  createImageModel?(modelId: string, credentials: Credentials): AiImageModel
  createTranscriptionModel?(modelId: string, credentials: Credentials): AiTranscriptionModel
  createSpeechModel?(modelId: string, credentials: Credentials): AiSpeechModel
  fetchModels(credentials: Credentials, family: ModelFamily): Promise<RemoteModel[]>
  testConnection(credentials: Credentials): Promise<ConnectionTestResult>
}
