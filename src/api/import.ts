import { invokeCommand } from '@/api/base'
import type { ImportConfig, ImportPreview, ImportResult } from '@/types/import'

export function importPreview(filePath: string, fileType: string): Promise<ImportPreview> {
  return invokeCommand('import_preview', { filePath, fileType })
}

export function importData(config: ImportConfig): Promise<ImportResult> {
  return invokeCommand('import_data', { config })
}
