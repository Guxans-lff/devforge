import { aiUpdateJournalSection } from '@/api/ai'
import type { Logger } from '@/utils/logger'
import { genId } from './chatHelpers'

export interface SpawnedTask {
  id: string
  description: string
  status: 'pending' | 'running' | 'done' | 'error'
}

export function parseAndWriteJournalSections(text: string, workDirPath: string, log: Logger): void {
  const regex = /<!-- @@@journal:(\S+) -->([\s\S]*?)<!-- @@@end:journal:\1 -->/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const marker = match[1]!
    const content = match[2]!.trim()
    aiUpdateJournalSection(workDirPath, marker, content)
      .catch(error => log.warn('journal_write_failed', { marker }, error))
  }
}

export function parseSpawnedTasks(text: string): SpawnedTask[] {
  const regex = /\[SPAWN:([^\]]+)\]/g
  const tasks: SpawnedTask[] = []
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    tasks.push({
      id: genId(),
      description: match[1]!.trim(),
      status: 'pending',
    })
  }

  return tasks
}
