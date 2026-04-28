import type { BackgroundJob } from '@/stores/background-job'
import type { ParsedVerificationReport } from '@/ai-gui/verificationReport'

export interface VerificationArchiveRecord {
  id: string
  sessionId: string
  status: BackgroundJob['status']
  createdAt: number
  finishedAt?: number
  report: ParsedVerificationReport | null
  raw?: string
}

const STORAGE_KEY = 'devforge.ai.verification.archive.v1'
const MAX_RECORDS = 20

export function loadVerificationArchive(storage: Storage | undefined = globalThis.localStorage): VerificationArchiveRecord[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(item => item?.id) : []
  } catch {
    return []
  }
}

export function saveVerificationArchive(records: VerificationArchiveRecord[], storage: Storage | undefined = globalThis.localStorage): void {
  if (!storage) return
  storage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_RECORDS)))
}

export function upsertVerificationArchiveRecord(records: VerificationArchiveRecord[], record: VerificationArchiveRecord): VerificationArchiveRecord[] {
  return [record, ...records.filter(item => item.id !== record.id)]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_RECORDS)
}

