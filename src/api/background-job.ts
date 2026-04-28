import { invokeCommand } from '@/api/base'

export interface BackgroundJobDto {
  id: string
  kind: string
  status: string
  session_id?: string
  sessionId?: string
  created_at?: number
  createdAt?: number
  started_at?: number | null
  startedAt?: number | null
  finished_at?: number | null
  finishedAt?: number | null
  progress: number
  result: string | null
  error: string | null
}

export function submitBackgroundJob(
  id: string,
  kind: string,
  sessionId: string,
): Promise<void> {
  return invokeCommand('submit_background_job', { id, kind, sessionId }, { source: 'AI' })
}

export function updateBackgroundJob(
  id: string,
  status: string,
  progress: number,
  result?: string,
  error?: string,
): Promise<void> {
  return invokeCommand('update_background_job', { id, status, progress, result: result ?? null, error: error ?? null }, { source: 'AI' })
}

export function getBackgroundJob(id: string): Promise<BackgroundJobDto | null> {
  return invokeCommand('get_background_job', { id }, { source: 'AI' })
}

export function listBackgroundJobs(sessionId?: string): Promise<BackgroundJobDto[]> {
  return invokeCommand('list_background_jobs', { sessionId: sessionId ?? null }, { source: 'AI' })
}

export function deleteBackgroundJob(id: string): Promise<void> {
  return invokeCommand('delete_background_job', { id }, { source: 'AI' })
}

export function cleanupBackgroundJobs(retainHours: number): Promise<number> {
  return invokeCommand('cleanup_background_jobs', { retainHours }, { source: 'AI' })
}
