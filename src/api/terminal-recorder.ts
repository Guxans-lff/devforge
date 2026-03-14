import { invokeCommand } from '@/api/base'

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
  return invokeCommand('start_recording', { sessionId, outputPath, width, height })
}

export function stopRecording(sessionId: string): Promise<string> {
  return invokeCommand('stop_recording', { sessionId })
}

export function isRecording(sessionId: string): Promise<boolean> {
  return invokeCommand('is_recording', { sessionId })
}

export function listRecordings(): Promise<RecordingInfo[]> {
  return invokeCommand('list_recordings')
}

export function readRecording(filePath: string): Promise<string> {
  return invokeCommand('read_recording', { filePath })
}

export function exportRecording(sourcePath: string, targetPath: string): Promise<void> {
  return invokeCommand('export_recording', { sourcePath, targetPath })
}
