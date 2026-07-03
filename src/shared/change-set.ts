export const CHANGE_SET_CHANNELS = {
  patch: 'change-set:patch',
  apply: 'change-set:apply'
} as const

export type ChangeSetChannel = (typeof CHANGE_SET_CHANNELS)[keyof typeof CHANGE_SET_CHANNELS]

export type ChangeEntryKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'binary'

export interface ChangeEntry {
  path: string
  kind: ChangeEntryKind
  additions: number
  deletions: number
  binary?: boolean
  oldPath?: string
  diff?: string
  patchAvailable?: boolean
}

export type ChangeMaterializationStatus =
  'materialized' | 'pending' | 'partial' | 'failed' | 'skipped' | 'unknown'

export interface ChangeMaterialization {
  status: ChangeMaterializationStatus
}

export type ChangeRestoreRiskCode = 'none' | 'low' | 'medium' | 'high' | 'blocked'

export interface ChangeRestoreRisk {
  code: ChangeRestoreRiskCode
  message?: string
}

export interface ChangePreviewData {
  changeSetId: string
  runId: string
  chatId: string
  assistantMessageId: string
  cwd: string
  beforeCheckpointId: string
  afterCheckpointId: string
  beforeTreeOid: string
  afterTreeOid: string
  files: ChangeEntry[]
  fileCount: number
  additions: number
  deletions: number
  materialization: ChangeMaterialization
  restoreRisk: ChangeRestoreRisk
  createdAt: string
}

export interface ChangeSetApplyInput {
  changeSetId: string
  targetState: 'before' | 'after'
  paths?: string[]
  force?: boolean
}

export interface ChangeSetApplyResult {
  changeSet: ChangePreviewData
}

export interface ChangeSetApi {
  getChangeSetFilePatch(changeSetId: string, filePath: string): Promise<string | null>
  applyChangeSet(input: ChangeSetApplyInput): Promise<ChangeSetApplyResult>
}
