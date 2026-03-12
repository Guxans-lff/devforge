import { invoke } from '@tauri-apps/api/core'
import { useLogStore } from '@/stores/log'
import { i18n } from '@/locales'
import type { SessionInfo } from '@/types/terminal'
import type { TestResult } from '@/api/connection'

export async function sshConnect(
  connectionId: string,
  cols: number,
  rows: number,
): Promise<SessionInfo> {
  const logStore = useLogStore()
  logStore.info('SSH', (i18n.global as any).t('log.ssh.connecting', { id: connectionId }))
  try {
    const session = await invoke<SessionInfo>('ssh_connect', { connectionId, cols, rows })
    logStore.info('SSH', (i18n.global as any).t('log.ssh.connected', { id: session.sessionId }))
    return session
  } catch (err: any) {
    logStore.error('SSH', (i18n.global as any).t('log.ssh.failed', { error: err.toString() }))
    throw err
  }
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

/** 流控 ACK：通知后端前端 xterm.js 已处理的累计字节数 */
export function sshFlowAck(sessionId: string, bytes: number): Promise<void> {
  return invoke('ssh_flow_ack', { sessionId, bytes })
}

/** 获取终端当前工作目录（通过后端 exec channel，不在终端中执行命令） */
export function sshGetCwd(sessionId: string): Promise<string> {
  return invoke('ssh_get_cwd', { sessionId })
}

export function sshTestConnection(id: string): Promise<TestResult> {
  return invoke('ssh_test_connection', { id })
}

export function sshTestConnectionParams(params: {
  host: string
  port: number
  username: string
  password: string
  authMethod?: string
  privateKeyPath?: string
  passphrase?: string
}): Promise<TestResult> {
  return invoke('ssh_test_connection_params', params)
}

export async function sshExecCommand(connectionId: string, command: string): Promise<string> {
  const logStore = useLogStore()
  logStore.debug('SSH', (i18n.global as any).t('log.ssh.executing', { cmd: command.slice(0, 50) + (command.length > 50 ? '...' : '') }))
  try {
    const output = await invoke<string>('ssh_exec_command', { connectionId, command })
    logStore.debug('SSH', (i18n.global as any).t('log.ssh.executed', { len: output.length }))
    return output
  } catch (err: any) {
    logStore.error('SSH', (i18n.global as any).t('log.ssh.execFailed', { error: err.toString() }), { command })
    throw err
  }
}
