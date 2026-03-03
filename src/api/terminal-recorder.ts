import { invoke } from '@tauri-apps/api/core'

export interface RecordingInfo {
  filePath: string
  fileName: string
  size: number
  createdAt: number
}

export function startRecording(
  sessionId: string,
  width: number,
  height: number,
  outputPath?: string,
): Promise<string> {
  return invoke('start_recording', { sessionId, outputPath, width, height })
}

export function stopRecording(sessionId: string): Promise<string> {
  return invoke('stop_recording', { sessionId })
}

export function isRecording(sessionId: string): Promise<boolean> {
  return invoke('is_recording', { sessionId })
}

export function listRecordings(): Promise<RecordingInfo[]> {
  return invoke('list_recordings')
}

export function readRecording(filePath: string): Promise<string> {
  return invoke('read_recording', { filePath })
}

export function exportRecording(sourcePath: string, targetPath: string): Promise<void> {
  return invoke('export_recording', { sourcePath, targetPath })
}
