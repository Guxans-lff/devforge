export type BackgroundJobKind =
  | 'ai_compact'
  | 'ai_compact_auto'
  | 'workspace_index'
  | 'resource_scan'
  | 'schema_compare'
  | 'schema_compare_sql'
  | 'erp_module_load'
  | 'verification'
  | 'diagnostic_capture'

export type BackgroundJobStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export interface BackgroundJob {
  id: string
  kind: BackgroundJobKind
  sessionId: string
  status: BackgroundJobStatus
  progress: number
  createdAt: number
  startedAt?: number
  finishedAt?: number
  result?: string
  error?: string
  title?: string
  contextSummary?: string
}
