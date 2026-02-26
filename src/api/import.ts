import { invoke } from '@tauri-apps/api/core'
import type { ImportConfig, ImportPreview, ImportResult } from '@/types/import'

export function importPreview(filePath: string, fileType: string): Promise<ImportPreview> {
  return invoke('import_preview', { filePath, fileType })
}

export function importData(config: ImportConfig): Promise<ImportResult> {
  return invoke('import_data', { config })
}
