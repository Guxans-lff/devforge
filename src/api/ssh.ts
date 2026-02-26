import { invoke } from '@tauri-apps/api/core'
import type { SessionInfo } from '@/types/terminal'
import type { TestResult } from '@/api/connection'

export function sshConnect(
  connectionId: string,
  cols: number,
  rows: number,
): Promise<SessionInfo> {
  return invoke('ssh_connect', { connectionId, cols, rows })
}

export function sshDisconnect(sessionId: string): Promise<boolean> {
  return invoke('ssh_disconnect', { sessionId })
}

export function sshSendData(sessionId: string, data: string): Promise<void> {
  return invoke('ssh_send_data', { sessionId, data })
}

export function sshResize(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke('ssh_resize', { sessionId, cols, rows })
}

export function sshTestConnection(id: string): Promise<TestResult> {
  return invoke('ssh_test_connection', { id })
}

export function sshTestConnectionParams(params: {
  host: string
  port: number
  username: string
  password: string
}): Promise<TestResult> {
  return invoke('ssh_test_connection_params', params)
}
